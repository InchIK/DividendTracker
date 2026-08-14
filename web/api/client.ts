/**
 * Typed API client for the DividendTracker backend.
 *
 * Wraps fetch with:
 *   - HttpOnly same-origin session cookies for browser authentication
 *   - JSON request/response handling
 *   - Consistent error surface (ApiError)
 *   - Redirects to /login on 401
 *
 * The backend is a Cloudflare Workers + Hono app exposing /api/v1/* endpoints.
 */
const API_BASE = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly body?: unknown;

  constructor(message: string, status: number, endpoint: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.endpoint = endpoint;
    this.body = body;
  }
}

interface FetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: FetchOptions["query"]): string {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }
  // Use relative form so Vite dev proxy / Cloudflare Pages asset bindings work
  return `${url.pathname}${url.search}`;
}

async function request<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (opts.body !== undefined && opts.body !== null) {
    headers["Content-Type"] = "application/json";
  }

  let resp: Response;
  try {
    resp = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined && opts.body !== null ? JSON.stringify(opts.body) : null,
      signal: opts.signal ?? null,
      credentials: "same-origin",
    });
  } catch (err) {
    throw new ApiError(
      `網路連線失敗：${err instanceof Error ? err.message : "未知錯誤"}`,
      0,
      path,
    );
  }

  if (resp.status === 401) {
    // Redirect to login (hash-routing friendly)
    if (window.location.hash !== "#/login" && window.location.pathname !== "/login") {
      window.location.hash = "#/login";
    }
    throw new ApiError("未登入或權限不足", 401, path);
  }

  const raw = await resp.text();
  let parsed: unknown = undefined;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }

  if (!resp.ok) {
    const message =
      (parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed).error)
        : null) ??
      (typeof parsed === "string" && parsed ? parsed : null) ??
      `HTTP ${resp.status}`;
    throw new ApiError(message, resp.status, path, parsed);
  }

  return parsed as T;
}

// ---------------------------------------------------------------------------
// Domain types (mirror of worker/domain and backend response shapes)
// ---------------------------------------------------------------------------

export type WatchlistMarket = "twse" | "tpex";
export type WatchlistKind = "stock" | "etf";
export type WatchlistStatus = "pending_validation" | "validated";

export interface WatchlistItemDTO {
  instrumentId: string;
  market: WatchlistMarket;
  code: string;
  kind: WatchlistKind;
  displayName: string;
  shares: number;
  enabled: boolean;
  status: WatchlistStatus;
  updatedAt: string;
}

export interface WatchlistResponse {
  items: WatchlistItemDTO[];
}

export interface CreateWatchlistItemPayload {
  market: WatchlistMarket;
  code: string;
  kind: WatchlistKind;
  displayName: string;
  shares: number | string;
  enabled: boolean;
  metadataSource?: InstrumentSearchItemDTO["metadataSource"];
}

export interface InstrumentSearchItemDTO {
  instrumentId: string;
  market: WatchlistMarket;
  code: string;
  kind: WatchlistKind;
  displayName: string;
  metadataSource: "twse_t187ap03_L" | "twse_t187ap47_L" | "tpex_mopsfin_t187ap03_O";
  quote: {
    latestPriceMicros: string | null;
    previousCloseMicros: string | null;
    tradeDate: string | null;
    tradeTime: string | null;
    marketState: string;
    status: string;
    observedAt: string;
    stale: boolean;
    errorMessage: string | null;
  } | null;
}

export interface InstrumentSearchResponse {
  items: InstrumentSearchItemDTO[];
  partial: boolean;
  unavailableSources: string[];
}

export interface UpdateWatchlistItemPayload {
  shares?: number | string;
  enabled?: boolean;
  displayName?: string;
}

export interface WatchlistMutationResponse {
  status: WatchlistStatus;
  item: WatchlistItemDTO;
  restored?: boolean;
  refresh?: InstrumentRefreshDTO | null;
}

export interface AuthUserDTO {
  userId: string;
  username: string;
  displayName: string;
  role: "owner" | "user";
  hasPassword: boolean;
}

export interface AuthConfigDTO {
  appName: string;
  registrationEnabled: boolean;
  firstAccount: boolean;
  passwordMinimumLength: number;
  google: { enabled: boolean; clientId: string | null };
}

export interface RegistrationPolicyDTO {
  allowRegistration: boolean;
  source: "database" | "environment";
}

