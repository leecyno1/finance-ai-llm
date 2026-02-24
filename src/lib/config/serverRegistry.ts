import configManager from './index';
import { ConfigModelProvider } from './types';

export const getConfiguredModelProviders = (): ConfigModelProvider[] => {
  return configManager.getConfig('modelProviders', []);
};

export const getConfiguredModelProviderById = (
  id: string,
): ConfigModelProvider | undefined => {
  return getConfiguredModelProviders().find((p) => p.id === id) ?? undefined;
};

export const getSearxngURL = () =>
  configManager.getConfig('search.searxngURL', '');

export const getTavilyApiKey = () =>
  String(configManager.getConfig('search.tavilyApiKey', '') || '').trim();

export const getTavilyMaxResults = () => {
  const raw = configManager.getConfig('search.tavilyMaxResults', 6);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 6;
  return Math.max(1, Math.min(10, Math.floor(parsed)));
};

export const getTushareToken = () =>
  (() => {
    const raw = String(
      configManager.getConfig('economy.tushareToken', '') ||
        process.env.TUSHARE_TOKEN ||
        process.env.TUSHARE_API_TOKEN ||
        '',
    ).trim();

    // Mask placeholder should never be treated as a real token.
    if (!raw || raw === '********') return '';

    // Users sometimes paste "Tushare:xxxx" or wrap in quotes.
    const dequoted = raw.replace(/^['"]|['"]$/g, '').trim();
    const withoutPrefix = dequoted.replace(/^tushare\s*:\s*/i, '').trim();

    // TuShare tokens are typically 64-hex chars; if a longer string contains it, extract.
    const match = withoutPrefix.match(/[0-9a-f]{64}/i);
    return (match?.[0] ?? withoutPrefix).trim();
  })();
