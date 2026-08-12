/**
 * Configuration management for the Scriptable widget.
 *
 * Personalised downloads carry all three values in the JavaScript bundle. A
 * personalised run therefore never consults Scriptable Keychain: the embedded
 * values are authoritative and cannot be replaced from the setup menu.
 * Generic scripts may still be configured manually using the three current
 * namespaced keys below.
 */

export const KEY_BASE_URL = 'dividendTracker.manual.v2.baseUrl';
export const KEY_WIDGET_TOKEN = 'dividendTracker.manual.v2.widgetToken';
export const KEY_INSTALLATION_ID = 'dividendTracker.manual.v2.installationId';

export interface WidgetConfig {
  baseUrl: string;
  widgetToken: string;
  installationId: string;
}

// The generic template deliberately has no deployment URL. A manually run
// script must be given its own origin before it can call the API.
const DEFAULT_BASE_URL = 'https://example.invalid';

/** Values replaced by the dashboard's download flow. */
const EMBEDDED_BASE_URL = '__DIVIDEND_TRACKER_BASE_URL__';
const EMBEDDED_WIDGET_TOKEN = '__DIVIDEND_TRACKER_WIDGET_TOKEN__';
const EMBEDDED_INSTALLATION_ID = '__DIVIDEND_TRACKER_INSTALLATION_ID__';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function isFullOrigin(value: string): boolean {
  // Keep this module compatible with Scriptable's non-DOM TypeScript lib. The
  // dashboard normalizer performs the authoritative URL parsing before embed.
  return /^https:\/\/[^\s/?#:@]+(?::\d+)?$/.test(value)
    || /^http:\/\/[^\s/?#:@]+(?::\d+)?$/.test(value)
    || /^https?:\/\/\[[0-9A-Fa-f:]+\](?::\d+)?$/.test(value);
}

/**
 * Return the three embedded values when this is a personalised download.
 * Invalid/incomplete placeholders are treated as a generic template.
 */
export function embeddedConfig(): WidgetConfig | null {
  return resolveEmbeddedConfig(EMBEDDED_BASE_URL, EMBEDDED_WIDGET_TOKEN, EMBEDDED_INSTALLATION_ID);
}

/** Pure helper used by the runtime tests and by the bundle resolver. */
export function resolveEmbeddedConfig(
  embeddedBaseUrl: string,
  embeddedWidgetToken: string,
  embeddedInstallationId: string,
): WidgetConfig | null {
  if (
    !embeddedBaseUrl
    || !embeddedWidgetToken
    || !embeddedInstallationId
    || embeddedBaseUrl.startsWith('__DIVIDEND_TRACKER_')
    || embeddedWidgetToken.startsWith('__DIVIDEND_TRACKER_')
    || embeddedInstallationId.startsWith('__DIVIDEND_TRACKER_')
  ) return null;

  const baseUrl = embeddedBaseUrl.replace(/\/+$/, '');
  if (!isFullOrigin(baseUrl) || !embeddedWidgetToken.trim() || !isUuid(embeddedInstallationId)) return null;
  return { baseUrl, widgetToken: embeddedWidgetToken, installationId: embeddedInstallationId };
}

/** True when this bundle contains a complete dashboard-personalised config. */
export function hasEmbeddedConfig(): boolean {
  return embeddedConfig() !== null;
}

/** Resolve embedded values without consulting Scriptable storage. */
export function loadConfigForEmbedded(embedded: WidgetConfig | null): WidgetConfig | null {
  return embedded;
}

/**
 * Load the current configuration. Embedded values are checked first and are
 * returned directly; this branch deliberately performs no Keychain calls.
 */
export function loadConfig(): WidgetConfig | null {
  const embedded = embeddedConfig();
  const embeddedResult = loadConfigForEmbedded(embedded);
  if (embeddedResult) return embeddedResult;

  const hasBaseUrl = Keychain.contains(KEY_BASE_URL);
  const hasToken = Keychain.contains(KEY_WIDGET_TOKEN);
  const hasInstallationId = Keychain.contains(KEY_INSTALLATION_ID);
  const baseUrl = hasBaseUrl ? Keychain.get(KEY_BASE_URL) : undefined;
  const widgetToken = hasToken ? Keychain.get(KEY_WIDGET_TOKEN) : undefined;
  const installationId = hasInstallationId ? Keychain.get(KEY_INSTALLATION_ID) : undefined;

  if (baseUrl && widgetToken && installationId) {
    return { baseUrl, widgetToken, installationId };
  }
  return null;
}

/** Persist generic/manual setup values. Personalised bundles are immutable. */
export function saveConfig(cfg: WidgetConfig): void {
  if (hasEmbeddedConfig()) return;
  Keychain.set(KEY_BASE_URL, cfg.baseUrl);
  Keychain.set(KEY_WIDGET_TOKEN, cfg.widgetToken);
  Keychain.set(KEY_INSTALLATION_ID, cfg.installationId);
}

/** Remove only current manual configuration keys. */
export function clearConfig(): void {
  if (hasEmbeddedConfig()) return;
  if (Keychain.contains(KEY_BASE_URL)) Keychain.remove(KEY_BASE_URL);
  if (Keychain.contains(KEY_WIDGET_TOKEN)) Keychain.remove(KEY_WIDGET_TOKEN);
  if (Keychain.contains(KEY_INSTALLATION_ID)) Keychain.remove(KEY_INSTALLATION_ID);
}

// ---------------------------------------------------------------------------
// Scriptable text entry is provided by native Alert fields.
// ---------------------------------------------------------------------------

async function promptText(
  title: string,
  message: string,
  defaultValue: string,
  secure = false,
): Promise<string | null> {
  const prompt = new Alert();
  prompt.title = title;
  prompt.message = message;
  if (secure) prompt.addSecureTextField('value', defaultValue);
  else prompt.addTextField('value', defaultValue);
  prompt.addAction('確認');
  prompt.addCancelAction('取消');
  const tapped = await prompt.present();
  return tapped === 0 ? prompt.textFieldValue(0) : null;
}

/** Run the optional in-app setup menu for generic/manual scripts. */
export async function runSetupMenu(
  previewWidgetFamily?: (family: 'medium' | 'accessoryRectangular') => Promise<void>,
  testApiWithConfig?: (cfg: WidgetConfig) => Promise<void>,
  clearCacheForConfig?: (cfg: WidgetConfig) => void,
): Promise<WidgetConfig | null> {
  const existing = loadConfig();
  const menu = new Alert();
  menu.title = 'DividendTracker Widget';
  menu.message = '選擇設定、預覽或清除本機設定。';
  menu.addAction('1. 設定連線');
  menu.addAction('2. 預覽鎖定畫面');
  menu.addAction('3. 預覽主畫面');
  menu.addAction('4. 測試 API');
  menu.addAction('5. 清除快取');
  menu.addAction('6. 重設設定');
  menu.addCancelAction('7. 取消');

  const choice = await menu.present();
  switch (choice) {
    case 0:
      return setupFlow(testApiWithConfig);
    case 1:
      if (previewWidgetFamily) await previewWidgetFamily('accessoryRectangular');
      return existing;
    case 2:
      if (previewWidgetFamily) await previewWidgetFamily('medium');
      return existing;
    case 3:
      await testApi(existing, testApiWithConfig);
      return existing;
    case 4:
      if (existing && clearCacheForConfig) await runClearCacheAction(() => clearCacheForConfig(existing));
      return existing;
    case 5: {
      const embedded = embeddedConfig();
      await runResetAction(() => { if (existing && clearCacheForConfig) clearCacheForConfig(existing); });
      return embedded ? existing : null;
    }
    default:
      return null;
  }
}

async function setupFlow(
  testApiWithConfig?: (cfg: WidgetConfig) => Promise<void>,
): Promise<WidgetConfig | null> {
  const embedded = embeddedConfig();
  if (embedded) {
    const alert = new Alert();
    alert.title = '此 Widget 已完成設定';
    alert.message = '個人化 Widget 設定不可在 Scriptable 內修改；請回到 Dashboard 重新下載。';
    alert.addAction('確認');
    await alert.present();
    return embedded;
  }

  const existing = loadConfig();
  const baseUrl = await promptText(
    'Widget Base URL',
    '請輸入完整的 http(s) Origin',
    existing?.baseUrl ?? DEFAULT_BASE_URL,
  );
  if (baseUrl === null) return null;
  const widgetToken = await promptText(
    'Widget Token',
    '請輸入 Widget Bearer Token',
    existing?.widgetToken ?? '',
    true,
  );
  if (widgetToken === null) return null;

  const cfg: WidgetConfig = {
    baseUrl: baseUrl.trim().replace(/\/+$/, ''),
    widgetToken: widgetToken.trim(),
    installationId: existing?.installationId ?? `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  };
  saveConfig(cfg);

  const alert = new Alert();
  alert.title = '設定完成';
  alert.message = '是否立即測試 Widget API？';
  alert.addAction('測試');
  alert.addCancelAction('稍後');
  if (await alert.present() === 0 && testApiWithConfig) await testApiWithConfig(cfg);
  return cfg;
}

async function testApi(
  existing: WidgetConfig | null,
  testApiWithConfig?: (cfg: WidgetConfig) => Promise<void>,
): Promise<void> {
  if (existing && testApiWithConfig) {
    await testApiWithConfig(existing);
    return;
  }
  const alert = new Alert();
  alert.title = '尚未設定';
  alert.message = '請先完成連線設定。';
  alert.addAction('確認');
  await alert.present();
}

/** Clear-cache action used by callers that own the cache module. */
export async function runClearCacheAction(clearCacheFn: () => void): Promise<void> {
  clearCacheFn();
  const alert = new Alert();
  alert.title = '快取已清除';
  alert.message = '此安裝的 Widget 快取已刪除。';
  alert.addAction('確認');
  await alert.present();
}

/** Reset action clears only current manual keys and leaves legacy data alone. */
export async function runResetAction(clearCacheFn: () => void): Promise<void> {
  if (embeddedConfig()) {
    clearCacheFn();
    const embeddedAlert = new Alert();
    embeddedAlert.title = '內嵌連線不會變更';
    embeddedAlert.message = '已清除此安裝的快取；若要更換連線，請回 Dashboard 重新下載。';
    embeddedAlert.addAction('確認');
    await embeddedAlert.present();
    return;
  }
  clearConfig();
  clearCacheFn();
  const alert = new Alert();
  alert.title = '設定已重設';
  alert.message = '本機設定與此安裝的快取已清除。';
  alert.addAction('確認');
  await alert.present();
}
