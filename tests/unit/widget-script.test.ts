import { describe, expect, it } from 'vitest';

import {
  WIDGET_BASE_URL_PLACEHOLDER,
  WIDGET_INSTALLATION_ID_PLACEHOLDER,
  WIDGET_TOKEN_PLACEHOLDER,
  customizeWidgetScript,
  normalizeWidgetDownloadConfig,
} from '../../web/lib/widget-script';

const installationId = '00000000-0000-4000-8000-000000000000';

describe('personalised Scriptable download', () => {
  it('normalizes an origin and requires token plus canonical UUID', () => {
    expect(normalizeWidgetDownloadConfig(
      ' https://worker.example.test/// ',
      ' widget-read-token ',
      ` ${installationId} `,
    )).toEqual({
      baseUrl: 'https://worker.example.test',
      widgetToken: 'widget-read-token',
      installationId,
    });

    expect(() => normalizeWidgetDownloadConfig('not-a-url', 'token', installationId)).toThrow('網址');
    expect(() => normalizeWidgetDownloadConfig('https://example.test/path', 'token', installationId)).toThrow('Origin');
    expect(() => normalizeWidgetDownloadConfig('https://example.test', '', installationId)).toThrow('Widget Token');
    expect(() => normalizeWidgetDownloadConfig('https://example.test', 'token', 'not-a-uuid')).toThrow('UUID');
  });

  it('safely embeds all settings and leaves no placeholder behind', () => {
    const source = [
      `const base = ${JSON.stringify(WIDGET_BASE_URL_PLACEHOLDER)};`,
      `const token = ${JSON.stringify(WIDGET_TOKEN_PLACEHOLDER)};`,
      `const installationId = ${JSON.stringify(WIDGET_INSTALLATION_ID_PLACEHOLDER)};`,
    ].join('\n');
    const result = customizeWidgetScript(source, {
      baseUrl: 'https://worker.example.test',
      widgetToken: 'read-only-"quoted"-token',
      installationId,
    });

    expect(result).toContain(JSON.stringify('https://worker.example.test'));
    expect(result).toContain(JSON.stringify('read-only-"quoted"-token'));
    expect(result).toContain(JSON.stringify(installationId));
    expect(result).not.toContain(WIDGET_BASE_URL_PLACEHOLDER);
    expect(result).not.toContain(WIDGET_TOKEN_PLACEHOLDER);
    expect(result).not.toContain(WIDGET_INSTALLATION_ID_PLACEHOLDER);
  });

  it('rejects a generic bundle missing any required placeholder', () => {
    expect(() => customizeWidgetScript('console.log("old bundle")', {
      baseUrl: 'https://worker.example.test',
      widgetToken: 'token',
      installationId,
    })).toThrow('佔位符');
  });
});
