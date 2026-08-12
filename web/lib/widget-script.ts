export const WIDGET_BASE_URL_PLACEHOLDER = '__DIVIDEND_TRACKER_BASE_URL__';
export const WIDGET_TOKEN_PLACEHOLDER = '__DIVIDEND_TRACKER_WIDGET_TOKEN__';
export const WIDGET_INSTALLATION_ID_PLACEHOLDER = '__DIVIDEND_TRACKER_INSTALLATION_ID__';

// A UUID is deliberately installation-scoped rather than tied to a user or account.
// Keep the textual form canonical so it is safe to use as part of a cache filename.
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface WidgetDownloadConfig {
  baseUrl: string;
  widgetToken: string;
  installationId: string;
}

export function normalizeWidgetDownloadConfig(
  baseUrl: string,
  widgetToken: string,
  installationId: string,
): WidgetDownloadConfig {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  const normalizedToken = widgetToken.trim();
  const normalizedInstallationId = installationId.trim();

  let parsed: URL;
  try {
    parsed = new URL(normalizedBaseUrl);
  } catch {
    throw new Error('Worker 網址格式無效。');
  }

  // A download is always tied to one complete origin. Paths, credentials,
  // query strings, fragments, and non-HTTP schemes are intentionally rejected.
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== normalizedBaseUrl) {
    throw new Error('Worker 網址必須是完整的 http(s) Origin。');
  }
  if (!normalizedToken) {
    throw new Error('請輸入 Widget Token。');
  }
  if (!CANONICAL_UUID_PATTERN.test(normalizedInstallationId)) {
    throw new Error('installationId 必須是標準 UUID。');
  }

  return {
    baseUrl: normalizedBaseUrl,
    widgetToken: normalizedToken,
    installationId: normalizedInstallationId,
  };
}

/** Inject connection settings into the built Scriptable bundle safely. */
export function customizeWidgetScript(
  source: string,
  config: WidgetDownloadConfig,
): string {
  const placeholders = [
    WIDGET_BASE_URL_PLACEHOLDER,
    WIDGET_TOKEN_PLACEHOLDER,
    WIDGET_INSTALLATION_ID_PLACEHOLDER,
  ] as const;

  // esbuild emits JSON string literals for the constants. Requiring each exact
  // literal prevents accepting an incompatible/old generic bundle.
  if (placeholders.some((placeholder) => !source.includes(JSON.stringify(placeholder)))) {
    throw new Error('Widget 模板缺少必要的個人化設定佔位符。');
  }

  const customized = source
    .replaceAll(JSON.stringify(WIDGET_BASE_URL_PLACEHOLDER), JSON.stringify(config.baseUrl))
    .replaceAll(JSON.stringify(WIDGET_TOKEN_PLACEHOLDER), JSON.stringify(config.widgetToken))
    .replaceAll(JSON.stringify(WIDGET_INSTALLATION_ID_PLACEHOLDER), JSON.stringify(config.installationId));

  if (placeholders.some((placeholder) => customized.includes(placeholder))) {
    throw new Error('Widget 模板仍含有未替換的佔位符。');
  }

  return customized;
}
