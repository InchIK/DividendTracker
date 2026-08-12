import { useEffect, useState } from "react";
import type { AuthUserDTO } from "@/api/client";

const NAV_ITEMS = [
  { hash: "#/", label: "儀表板", icon: "📊" },
  { hash: "#/portfolio", label: "持股設定", icon: "💼" },
  { hash: "#/dividends", label: "配息事件", icon: "🧾" },
  { hash: "#/sync", label: "資料同步", icon: "🔄" },
  { hash: "#/widget-setup", label: "小工具設定", icon: "🧩" },
  { hash: "#/account", label: "帳號", icon: "👤" },
];

export function Layout({ children, currentHash, user, onLogout }: { children: React.ReactNode; currentHash: string; user: AuthUserDTO; onLogout: () => Promise<void> }) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Close mobile menu on hash change
  useEffect(() => {
    setMenuOpen(false);
  }, [currentHash]);

  const isCurrent = (h: string): boolean =>
    h === "#/" ? currentHash === "#/" || currentHash === "" : currentHash.startsWith(h);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/80 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
          <a href="#/" className="flex items-center gap-2 font-bold">
            <span className="text-xl">💰</span>
            <span className="hidden xs:inline sm:inline">DividendTracker</span>
            <span className="xs:hidden sm:hidden">Dividend</span>
          </a>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((it) => (
              <a
                key={it.hash}
                href={it.hash}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isCurrent(it.hash)
                    ? "bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                <span className="mr-1">{it.icon}</span>
                {it.label}
              </a>
            ))}
            <button
              type="button"
              onClick={() => { void onLogout(); }}
              className="ml-2 px-3 py-1.5 rounded-md text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              登出
            </button>
          </nav>

          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="開啟選單"
            aria-expanded={menuOpen}
            className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              {menuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile dropdown */}
        {menuOpen && (
          <nav className="md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <ul className="flex flex-col p-2">
              {NAV_ITEMS.map((it) => (
                <li key={it.hash}>
                  <a
                    href={it.hash}
                    className={`block px-3 py-2 rounded-md text-sm font-medium ${
                      isCurrent(it.hash)
                        ? "bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900"
                        : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span className="mr-2">{it.icon}</span>
                    {it.label}
                  </a>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => { void onLogout(); }}
                  className="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  🚪 登出
                </button>
              </li>
            </ul>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

      <footer className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-500">
        DividendTracker · {user.displayName} · 資料來源：證交所／投信投顧公會 · 僅供參考，非投資建議
      </footer>
    </div>
  );
}

export default Layout;
