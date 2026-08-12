import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type AuthConfigDTO, type AuthUserDTO } from "@/api/client";

type Mode = "login" | "register";

export function LoginPage({ onLoggedIn }: { onLoggedIn: (user: AuthUserDTO) => void }) {
  const [config, setConfig] = useState<AuthConfigDTO | null>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rememberRef = useRef(remember);
  rememberRef.current = remember;

  useEffect(() => {
    let active = true;
    void api.getAuthConfig()
      .then((result) => {
        if (!active) return;
        setConfig(result);
        if (result.firstAccount) setMode("register");
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "無法載入登入設定");
      });
    return () => { active = false; };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = mode === "register"
        ? await api.register({ username, displayName: displayName.trim() || username, password, remember })
        : await api.login({ username, password, remember });
      setPassword("");
      onLoggedIn(result.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : mode === "register" ? "註冊失敗" : "登入失敗");
    } finally {
      setLoading(false);
    }
  };

  const registrationEnabled = config?.registrationEnabled ?? false;

  const googleCredential = async (credential: string) => {
    setError(null);
    setLoading(true);
    try {
      const result = await api.googleLogin(credential, rememberRef.current);
      onLoggedIn(result.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Google 登入失敗");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-10 text-slate-100">
      <div className="absolute -left-24 top-[-8rem] h-80 w-80 rounded-full bg-emerald-500/20 blur-3xl" />
      <div className="absolute -right-20 bottom-[-9rem] h-96 w-96 rounded-full bg-sky-500/20 blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="mb-7 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 text-2xl shadow-lg shadow-emerald-950/50">💰</div>
          <h1 className="mt-4 text-3xl font-black tracking-tight">{config?.appName ?? "DividendTracker"}</h1>
          <p className="mt-2 text-sm text-slate-400">台灣 ETF／股票配息與行情追蹤</p>
        </div>

        <section className="rounded-[28px] border border-white/10 bg-white/[0.07] p-6 shadow-2xl shadow-black/30 backdrop-blur-xl">
          {registrationEnabled && (
            <div className="mb-5 grid grid-cols-2 rounded-xl bg-slate-900/70 p-1" role="tablist">
              {(["login", "register"] as const).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  role="tab"
                  aria-selected={mode === candidate}
                  onClick={() => { setMode(candidate); setError(null); }}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${mode === candidate ? "bg-white text-slate-950 shadow" : "text-slate-400 hover:text-white"}`}
                >
                  {candidate === "login" ? "登入" : config?.firstAccount ? "建立擁有者帳號" : "註冊"}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={(event) => { void submit(event); }} className="space-y-4">
            {mode === "register" && (
              <label className="block text-sm font-medium text-slate-300">
                顯示名稱
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  autoComplete="name"
                  maxLength={80}
                  placeholder="例如：我的投資組合"
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3.5 py-3 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
                />
              </label>
            )}

            <label className="block text-sm font-medium text-slate-300">
              帳號
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoFocus
                required
                minLength={3}
                maxLength={64}
                autoCapitalize="none"
                autoComplete="username"
                spellCheck={false}
                placeholder="輸入帳號"
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3.5 py-3 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
              />
            </label>

            <label className="block text-sm font-medium text-slate-300">
              密碼
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={mode === "register" ? config?.passwordMinimumLength ?? 12 : 1}
                maxLength={128}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                placeholder={mode === "register" ? "至少 12 個字元" : "輸入密碼"}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3.5 py-3 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
              />
            </label>

            <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-slate-400">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500" />
              在此裝置保持登入
            </label>

            {error && <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">{error}</div>}

            <button type="submit" disabled={loading || config === null} className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 py-3 font-bold text-slate-950 shadow-lg shadow-emerald-950/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
              {loading ? "處理中…" : mode === "register" ? "建立帳號並登入" : "登入"}
            </button>
          </form>

          {config?.google.enabled && (
            <div className="mt-5 border-t border-white/10 pt-5">
              {config.google.clientId && <GoogleButton clientId={config.google.clientId} onCredential={(credential) => { void googleCredential(credential); }} />}
            </div>
          )}

          {config?.firstAccount && <p className="mt-4 text-xs leading-relaxed text-amber-300/80">第一個註冊帳號將成為擁有者，並接收升級前既有的持股、Widget 外觀與人工覆核資料。</p>}
        </section>
      </div>
    </main>
  );
}

export default LoginPage;

interface GoogleIdentityApi {
  accounts: {
    id: {
      initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
      renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
    };
  };
}

declare global {
  interface Window { google?: GoogleIdentityApi }
}

function GoogleButton({ clientId, onCredential }: { clientId: string; onCredential: (credential: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const credentialCallback = useRef(onCredential);
  credentialCallback.current = onCredential;

  useEffect(() => {
    let active = true;
    const render = () => {
      if (!active || !container.current || !window.google) return;
      container.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => credentialCallback.current(response.credential),
      });
      window.google.accounts.id.renderButton(container.current, {
        type: 'standard', theme: 'outline', size: 'large', text: 'continue_with',
        shape: 'rectangular', width: Math.min(360, container.current.clientWidth),
      });
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-dividend-tracker-google]');
    if (window.google) render();
    else if (existing) existing.addEventListener('load', render, { once: true });
    else {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.dataset.dividendTrackerGoogle = 'true';
      script.addEventListener('load', render, { once: true });
      document.head.appendChild(script);
    }
    return () => { active = false; };
  }, [clientId]);

  return <div ref={container} className="flex min-h-11 justify-center" aria-label="使用 Google 登入" />;
}