export interface InstrumentRefreshDTO {
  status: "success" | "partial" | "failed";
  dividend: {
    outcome: "empty_selection" | "success" | "partial" | "rejected";
    selected: number;
    rowsRead: number;
    observationsApplied: number;
    eventsChanged: number;
    errors: string[];
  };
  prices: {
    outcome: "empty_selection" | "success" | "partial" | "failed";
    selected: number;
    persisted: number;
    errors: string[];
  };
  errors: string[];
}

export interface PriceDTO {
  instrumentId: string;
  code: string;
  displayName: string;
  latestPriceMicros: string | null;
  previousCloseMicros: string | null;
  tradeDate: string | null;
  tradeTime: string | null;
  marketState: "trading" | "closed" | "halted" | "no_trade" | "unknown" | null;
  status: "complete" | "partial" | "not_covered" | "stale" | "error" | null;
  source: string | null;
  observedAt: string | null;
  stale: boolean;
  errorMessage: string | null;
}

export interface PricesResponse {
  items: PriceDTO[];
}

export type EventStatus =
  | "schedule_only"
  | "pending_amount"
  | "announced"
  | "verified"
  | "paid"
  | "cancelled"
  | "conflict";

export interface CanonicalEventDTO {
  eventKey: string;
  code: string;
  exDate: string;
  baseDate: string | null;
  payDate: string | null;
  /** decimal string in 元, or null */
  dividendPerUnit: string | null;
  /** micros integer, or null */
  dividendMicros: number | null;
  eligibleSharesOverride: number | null;
  shares: number;
  status: EventStatus;
  source: string;
  sourcePriority: number;
  manualLocked: boolean;
  manualNote: string | null;
  observations?: SourceObservationDTO[];
}

export interface SourceObservationDTO {
  sourceKind: string;
  sourcePriority: number;
  sourceUrl: string | null;
  exDate: string | null;
  baseDate: string | null;
  payDate: string | null;
  /** decimal string in 元 */
  dividendPerUnit: string | null;
  dividendMicros: number | null;
  sourceObservedAt: string;
}

export interface DashboardSummary {
  totalGrossAmount: string | null;
  /** micros */
  totalGrossMicros: number | null;
  etfCount: number;
  instrumentCount: number;
  pendingCount: number;
  lastSuccessfulSync: string | null;
}

export interface DashboardRow {
  eventKey: string;
  instrumentId: string;
  market: WatchlistMarket;
  kind: WatchlistKind;
  code: string;
  displayName: string;
  exDate: string;
  baseDate: string | null;
  payDate: string | null;
  shares: number;
  sharesBasis: "event_override" | "current_portfolio_estimate";
  /** decimal string in 元 */
  dividendPerUnit: string | null;
  /** "shares × perUnit" */
  formula: string;
  /** decimal string in 元 */
  estimatedGrossAmount: string | null;
  previousClose: string | null;
  currentTrade: string | null;
  tradeDate: string | null;
  tradeTime: string | null;
  priceStatus: string | null;
  priceStale: boolean;
  sourceLabel: string;
  sourceKind: string;
  status: EventStatus;
  manualLocked: boolean;
}

export interface DashboardResponse {
  period: { year: number; month: number | null; day?: number } | null;
  summary: DashboardSummary;
  items: DashboardRow[];
}

export interface WidgetItemDTO {
  instrumentId: string;
  market: WatchlistMarket;
  kind: WatchlistKind;
  code: string;
  name: string;
  shares: string;
  sharesBasis: "event_override" | "current_portfolio_estimate";
  dividendPerUnit: string | null;
  payDate: string | null;
  estimatedGrossAmount: string | null;
  previousClose: string | null;
  currentTrade: string | null;
  tradeDate: string | null;
  tradeTime: string | null;
  priceStatus: string | null;
  priceStale: boolean;
  source: { kind: string; label: string };
  hasConflict: boolean;
}

export interface WidgetResponseDTO {
  status: "ok" | "pending_amount" | "no_announced_payout" | "source_stale" | "source_error";
  period: { year: number; month: number; timezone: string };
  items: WidgetItemDTO[];
  totalGrossAmount: string | null;
  display: { title: string; total: string | null; lines: string[]; compact: string | null };
  freshness?: { stale: boolean; lastSuccessfulSync: string | null };
  generatedAt: string;
  appearance?: WidgetAppearanceDTO;
}

export type WidgetTheme = "ocean" | "midnight" | "sunset" | "forest";
export type WidgetBackgroundMode = "solid" | "gradient";
export type WidgetSortMode = "dividend_desc" | "random" | "price_desc" | "featured";

