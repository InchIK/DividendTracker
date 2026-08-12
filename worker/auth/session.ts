import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getSessionUser, getWidgetUserByTokenHash } from '../db/auth';
import { bytesToBase64Url, randomBytes, sha256Base64Url } from './encoding';

export const SESSION_COOKIE = 'dt_session';

export interface AuthVariables {
  authUserId: string;
  authUsername: string;
  authRole: 'owner' | 'user';
  authMethod: 'session' | 'widget';
  authSessionHash?: string;
}

export interface AuthContextEnv {
  Bindings: Env;
  Variables: AuthVariables;
}

function extractBearer(header: string | undefined): string | null {
  const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
  const token = match?.[1]?.trim();
  return token?.length ? token : null;
}

function setAuth(c: Context<AuthContextEnv>, user: { user_id: string; username: string; role: 'owner' | 'user' }, method: 'session' | 'widget'): void {
  c.set('authUserId', user.user_id);
  c.set('authUsername', user.username);
  c.set('authRole', user.role);
  c.set('authMethod', method);
}

async function authenticateSession(c: Context<AuthContextEnv>): Promise<boolean> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return false;
  const sessionHash = await sha256Base64Url(token);
  const user = await getSessionUser(c.env.DB, sessionHash, new Date().toISOString());
  if (!user) return false;
  setAuth(c, user, 'session');
  c.set('authSessionHash', sessionHash);
  return true;
}

async function authenticateWidget(c: Context<AuthContextEnv>): Promise<boolean> {
  const token = extractBearer(c.req.header('Authorization'));
  if (!token) return false;
  const user = await getWidgetUserByTokenHash(c.env.DB, await sha256Base64Url(token));
  if (!user) return false;
  setAuth(c, user, 'widget');
  return true;
}

export function requireUser(): MiddlewareHandler<AuthContextEnv> {
  return async (c, next) => {
    if (!await authenticateSession(c)) return c.json({ error: '請先登入' }, 401);
    return next();
  };
}

export function requireOwner(): MiddlewareHandler<AuthContextEnv> {
  return async (c, next) => {
    if (!await authenticateSession(c)) return c.json({ error: '請先登入' }, 401);
    if (c.get('authRole') !== 'owner') return c.json({ error: '僅限擁有者操作' }, 403);
    return next();
  };
}

export function requireWidget(): MiddlewareHandler<AuthContextEnv> {
  return async (c, next) => {
    if (!await authenticateWidget(c)) return c.json({ error: 'Widget 憑證無效' }, 401);
    return next();
  };
}

export function requireWidgetOrUser(): MiddlewareHandler<AuthContextEnv> {
  return async (c, next) => {
    if (!await authenticateSession(c) && !await authenticateWidget(c)) {
      return c.json({ error: '登入或 Widget 憑證無效' }, 401);
    }
    return next();
  };
}

export function authUserId(c: Context<AuthContextEnv>): string {
  return c.get('authUserId');
}

export function newSessionToken(): string {
  return bytesToBase64Url(randomBytes(32));
}

export function writeSessionCookie(c: Context, token: string, remember: boolean, maxAgeSeconds: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    ...(remember ? { maxAge: maxAgeSeconds } : {}),
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}
