import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  clearSessionCookie,
  newSessionToken,
  requireOwner,
  requireUser,
  writeSessionCookie,
  type AuthContextEnv,
} from '../auth/session';
import { sha256Base64Url } from '../auth/encoding';
import { verifyGoogleIdToken } from '../auth/google';
import { hashPassword, verifyPassword } from '../auth/password';
import {
  createWidgetCredential,
  decryptWidgetCredential,
} from '../auth/widget-credential';
import {
  countActiveUsers,
  createSession,
  createUser,
  deleteOtherUserSessions,
  deleteSession,
  getUserById,
  getUserByGoogleSub,
  getUserByUsername,
  getAllowRegistrationOverride,
  getWidgetCredentialByUser,
  saveWidgetCredential,
  upsertAllowRegistrationOverride,
  updatePassword,
  type UserRow,
} from '../db/auth';

const usernameSchema = z.string().trim().min(3).max(64)
  .regex(/^[\p{L}\p{N}._@+-]+$/u, '帳號只能使用文字、數字及 . _ @ + -');
const passwordSchema = z.string().min(12).max(128);

const registerSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(80).optional(),
  password: passwordSchema,
  remember: z.boolean().default(false),
}).strict();

const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(128),
  remember: z.boolean().default(false),
}).strict();

const passwordConfirmationSchema = z.object({
  password: z.string().min(1).max(128),
}).strict();

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
}).strict();

const setPasswordSchema = z.object({ newPassword: passwordSchema }).strict();
const googleSchema = z.object({
  credential: z.string().min(100).max(16_384),
  remember: z.boolean().default(false),
}).strict();

const registrationPolicySchema = z.object({
  allowRegistration: z.boolean(),
}).strict();

interface RuntimeAuthSettings {
  appName: string;
  allowRegistration: boolean;
  passwordIterations: number;
  sessionTtlHours: number;
  rememberSessionTtlDays: number;
  googleEnabled: boolean;
  googleClientId: string | null;
  tokenEncryptionKey: string;
}

interface ResolvedRegistrationPolicy {
  allowRegistration: boolean;
  source: 'database' | 'environment';
  firstAccount: boolean;
}

function integerSetting(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function settings(env: Env): RuntimeAuthSettings {
  const appName = env.APP_NAME?.trim();
  const googleClientId = env.GOOGLE_CLIENT_ID?.trim();
  return {
    appName: appName?.length ? appName : 'DividendTracker',
    allowRegistration: String(env.ALLOW_REGISTRATION) === 'true',
    passwordIterations: integerSetting(env.PASSWORD_PBKDF2_ITERATIONS, 100_000, 100_000, 100_000),
    sessionTtlHours: integerSetting(env.SESSION_TTL_HOURS, 12, 1, 168),
    rememberSessionTtlDays: integerSetting(env.REMEMBER_SESSION_TTL_DAYS, 30, 1, 365),
    googleEnabled: String(env.GOOGLE_AUTH_ENABLED) === 'true' && Boolean(env.GOOGLE_CLIENT_ID?.trim()),
    googleClientId: googleClientId?.length ? googleClientId : null,
    tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY,
  };
}

async function resolveRegistrationPolicy(
  db: D1Database,
  runtime: RuntimeAuthSettings,
): Promise<ResolvedRegistrationPolicy> {
  const firstAccount = (await countActiveUsers(db)) === 0;
  const override = await getAllowRegistrationOverride(db);
  return {
    allowRegistration: firstAccount || (override ?? runtime.allowRegistration),
    source: override === null ? 'environment' : 'database',
    firstAccount,
  };
}

function normalizeUsername(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}

function publicUser(user: UserRow) {
  return {
    userId: user.user_id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    hasPassword: user.password_hash !== 'unusable',
  };
}

function invalidCredentials(c: Context<AuthContextEnv>) {
  return c.json({ error: '帳號或密碼錯誤' }, 401);
}

async function parseJson<T>(
  c: Context<AuthContextEnv>,
  schema: z.ZodType<T>,
): Promise<{ data: T } | { response: Response }> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return { response: c.json({ error: parsed.error.issues[0]?.message ?? '輸入格式錯誤' }, 400) };
  }
  return { data: parsed.data };
}

async function issueSession(
  c: Context<AuthContextEnv>,
  userId: string,
  remember: boolean,
  runtime: RuntimeAuthSettings,
): Promise<void> {
  const token = newSessionToken();
  const sessionHash = await sha256Base64Url(token);
  const now = new Date();
  const maxAgeSeconds = remember
    ? runtime.rememberSessionTtlDays * 86_400
    : runtime.sessionTtlHours * 3_600;
  await createSession(c.env.DB, {
    sessionHash,
    userId,
    now: now.toISOString(),
    expiresAt: new Date(now.getTime() + maxAgeSeconds * 1_000).toISOString(),
    userAgent: c.req.header('User-Agent')?.slice(0, 512) ?? null,
  });
  writeSessionCookie(c, token, remember, maxAgeSeconds);
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /unique|constraint/i.test(error.message);
}