export interface WidgetAppearanceDTO {
  theme: WidgetTheme;
  mode: WidgetBackgroundMode;
  startColor: string;
  endColor: string;
  sortMode: WidgetSortMode;
  featuredInstrumentId: string | null;
  refreshMinutes: number;
  updatedAt: string | null;
}

export interface WidgetAppearanceUpdateDTO {
  mode: WidgetBackgroundMode;
  startColor: string;
  endColor: string;
  sortMode: WidgetSortMode;
  featuredInstrumentId: string | null;
  refreshMinutes: number;
}

export interface DividendsResponse {
  items: CanonicalEventDTO[];
}

export interface ManualVerifyPayload {
  eventKey: string;
  payDate?: string | null;
  dividendPerUnit?: string | null;
  eligibleShares?: number | null;
  note?: string | null;
}

export interface SyncRunDTO {
  id: number;
  triggerKind: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "partial" | "failed";
  mappingRowsRead: number;
  scheduleRowsRead: number;
  dividendRowsRead: number;
  observationsApplied: number;
  eventsChanged: number;
  newestSourceDate: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface SyncRunsResponse {
  items: SyncRunDTO[];
}

export interface SourceStatusDTO {
  sourceKind: string;
  sourceLabel: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastHttpStatus: number | null;
  newestSourceDate: string | null;
  status: "never" | "ok" | "stale" | "error";
  errorMessage: string | null;
}

export interface SourcesStatusResponse {
  sources: SourceStatusDTO[];
  lastSuccessfulSync: string | null;
}

export interface SyncScheduleDTO {
  dailyTime: string;
  timezone: "Asia/Taipei";
  updatedAt: string | null;
}

export interface FinmindTokenStatusDTO {
  configured: boolean;
  source: "database" | "environment" | "none";
  updatedAt: string | null;
  storedTokenInvalid: boolean;
}

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

export const api = {
  getAuthConfig(): Promise<AuthConfigDTO> {
    return request<AuthConfigDTO>("/auth/config");
  },

  getRegistrationPolicy(): Promise<RegistrationPolicyDTO> {
    return request<RegistrationPolicyDTO>("/auth/registration-policy");
  },

  updateRegistrationPolicy(allowRegistration: boolean): Promise<RegistrationPolicyDTO> {
    return request<RegistrationPolicyDTO>("/auth/registration-policy", {
      method: "PUT",
      body: { allowRegistration },
    });
  },

  login(payload: { username: string; password: string; remember: boolean }): Promise<{ user: AuthUserDTO }> {
    return request<{ user: AuthUserDTO }>("/auth/login", { method: "POST", body: payload });
  },

  register(payload: { username: string; displayName: string; password: string; remember: boolean }): Promise<{ user: AuthUserDTO }> {
    return request<{ user: AuthUserDTO }>("/auth/register", { method: "POST", body: payload });
  },

  me(): Promise<{ user: AuthUserDTO }> {
    return request<{ user: AuthUserDTO }>("/auth/me");
  },

  logout(): Promise<{ ok: true }> {
    return request<{ ok: true }>("/auth/logout", { method: "POST" });
  },

  changePassword(payload: { currentPassword: string; newPassword: string }): Promise<{ ok: true }> {
    return request<{ ok: true }>("/auth/change-password", { method: "POST", body: payload });
  },

  setPassword(newPassword: string): Promise<{ ok: true }> {
    return request<{ ok: true }>("/auth/set-password", { method: "POST", body: { newPassword } });
  },

  googleLogin(credential: string, remember: boolean): Promise<{ user: AuthUserDTO }> {
    return request<{ user: AuthUserDTO }>("/auth/google", {
      method: "POST",
      body: { credential, remember },
    });
  },

  getWidgetCredential(): Promise<{ maskedToken: string; rotatedAt: string }> {
    return request<{ maskedToken: string; rotatedAt: string }>("/auth/widget-token");
  },

  revealWidgetToken(password: string): Promise<{ token: string }> {
    return request<{ token: string }>("/auth/widget-token/reveal", {
      method: "POST",
      body: { password },
    });
  },

  rotateWidgetToken(password: string): Promise<{ token: string }> {
    return request<{ token: string }>("/auth/widget-token/rotate", {
      method: "POST",
      body: { password },
    });
  },

  getDashboard(year?: number, month?: number, all?: boolean, day?: number): Promise<DashboardResponse> {
    const query: Record<string, number | string> = {};
    if (all) query.all = '1';
    if (year != null) query.year = year;
    if (month != null) query.month = month;
    if (day != null) query.day = day;
    return request<DashboardResponse>("/dashboard", { query });
  },

  getWidgetCurrent(year?: number, month?: number): Promise<WidgetResponseDTO> {
    return request<WidgetResponseDTO>("/widget/current", {
      query: { year, month },
    });
  },

  getWidgetSettings(): Promise<WidgetAppearanceDTO> {
    return request<WidgetAppearanceDTO>("/widget/settings");
  },

  updateWidgetSettings(appearance: WidgetAppearanceUpdateDTO): Promise<WidgetAppearanceDTO> {
    return request<WidgetAppearanceDTO>("/widget/settings", {
      method: "PUT",
      body: appearance,
    });
  },

  async testWidgetConnection(baseUrl: string, widgetToken: string): Promise<void> {
    const base = baseUrl.trim() || window.location.origin;
    const url = new URL('/api/v1/widget/current', base.endsWith('/') ? base : `${base}/`);
    const resp = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${widgetToken}` },
    });
    if (!resp.ok) {
      const body: unknown = await resp.json().catch(() => null);
      const errorMessage = body && typeof body === "object" && "error" in body
        ? String(body.error)
        : `HTTP ${resp.status}`;
      throw new ApiError(
        errorMessage,
        resp.status,
        url.pathname,
        body,
      );
    }
  },

  getWatchlist(): Promise<WatchlistResponse> {
    return request<WatchlistResponse>("/watchlist");
  },

  getPrices(): Promise<PricesResponse> {
    return request<PricesResponse>("/prices");
  },

  searchInstruments(query: string): Promise<InstrumentSearchResponse> {
    return request<InstrumentSearchResponse>("/instruments/search", { query: { query } });
  },

  addWatchlistItem(payload: CreateWatchlistItemPayload): Promise<WatchlistMutationResponse> {
    return request<WatchlistMutationResponse>("/watchlist", {
      method: "POST",
      body: payload,
    });
  },

  updateWatchlistItem(
    instrumentId: string,
    payload: UpdateWatchlistItemPayload,
  ): Promise<WatchlistMutationResponse> {
    return request<WatchlistMutationResponse>(`/watchlist/${encodeURIComponent(instrumentId)}`, {
      method: "PATCH",
      body: payload,
    });
  },

  archiveWatchlistItem(instrumentId: string): Promise<{ instrumentId: string; status: "archived" }> {
    return request<{ instrumentId: string; status: "archived" }>(
      `/watchlist/${encodeURIComponent(instrumentId)}`,
      { method: "DELETE" },
    );
  },

  getDividends(year?: number, month?: number, code?: string): Promise<DividendsResponse> {
    const query: Record<string, number | string> = {};
    if (year != null) query.year = year;
    if (month != null) query.month = month;
    if (code) query.code = code;
    return request<DividendsResponse>("/dividends", { query });
  },

  manualVerify(payload: ManualVerifyPayload): Promise<{ ok: true }> {
    return request<{ ok: true }>("/dividends/manual", {
      method: "POST",
      body: payload,
    });
  },

  unlockEvent(eventKey: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/dividends/${encodeURIComponent(eventKey)}/unlock`, {
      method: "POST",
    });
  },

