import configManager from './index';
import { ConfigModelProvider } from './types';

const fromEnv = (key: string) => {
  const raw = process.env[key];
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

type PromptTemplateSource = 'env' | 'config' | 'default';
type PromptTemplateConfig = {
  value: string;
  source: PromptTemplateSource;
};

const resolvePromptTemplate = (
  envKey: string,
  configPath: string,
): PromptTemplateConfig => {
  const envValue = fromEnv(envKey);
  if (envValue) {
    return { value: envValue, source: 'env' };
  }

  const configValue = String(configManager.getConfig(configPath, '') || '').trim();
  if (configValue) {
    return { value: configValue, source: 'config' };
  }

  return { value: '', source: 'default' };
};

export const getConfiguredModelProviders = (): ConfigModelProvider[] => {
  return configManager.getConfig('modelProviders', []);
};

export const getConfiguredModelProviderById = (
  id: string,
): ConfigModelProvider | undefined => {
  return getConfiguredModelProviders().find((p) => p.id === id) ?? undefined;
};

const parseMultiUrls = (raw: string) =>
  raw
    .split(/[\n,]/g)
    .map((x) => x.trim())
    .filter(Boolean);

const deriveLocalSearxngFallbacks = (rawUrl: string): string[] => {
  try {
    const parsed = new URL(rawUrl);
    const isLocalHost =
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (!isLocalHost) return [];

    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    const path = normalizedPath || '';

    const variants: string[] = [];
    const ports =
      parsed.port === '8080'
        ? ['8081']
        : parsed.port === '8081'
          ? ['8080']
          : ['8080', '8081'];

    for (const port of ports) {
      variants.push(`${parsed.protocol}//localhost:${port}${path}`);
      variants.push(`${parsed.protocol}//127.0.0.1:${port}${path}`);
    }

    return variants;
  } catch {
    return [];
  }
};

export const getSearxngURLs = () => {
  const fromListEnv = fromEnv('SEARXNG_API_URLS');
  const fromSingleEnv = fromEnv('SEARXNG_API_URL');
  const fromConfig = String(
    configManager.getConfig('search.searxngURL', '') || '',
  ).trim();

  const raw = fromListEnv || fromSingleEnv || fromConfig;
  const values = parseMultiUrls(raw);
  const expandedValues = values.flatMap((url) => [
    url,
    ...deriveLocalSearxngFallbacks(url),
  ]);

  const seen = new Set<string>();
  return expandedValues
    .map((url) => url.replace(/\/+$/, ''))
    .filter((url) => {
      const key = url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const getSearxngURL = () => getSearxngURLs()[0] ?? '';

export const getTavilyApiKey = () =>
  fromEnv('TAVILY_API_KEY') ||
  String(configManager.getConfig('search.tavilyApiKey', '') || '').trim();

export const getTavilyMaxResults = () => {
  const raw = fromEnv('TAVILY_MAX_RESULTS') || configManager.getConfig('search.tavilyMaxResults', 6);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 6;
  return Math.max(1, Math.min(10, Math.floor(parsed)));
};

export const getOpenbbMcpEnabled = () => {
  const env = fromEnv('OPENBB_MCP_ENABLED');
  const raw = env || configManager.getConfig('economy.openbbMcpEnabled', false);
  return raw === true || String(raw).toLowerCase() === 'true';
};

export const getOpenbbMcpUrl = () =>
  String(
    fromEnv('OPENBB_MCP_URL') ||
      configManager.getConfig('economy.openbbMcpUrl', '') ||
      '',
  ).trim();

export const getOpenbbMcpApiKey = () =>
  String(
    fromEnv('OPENBB_MCP_API_KEY') ||
      configManager.getConfig('economy.openbbMcpApiKey', '') ||
      '',
  ).trim();

export const getOpenbbMcpPreferredTools = () =>
  String(
    fromEnv('OPENBB_MCP_PREFERRED_TOOLS') ||
      configManager.getConfig('economy.openbbMcpPreferredTools', '') ||
      '',
  )
    .split(/[\n,]/g)
    .map((x) => x.trim())
    .filter(Boolean);

export const getOpenbbMcpMaxTools = () => {
  const raw =
    fromEnv('OPENBB_MCP_MAX_TOOLS') ||
    configManager.getConfig('economy.openbbMcpMaxTools', 3) ||
    3;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(6, Math.floor(parsed)));
};

const getMiniMaxProviderConfig = () => {
  const providers = getConfiguredModelProviders();
  const provider = providers.find((p) => p.type === 'minimax') ??
    providers.find((p) => {
      if (p.type !== 'openai') return false;
      const baseURL = String(p.config?.baseURL || '').toLowerCase();
      return baseURL.includes('minimaxi.com');
    });

  return provider;
};

export const getMiniMaxApiKey = () =>
  (() => {
    const raw = String(
      fromEnv('MINIMAX_API_KEY') ||
        getMiniMaxProviderConfig()?.config?.apiKey ||
        '',
    ).trim();
    if (!raw || raw === '********') return '';
    return raw;
  })();

export const getMiniMaxBaseUrl = () =>
  String(
    fromEnv('MINIMAX_BASE_URL') ||
      getMiniMaxProviderConfig()?.config?.baseURL ||
      'https://api.minimaxi.com/v1',
  )
    .trim()
    .replace(/\/+$/, '');

export const getMiniMaxDefaultModel = () =>
  String(
    fromEnv('MINIMAX_DEFAULT_MODEL') ||
      getMiniMaxProviderConfig()?.chatModels?.[0]?.key ||
      'MiniMax-M2.7',
  ).trim();

export const getMiniMaxMcpEnabled = () => {
  const env = fromEnv('MINIMAX_MCP_ENABLED');
  const raw = env || configManager.getConfig('economy.minimaxMcpEnabled', false);
  return raw === true || String(raw).toLowerCase() === 'true';
};

export const getMiniMaxMcpUrl = () =>
  String(
    fromEnv('MINIMAX_MCP_URL') ||
      configManager.getConfig('economy.minimaxMcpUrl', '') ||
      '',
  ).trim();

export const getMiniMaxMcpApiKey = () =>
  String(
    fromEnv('MINIMAX_MCP_API_KEY') ||
      configManager.getConfig('economy.minimaxMcpApiKey', '') ||
      '',
  ).trim();

export const getMiniMaxMcpPreferredTools = () =>
  String(
    fromEnv('MINIMAX_MCP_PREFERRED_TOOLS') ||
      configManager.getConfig('economy.minimaxMcpPreferredTools', '') ||
      '',
  )
    .split(/[\n,]/g)
    .map((x) => x.trim())
    .filter(Boolean);

export const getMiniMaxMcpMaxTools = () => {
  const raw =
    fromEnv('MINIMAX_MCP_MAX_TOOLS') ||
    configManager.getConfig('economy.minimaxMcpMaxTools', 3) ||
    3;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(6, Math.floor(parsed)));
};

export const getTushareToken = () =>
  (() => {
    const raw = String(
      fromEnv('TUSHARE_TOKEN') ||
        fromEnv('TUSHARE_API_TOKEN') ||
        configManager.getConfig('economy.tushareToken', '') ||
        '',
    ).trim();

    // Mask placeholder should never be treated as a real token.
    if (!raw || raw === '********') return '';

    // Users sometimes paste "Tushare:xxxx" or wrap in quotes.
    const dequoted = raw.replace(/^['"]|['"]$/g, '').trim();
    const withoutPrefix = dequoted
      .replace(/^tushare(?:\s*pro)?\s*[:：]\s*/i, '')
      .trim();

    // Accept common token lengths and extract from pasted prefixed strings.
    const match = withoutPrefix.match(/[0-9a-f]{32,64}/i);
    return (match?.[0] ?? withoutPrefix).trim();
  })();

export const getFundUniverseLocalPath = () =>
  String(
    fromEnv('FUND_UNIVERSE_LOCAL_PATH') ||
      configManager.getConfig('economy.fundUniverseLocalPath', '') ||
      '',
  ).trim();

export const getFundUniverseCompanyFilter = (): string[] =>
  String(
    fromEnv('FUND_UNIVERSE_COMPANY_FILTER') ||
      configManager.getConfig('economy.fundUniverseCompanyFilter', '') ||
      '',
  )
    .split(/[\n,]/g)
    .map((x) => x.trim())
    .filter(Boolean);

export const getEventImpactMarketViewPromptTemplate = () =>
  getEventImpactMarketViewPromptTemplateConfig().value;

export const getEventImpactMarketViewPromptTemplateConfig = () =>
  resolvePromptTemplate(
    'EVENT_IMPACT_MARKET_VIEW_PROMPT_TEMPLATE',
    'economy.eventImpactMarketViewPromptTemplate',
  );

export const getEventImpactFundPanelPromptTemplate = () =>
  getEventImpactFundPanelPromptTemplateConfig().value;

export const getEventImpactFundPanelPromptTemplateConfig = () =>
  resolvePromptTemplate(
    'EVENT_IMPACT_FUND_PANEL_PROMPT_TEMPLATE',
    'economy.eventImpactFundPanelPromptTemplate',
  );

export const getPortfolioCheckAgentPromptTemplate = () =>
  getPortfolioCheckAgentPromptTemplateConfig().value;

export const getPortfolioCheckAgentPromptTemplateConfig = () =>
  resolvePromptTemplate(
    'PORTFOLIO_CHECK_AGENT_PROMPT_TEMPLATE',
    'economy.portfolioCheckAgentPromptTemplate',
  );

export const getPortfolioCheckAgentSystemPrompt = () =>
  getPortfolioCheckAgentSystemPromptConfig().value;

export const getPortfolioCheckAgentSystemPromptConfig = () =>
  resolvePromptTemplate(
    'PORTFOLIO_CHECK_AGENT_SYSTEM_PROMPT',
    'economy.portfolioCheckAgentSystemPrompt',
  );