export const authRoutes = new Hono<AuthContextEnv>();

authRoutes.get('/api/v1/auth/registration-policy', requireOwner(), async (c) => {
  const policy = await resolveRegistrationPolicy(c.env.DB, settings(c.env));
  return c.json({ allowRegistration: policy.allowRegistration, source: policy.source });
});

authRoutes.put('/api/v1/auth/registration-policy', requireOwner(), async (c) => {
  const body = await parseJson(c, registrationPolicySchema);
  if ('response' in body) return body.response;
  await upsertAllowRegistrationOverride(
    c.env.DB,
    body.data.allowRegistration,
    c.get('authUserId'),
    new Date().toISOString(),
  );
  return c.json({ allowRegistration: body.data.allowRegistration, source: 'database' as const });
});

authRoutes.get('/api/v1/auth/config', async (c) => {
  const runtime = settings(c.env);
  const policy = await resolveRegistrationPolicy(c.env.DB, runtime);
  return c.json({
    appName: runtime.appName,
    registrationEnabled: policy.allowRegistration,
    firstAccount: policy.firstAccount,
    passwordMinimumLength: 12,
    google: {
      enabled: runtime.googleEnabled,
      clientId: runtime.googleEnabled ? runtime.googleClientId : null,
    },
  });
});

authRoutes.post('/api/v1/auth/register', async (c) => {
  const body = await parseJson(c, registerSchema);
  if ('response' in body) return body.response;
  const runtime = settings(c.env);
  if (!runtime.tokenEncryptionKey) {
    return c.json({ error: '伺服器尚未設定 Widget 憑證加密金鑰' }, 503);
  }
  const policy = await resolveRegistrationPolicy(c.env.DB, runtime);
  if (!policy.allowRegistration) {
    return c.json({ error: '目前未開放新帳號註冊' }, 403);
  }
  const activeUsers = await countActiveUsers(c.env.DB);

  const username = normalizeUsername(body.data.username);
  if (await getUserByUsername(c.env.DB, username)) {
    return c.json({ error: '此帳號已被使用' }, 409);
  }
  const userId = `usr_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    await createUser(c.env.DB, {
      userId,
      username,
      displayName: body.data.displayName ?? body.data.username.trim(),
      password: await hashPassword(body.data.password, runtime.passwordIterations),
      role: activeUsers === 0 ? 'owner' : 'user',
      widget: await createWidgetCredential(runtime.tokenEncryptionKey),
      now,
    });
  } catch (error) {
    if (isUniqueConstraint(error)) return c.json({ error: '此帳號已被使用，請改用其他帳號' }, 409);
    throw error;
  }
  await issueSession(c, userId, body.data.remember ?? false, runtime);
  const user = await getUserById(c.env.DB, userId);
  if (!user) throw new Error('Registered user was not found');
  return c.json({ user: publicUser(user) }, 201);
});

authRoutes.post('/api/v1/auth/login', async (c) => {
  const body = await parseJson(c, loginSchema);
  if ('response' in body) return body.response;
  const user = await getUserByUsername(c.env.DB, normalizeUsername(body.data.username));
  if (user?.account_status !== 'active') return invalidCredentials(c);
  const valid = await verifyPassword(body.data.password, {
    hash: user.password_hash,
    salt: user.password_salt,
    iterations: user.password_iterations,
  });
  if (!valid) return invalidCredentials(c);
  await issueSession(c, user.user_id, body.data.remember ?? false, settings(c.env));
  return c.json({ user: publicUser(user) });
});

authRoutes.get('/api/v1/auth/me', requireUser(), async (c) => {
  const user = await getUserById(c.env.DB, c.get('authUserId'));
  if (!user) return c.json({ error: '登入狀態已失效' }, 401);
  return c.json({ user: publicUser(user) });
});

authRoutes.post('/api/v1/auth/logout', requireUser(), async (c) => {
  const sessionHash = c.get('authSessionHash');
  if (sessionHash) await deleteSession(c.env.DB, sessionHash);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.post('/api/v1/auth/change-password', requireUser(), async (c) => {
  const body = await parseJson(c, changePasswordSchema);
  if ('response' in body) return body.response;
  const user = await getUserById(c.env.DB, c.get('authUserId'));
  if (!user) return c.json({ error: '登入狀態已失效' }, 401);
  const valid = await verifyPassword(body.data.currentPassword, {
    hash: user.password_hash,
    salt: user.password_salt,
    iterations: user.password_iterations,
  });
  if (!valid) return c.json({ error: '目前密碼錯誤' }, 403);
  const now = new Date().toISOString();
  await updatePassword(
    c.env.DB,
    user.user_id,
    await hashPassword(body.data.newPassword, settings(c.env).passwordIterations),
    now,
  );
  const sessionHash = c.get('authSessionHash');
  if (sessionHash) await deleteOtherUserSessions(c.env.DB, user.user_id, sessionHash);
  return c.json({ ok: true });
});

authRoutes.post('/api/v1/auth/set-password', requireUser(), async (c) => {
  const body = await parseJson(c, setPasswordSchema);
  if ('response' in body) return body.response;
  const user = await getUserById(c.env.DB, c.get('authUserId'));
  if (!user) return c.json({ error: '登入狀態已失效' }, 401);
  if (user.password_hash !== 'unusable') return c.json({ error: '此帳號已設定密碼' }, 409);
  await updatePassword(
    c.env.DB,
    user.user_id,
    await hashPassword(body.data.newPassword, settings(c.env).passwordIterations),
    new Date().toISOString(),
  );
  return c.json({ ok: true });
});

authRoutes.get('/api/v1/auth/widget-token', requireUser(), async (c) => {
  const credential = await getWidgetCredentialByUser(c.env.DB, c.get('authUserId'));
  if (!credential) return c.json({ error: '找不到 Widget 憑證' }, 404);
  return c.json({ maskedToken: `dtw_••••••${credential.token_suffix}`, rotatedAt: credential.rotated_at });
});

authRoutes.post('/api/v1/auth/widget-token/reveal', requireUser(), async (c) => {
  const body = await parseJson(c, passwordConfirmationSchema);
  if ('response' in body) return body.response;
  const user = await getUserById(c.env.DB, c.get('authUserId'));
  const credential = await getWidgetCredentialByUser(c.env.DB, c.get('authUserId'));
  if (!user || !credential) return c.json({ error: '找不到 Widget 憑證' }, 404);
  const valid = await verifyPassword(body.data.password, {
    hash: user.password_hash,
    salt: user.password_salt,
    iterations: user.password_iterations,
  });
  if (!valid) return c.json({ error: '密碼錯誤' }, 403);
  return c.json({
    token: await decryptWidgetCredential(
      settings(c.env).tokenEncryptionKey,
      credential.token_ciphertext,
      credential.token_iv,
    ),
  });
});

authRoutes.post('/api/v1/auth/widget-token/rotate', requireUser(), async (c) => {
  const body = await parseJson(c, passwordConfirmationSchema);
  if ('response' in body) return body.response;
  const user = await getUserById(c.env.DB, c.get('authUserId'));
  if (!user) return c.json({ error: '登入狀態已失效' }, 401);
  const valid = await verifyPassword(body.data.password, {
    hash: user.password_hash,
    salt: user.password_salt,
    iterations: user.password_iterations,
  });
  if (!valid) return c.json({ error: '密碼錯誤' }, 403);
  const runtime = settings(c.env);
  const credential = await createWidgetCredential(runtime.tokenEncryptionKey);
  await saveWidgetCredential(c.env.DB, user.user_id, credential, new Date().toISOString());
  return c.json({ token: credential.token });
});

authRoutes.post('/api/v1/auth/google', async (c) => {
  const runtime = settings(c.env);
  if (!runtime.googleEnabled) return c.json({ error: 'Google 登入尚未啟用' }, 404);
  const body = await parseJson(c, googleSchema);
  if ('response' in body) return body.response;
  let identity;
  try {
    identity = await verifyGoogleIdToken(body.data.credential, runtime.googleClientId!);
  } catch {
    return c.json({ error: 'Google 身分憑證無效或已過期' }, 401);
  }

  let user = await getUserByGoogleSub(c.env.DB, identity.sub);
  if (!user) {
    const policy = await resolveRegistrationPolicy(c.env.DB, runtime);
    const activeUsers = await countActiveUsers(c.env.DB);
    if (!policy.allowRegistration) {
      return c.json({ error: '目前未開放新帳號註冊' }, 403);
    }
    const normalizedEmail = normalizeUsername(identity.email);
    const googleUsername = usernameSchema.safeParse(normalizedEmail).success
      ? normalizedEmail
      : `google_${(await sha256Base64Url(identity.sub)).slice(0, 40)}`;
    if (await getUserByUsername(c.env.DB, googleUsername)) {
      return c.json({ error: '相同帳號已存在，請先使用密碼登入' }, 409);
    }
    const userId = `usr_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    try {
      await createUser(c.env.DB, {
        userId,
        username: googleUsername,
        displayName: identity.name,
        password: { hash: 'unusable', salt: 'unusable', iterations: 100_000 },
        role: activeUsers === 0 ? 'owner' : 'user',
        widget: await createWidgetCredential(runtime.tokenEncryptionKey),
        google: { sub: identity.sub, email: identity.email },
        now,
      });
    } catch (error) {
      if (isUniqueConstraint(error)) return c.json({ error: 'Google 帳號已連結或帳號名稱衝突' }, 409);
      throw error;
    }
    user = await getUserById(c.env.DB, userId);
  }
  if (!user) throw new Error('Google user was not found after authentication');
  await issueSession(c, user.user_id, body.data.remember ?? false, runtime);
  return c.json({ user: publicUser(user) });
});