  triggerSync(): Promise<{
    runId: number;
    status: string;
    finmindRows: number;
    observationsApplied: number;
    eventsChanged: number;
    errors: string[];
    prices: { outcome: string; selected: number; persisted: number; errors: string[] };
  }> {
    return request("/sync", { method: "POST" });
  },

  getSyncRuns(limit = 50): Promise<SyncRunsResponse> {
    return request<SyncRunsResponse>("/sync/runs", { query: { limit } });
  },

  getSourcesStatus(): Promise<SourcesStatusResponse> {
    return request<SourcesStatusResponse>("/sources/status");
  },

  getSyncSettings(): Promise<SyncScheduleDTO> {
    return request<SyncScheduleDTO>("/sync/settings");
  },

  updateSyncSettings(dailyTime: string): Promise<SyncScheduleDTO> {
    return request<SyncScheduleDTO>("/sync/settings", {
      method: "PUT",
      body: { dailyTime },
    });
  },

  getFinmindTokenStatus(): Promise<FinmindTokenStatusDTO> {
    return request<FinmindTokenStatusDTO>("/sync/finmind-token");
  },

  updateFinmindToken(token: string): Promise<FinmindTokenStatusDTO> {
    return request<FinmindTokenStatusDTO>("/sync/finmind-token", {
      method: "PUT",
      body: { token },
    });
  },

  deleteFinmindToken(): Promise<FinmindTokenStatusDTO> {
    return request<FinmindTokenStatusDTO>("/sync/finmind-token", {
      method: "DELETE",
    });
  },
};
