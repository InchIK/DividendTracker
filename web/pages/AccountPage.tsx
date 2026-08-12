import { useEffect, useState, type FormEvent } from "react";
import { api, type AuthUserDTO } from "@/api/client";

export function AccountPage({ user }: { user: AuthUserDTO }) {
  const [hasPassword, setHasPassword] = useState(user.hasPassword);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowRegistration, setAllowRegistration] = useState<boolean | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyMessage, setPolicyMessage] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);

  useEffect(() => {
    if (user.role !== "owner") return;
    let active = true;
    setPolicyLoading(true);
    setPolicyError(null);
    void api.getRegistrationPolicy()
      .then((policy) => {
        if (active) setAllowRegistration(policy.allowRegistration);
      })
      .catch((cause) => {
        if (active) setPolicyError(cause instanceof Error ? cause.message : "載入註冊設定失敗");
      })
      .finally(() => {
        if (active) setPolicyLoading(false);
      });
    return () => { active = false; };
  }, [user.role]);

  const saveRegistrationPolicy = async () => {
    if (allowRegistration === null) return;
    setPolicySaving(true);
    setPolicyMessage(null);
    setPolicyError(null);
    try {
      const policy = await api.updateRegistrationPolicy(allowRegistration);
      setAllowRegistration(policy.allowRegistration);
      setPolicyMessage("註冊設定已儲存");
    } catch (cause) {
      setPolicyError(cause instanceof Error ? cause.message : "儲存註冊設定失敗");
    } finally {
      setPolicySaving(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("兩次輸入的新密碼不一致");
      return;
    }
    setSaving(true);
    try {
      if (hasPassword) await api.changePassword({ currentPassword, newPassword });
      else await api.setPassword(newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setHasPassword(true);
      setMessage(hasPassword ? "密碼已更新，其他裝置的登入狀態已登出。" : "登入密碼已設定，現在可用密碼顯示 Widget Token。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "密碼更新失敗");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">帳號與安全性</p>
        <h1 className="mt-1 text-2xl font-black">{user.displayName}</h1>
        <p className="mt-1 text-sm text-slate-500">@{user.username} · {user.role === "owner" ? "擁有者" : "使用者"}</p>
      </div>

      {user.role === "owner" && (
        <section aria-labelledby="registration-policy-heading" className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/20">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="registration-policy-heading" className="font-bold">新帳號註冊</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {allowRegistration === true ? "朋友現在可以建立新帳號。" : "現有帳號仍可登入，新帳號（含 Google）將無法建立。"}
              </p>
            </div>
            <span
              role="status"
              aria-live="polite"
              className={`rounded-full px-3 py-1 text-xs font-bold ${allowRegistration === true
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"}`}
            >
              {policyLoading ? "載入中…" : allowRegistration === true ? "開放中" : allowRegistration === false ? "已關閉" : "尚未載入"}
            </span>
          </div>

          <label htmlFor="allow-registration" className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold shadow-sm dark:border-emerald-900/60 dark:bg-slate-900/70">
            <input
              id="allow-registration"
              type="checkbox"
              role="switch"
              aria-label="允許新帳號註冊"
              checked={allowRegistration ?? false}
              disabled={policyLoading || policySaving || allowRegistration === null}
              onChange={(event) => setAllowRegistration(event.target.checked)}
              className="h-5 w-5 accent-emerald-600"
            />
            <span>允許新帳號註冊</span>
          </label>

          {policyMessage && <div role="status" className="rounded-xl bg-emerald-100 px-3 py-2.5 text-sm text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">{policyMessage}</div>}
          {policyError && <div role="alert" className="rounded-xl bg-red-100 px-3 py-2.5 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200">{policyError}</div>}
          <button type="button" onClick={() => { void saveRegistrationPolicy(); }} disabled={policyLoading || policySaving || allowRegistration === null} className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400">
            {policySaving ? "儲存中…" : "儲存註冊設定"}
          </button>
        </section>
      )}

      <form onSubmit={(event) => { void submit(event); }} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
        <div>
          <h2 className="font-bold">{hasPassword ? "變更密碼" : "設定登入密碼"}</h2>
          <p className="mt-1 text-xs text-slate-500">{hasPassword ? "更新後會撤銷其他裝置的登入 Session，目前裝置不受影響。" : "Google 帳號需先建立本機密碼，才能重新驗證並顯示 Widget Token。"}</p>
        </div>
        {hasPassword && <PasswordField label="目前密碼" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" minLength={1} />}
        <PasswordField label="新密碼" value={newPassword} onChange={setNewPassword} autoComplete="new-password" minLength={12} />
        <PasswordField label="再次輸入新密碼" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" minLength={12} />
        {message && <div role="status" className="rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">{message}</div>}
        {error && <div role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</div>}
        <button type="submit" disabled={saving} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">{saving ? "更新中…" : hasPassword ? "更新密碼" : "設定密碼"}</button>
      </form>
    </div>
  );
}

function PasswordField({ label, value, onChange, autoComplete, minLength }: { label: string; value: string; onChange: (value: string) => void; autoComplete: string; minLength: number }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input type="password" required minLength={minLength} maxLength={128} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-600 dark:bg-slate-950" />
    </label>
  );
}
