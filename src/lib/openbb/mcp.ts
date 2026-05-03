import { Document } from '@langchain/core/documents';
import {
  getOpenbbMcpApiKey,
  getOpenbbMcpEnabled,
  getOpenbbMcpMaxTools,
  getOpenbbMcpPreferredTools,
  getOpenbbMcpUrl,
} from '@/lib/config/serverRegistry';

type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

type JsonRpcResponse<T> = {
  jsonrpc?: string;
  id?: string | number | null;
  result?: T;
  error?: JsonRpcError;
};

type MCPToolSchema = {
  type?: string;
  properties?: Record<
    string,
    {
      type?: string;
      description?: string;
      enum?: unknown[];
      default?: unknown;
      const?: unknown;
      anyOf?: Array<{ enum?: unknown[]; const?: unknown }>;
      oneOf?: Array<{ enum?: unknown[]; const?: unknown }>;
      [key: string]: unknown;
    }
  >;
  required?: string[];
};

type MCPTool = {
  name: string;
  description?: string;
  inputSchema?: MCPToolSchema;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  };
};

type MCPCallResult = {
  content?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
};

type MCPPromptArgument = {
  name: string;
  description?: string;
  required?: boolean;
};

type MCPPrompt = {
  name: string;
  description?: string;
  arguments?: MCPPromptArgument[];
};

type MCPPromptGetResult = {
  description?: string;
  messages?: Array<{
    role?: string;
    content?:
      | string
      | {
          type?: string;
          text?: string;
          [key: string]: unknown;
        }
      | Array<{
          type?: string;
          text?: string;
          [key: string]: unknown;
        }>;
  }>;
};

type ProbeResult = {
  ok: boolean;
  reason?: 'disabled' | 'missing_url' | 'connect_failed' | 'no_tools' | 'unknown';
  message?: string;
  tools?: string[];
  prompts?: string[];
  hasMarketRouter?: boolean;
};

const MCP_CLIENT_INFO = {
  name: 'finance-ai-llm',
  version: '1.11.2',
};

const OPENBB_ROUTER_PROMPT = 'market-router';
const OPENBB_SKILL_PROMPT_PREFIX = 'skill-';
const OPENBB_MAX_PROVIDER_ATTEMPTS = 8;
const OPENBB_PROVIDER_PRIORITY = [
  'wind',
  'tushare',
  'polygon',
  'alpha_vantage',
] as const;
const OPENBB_KEYLESS_PROVIDER_PRIORITY = [
  'yfinance',
  'fred',
  'sec',
  'imf',
  'oecd',
  'econdb',
  'ecb',
  'government_us',
  'federal_reserve',
  'finra',
  'finviz',
  'famafrench',
  'multpl',
  'stockgrid',
  'wsj',
  'cboe',
  'deribit',
] as const;

const buildOpenbbEndpointCandidates = (rawEndpoint: string) => {
  const base = String(rawEndpoint || '').trim();
  if (!base) return [] as string[];

  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (url: string) => {
    const normalized = url.trim().replace(/\/+$/, '');
    if (!normalized) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  push(base);

  try {
    const parsed = new URL(base);
    const isLoopback =
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (isLoopback) {
      const hostVariant = new URL(parsed.toString());
      hostVariant.hostname = 'host.docker.internal';
      push(hostVariant.toString());
    }

    if (!/\/mcp\/?$/i.test(parsed.pathname || '')) {
      const withMcp = new URL(parsed.toString());
      withMcp.pathname = `${withMcp.pathname.replace(/\/+$/, '')}/mcp`;
      push(withMcp.toString());

      if (isLoopback) {
        const hostWithMcp = new URL(withMcp.toString());
        hostWithMcp.hostname = 'host.docker.internal';
        push(hostWithMcp.toString());
      }
    }
  } catch {
    // Keep original endpoint only when URL parsing fails.
  }

  return candidates;
};

const clampText = (text: string, maxLen = 240) =>
  text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;

const formatDateYYYYMMDD = (date: Date) => {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
};

const formatDateISO = (date: Date) => {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const parseTicker = (query: string) => {
  const q = query.trim();
  const cn = q.match(/\b(\d{6})\b/);
  if (cn?.[1]) {
    const code = cn[1];
    if (code.startsWith('6')) return `${code}.SH`;
    return `${code}.SZ`;
  }

  if (/标普|sp500|s&p/i.test(q)) return 'SPY';
  if (/纳指|nasdaq/i.test(q)) return 'QQQ';
  if (/道琼斯|dow/i.test(q)) return 'DIA';
  if (/黄金|gold/i.test(q)) return 'GLD';
  if (/原油|oil|wti|brent/i.test(q)) return 'USO';

  const us = q.match(/\b[A-Z]{1,5}\b/);
  if (us?.[0]) return us[0];

  return '';
};

const parseSseJson = (raw: string) => {
  const dataLines = raw
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6));
  if (!dataLines.length) {
    throw new Error('Invalid MCP SSE payload');
  }
  return JSON.parse(dataLines.join('\n'));
};

const normalizeToolOutput = (result: MCPCallResult): string => {
  const chunks: string[] = [];

  if (Array.isArray(result.content)) {
    result.content.forEach((item) => {
      if (typeof item?.text === 'string' && item.text.trim()) {
        chunks.push(clampText(item.text.trim(), 1500));
      }
    });
  }

  if (result.structuredContent !== undefined) {
    try {
      let structured = result.structuredContent;
      if (
        structured &&
        typeof structured === 'object' &&
        !Array.isArray(structured)
      ) {
        const obj = structured as Record<string, unknown>;
        const rows = Array.isArray(obj.results) ? obj.results : null;
        if (rows && rows.length > 25) {
          structured = {
            ...obj,
            results: rows.slice(0, 25),
            _truncated_results: rows.length - 25,
          };
        }
      }

      const json = clampText(JSON.stringify(structured, null, 2), 2500);
      if (json && json !== 'null' && json !== '{}') {
        chunks.push(`structuredContent:\n${json}`);
      }
    } catch {}
  }

  return chunks.join('\n\n').trim();
};

const normalizePromptOutput = (result: MCPPromptGetResult): string => {
  const chunks: string[] = [];
  if (result.description) {
    chunks.push(result.description.trim());
  }
  for (const msg of result.messages ?? []) {
    if (!msg?.content) continue;
    if (typeof msg.content === 'string') {
      if (msg.content.trim()) chunks.push(msg.content.trim());
      continue;
    }
    if (Array.isArray(msg.content)) {
      msg.content.forEach((item) => {
        if (typeof item?.text === 'string' && item.text.trim()) {
          chunks.push(item.text.trim());
        }
      });
      continue;
    }
    if (typeof msg.content?.text === 'string' && msg.content.text.trim()) {
      chunks.push(msg.content.text.trim());
    }
  }
  return chunks.join('\n\n').trim();
};

const extractProviderUsed = (
  result: MCPCallResult,
  argsUsed: Record<string, unknown>,
) => {
  const structured =
    result.structuredContent &&
    typeof result.structuredContent === 'object' &&
    !Array.isArray(result.structuredContent)
      ? (result.structuredContent as Record<string, unknown>)
      : null;

  const direct =
    structured?.provider ??
    structured?.provider_used ??
    structured?.providerName ??
    structured?.source;

  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  if (typeof argsUsed.provider === 'string' && argsUsed.provider.trim()) {
    return argsUsed.provider.trim();
  }
  return 'unknown';
};

const isMcpToolError = (result: MCPCallResult) => {
  if (result.isError) return true;
  if (!Array.isArray(result.content)) return false;
  return result.content.some((item) => {
    const text = typeof item?.text === 'string' ? item.text : '';
    return /error calling tool|http error|validation error|exception|traceback|mcp error/i.test(
      text,
    );
  });
};

class OpenbbMcpClient {
  private endpoint: string;
  private apiKey: string;
  private sessionId: string | null = null;
  private initialized = false;

  constructor(endpoint: string, apiKey = '') {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
  }

  private async request<T>(
    method: string,
    params?: Record<string, unknown>,
    opts?: { timeoutMs?: number; notification?: boolean },
  ): Promise<T | null> {
    const timeoutMs = opts?.timeoutMs ?? 12_000;
    const notification = opts?.notification === true;
    const id = notification ? undefined : `${Date.now()}-${Math.random()}`;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json,text/event-stream',
    };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const body = notification
        ? { jsonrpc: '2.0', method, params: params ?? {} }
        : { jsonrpc: '2.0', id, method, params: params ?? {} };
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: controller.signal,
      });

      const nextSession = res.headers.get('mcp-session-id');
      if (nextSession) this.sessionId = nextSession;

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`MCP HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
      }

      if (notification) {
        return null;
      }

      const contentType = res.headers.get('content-type') ?? '';
      const raw = await res.text();
      const json = (contentType.includes('text/event-stream')
        ? parseSseJson(raw)
        : JSON.parse(raw)) as JsonRpcResponse<T>;
      if (json.error) {
        throw new Error(`MCP error ${json.error.code}: ${json.error.message}`);
      }
      return (json.result as T) ?? null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async ensureInitialized() {
    if (this.initialized) return;

    try {
      await this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: MCP_CLIENT_INFO,
      });
      await this.request('notifications/initialized', {}, { notification: true });
    } catch {
      // Some MCP implementations allow direct tools/list without handshake.
    }

    this.initialized = true;
  }

  async listTools(): Promise<MCPTool[]> {
    await this.ensureInitialized();
    const result = await this.request<{ tools?: MCPTool[] }>('tools/list', {});
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async listPrompts(): Promise<MCPPrompt[]> {
    await this.ensureInitialized();
    const result = await this.request<{ prompts?: MCPPrompt[] }>(
      'prompts/list',
      {},
    );
    return Array.isArray(result?.prompts) ? result.prompts : [];
  }

  async getPrompt(name: string, args?: Record<string, unknown>) {
    await this.ensureInitialized();
    const result = await this.request<MCPPromptGetResult>('prompts/get', {
      name,
      arguments: args ?? {},
    });
    return result ?? {};
  }

  async callTool(name: string, args: Record<string, unknown>) {
    await this.ensureInitialized();
    const result = await this.request<MCPCallResult>('tools/call', {
      name,
      arguments: args,
    });
    return result ?? {};
  }
}

const scoreTool = (tool: MCPTool, query: string) => {
  const q = query.toLowerCase();
  const text = `${tool.name} ${tool.description ?? ''}`.toLowerCase();
  let score = 0;
  const needsFundamental = /基本面|财报|估值|盈利|报表|分红|拆股|split|dividend|earnings|valuation|fundamental|balance sheet|cash flow/i.test(
    query,
  );

  const topicMap: Array<{ trigger: RegExp; tokens: string[]; weight: number }> = [
    {
      trigger: /新闻|快讯|headline|news|event|舆情/i,
      tokens: ['news', 'headline', 'story', 'event', 'press', 'sentiment'],
      weight: 4,
    },
    {
      trigger: /宏观|gdp|cpi|ppi|pmi|就业|利率|通胀|economic|macro|inflation|growth/i,
      tokens: ['macro', 'econom', 'fred', 'gdp', 'cpi', 'inflation', 'calendar'],
      weight: 5,
    },
    {
      trigger: /股票|个股|美股|a股|港股|equity|stock|估值|财报|earnings|valuation/i,
      tokens: ['equity', 'stock', 'quote', 'price', 'historical'],
      weight: 5,
    },
    {
      trigger: /债券|国债|美债|收益率|bond|yield|rate/i,
      tokens: ['bond', 'yield', 'rates', 'treasury', 'fixed_income'],
      weight: 5,
    },
    {
      trigger: /外汇|汇率|fx|usd|cny|eur|jpy/i,
      tokens: ['fx', 'forex', 'currency', 'exchange_rate'],
      weight: 4,
    },
    {
      trigger: /期货|商品|原油|黄金|铜|futures|commodity|oil|gold|metal/i,
      tokens: ['futures', 'commodity', 'oil', 'gold', 'metals'],
      weight: 4,
    },
  ];

  topicMap.forEach((topic) => {
    if (!topic.trigger.test(q)) return;
    topic.tokens.forEach((token) => {
      if (text.includes(token)) score += topic.weight;
    });
  });

  const metricTokens = [
    'gdp',
    'cpi',
    'ppi',
    'pmi',
    'unemployment',
    'payroll',
    'yield',
    'rate',
    'inflation',
    'interest',
    'housing',
    'retail',
    'oil',
    'gold',
    'fx',
    'currency',
    'bond',
    'treasury',
    'dividend',
    'earnings',
    'valuation',
  ];
  metricTokens.forEach((token) => {
    if (q.includes(token) && text.includes(token)) score += 8;
  });

  if (/(查找|搜索|search|find|lookup)/i.test(query) && text.includes('search')) {
    score += 3;
  }
  if (/(价格|股价|报价|quote|price)/i.test(query) && /(quote|price)/.test(text)) {
    score += 3;
  }
  if (
    !needsFundamental &&
    /(fundamental|split|dividend|statement|balance|cash[_\s-]?flow)/.test(text)
  ) {
    score -= 20;
  }
  if (tool.annotations?.readOnlyHint !== false) score += 1;
  if (tool.annotations?.destructiveHint === true) score -= 100;

  return score;
};

const inferArgumentValue = (
  key: string,
  meta: { enum?: unknown[]; description?: string },
  query: string,
) => {
  const lowerKey = key.toLowerCase();
  const lowerDesc = String(meta.description ?? '').toLowerCase();
  const today = new Date();
  const yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);
  const ticker = parseTicker(query);

  if (Array.isArray(meta.enum) && meta.enum.length > 0) {
    return meta.enum[0];
  }
  if (/(query|question|keyword|search|text)/.test(lowerKey)) return query;
  if (/(symbol|symbols|ticker|tickers|asset|instrument|security)/.test(lowerKey)) {
    if (!ticker) return undefined;
    return /s$/.test(lowerKey) ? [ticker] : ticker;
  }
  if (/(start|from|begin)/.test(lowerKey) && /(date|time)/.test(lowerKey)) {
    if (/(yyyymmdd|trade)/.test(lowerDesc)) return formatDateYYYYMMDD(yearAgo);
    return formatDateISO(yearAgo);
  }
  if (/(end|to)/.test(lowerKey) && /(date|time)/.test(lowerKey)) {
    if (/(yyyymmdd|trade)/.test(lowerDesc)) return formatDateYYYYMMDD(today);
    return formatDateISO(today);
  }
  if (/(interval|frequency|freq)/.test(lowerKey)) return '1d';
  if (/(timeframe|period|window)/.test(lowerKey)) return '1Y';
  if (/(limit|size|count|topn)/.test(lowerKey)) return 20;
  if (/(country|region|market)/.test(lowerKey)) {
    if (/中国|a股|沪深|上证|深证/.test(query)) return 'china';
    if (/港股|香港/.test(query)) return 'hong_kong';
    return 'united_states';
  }
  if (/(base_currency|base|currency_from)/.test(lowerKey)) return 'USD';
  if (/(quote_currency|quote|currency_to)/.test(lowerKey)) return 'CNY';
  if (/(provider|source)/.test(lowerKey)) return 'auto';
  return undefined;
};

const toEnumStrings = (enumValues?: unknown[]) =>
  (enumValues ?? [])
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean);

const getProviderValues = (
  providerMeta:
    | {
        enum?: unknown[];
        const?: unknown;
        anyOf?: Array<{ enum?: unknown[]; const?: unknown }>;
        oneOf?: Array<{ enum?: unknown[]; const?: unknown }>;
      }
    | undefined,
) => {
  if (!providerMeta) return [] as string[];
  const values: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    if (typeof raw !== 'string') return;
    const val = raw.trim();
    if (!val) return;
    const key = val.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    values.push(val);
  };
  toEnumStrings(providerMeta.enum).forEach(push);
  push(providerMeta.const);
  (providerMeta.anyOf ?? []).forEach((item) => {
    toEnumStrings(item?.enum).forEach(push);
    push(item?.const);
  });
  (providerMeta.oneOf ?? []).forEach((item) => {
    toEnumStrings(item?.enum).forEach(push);
    push(item?.const);
  });
  return values;
};

const withProviderAutoDefault = (tool: MCPTool, args: Record<string, unknown>) => {
  const providerMeta = tool.inputSchema?.properties?.provider;
  if (!providerMeta) return args;
  if (typeof args.provider === 'string' && args.provider.trim()) return args;
  return { ...args, provider: 'auto' };
};

const buildToolArguments = (tool: MCPTool, query: string) => {
  const props = tool.inputSchema?.properties ?? {};
  const required = tool.inputSchema?.required ?? [];
  const args: Record<string, unknown> = {};

  for (const req of required) {
    const meta = props[req] ?? {};
    const val = inferArgumentValue(req, meta, query);
    if (val === undefined) return null;
    args[req] = val;
  }

  // Set useful optional args when available.
  [
    'start_date',
    'end_date',
    'limit',
    'query',
    'symbol',
    'ticker',
    'provider',
  ].forEach((k) => {
    if (args[k] !== undefined || !props[k]) return;
    const val = inferArgumentValue(
      k,
      {
        enum: props[k]?.enum,
        description: props[k]?.description,
      },
      query,
    );
    if (val !== undefined) args[k] = val;
  });

  return withProviderAutoDefault(tool, args);
};

const selectToolsForQuery = (
  tools: MCPTool[],
  query: string,
  preferredTools: string[],
  maxTools: number,
) => {
  const selected: MCPTool[] = [];
  const seen = new Set<string>();

  if (preferredTools.length > 0) {
    preferredTools.forEach((name) => {
      const tool =
        tools.find((t) => t.name === name) ||
        tools.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (tool && !seen.has(tool.name)) {
        seen.add(tool.name);
        selected.push(tool);
      }
    });
  }

  const ranked = [...tools]
    .map((tool) => ({ tool, score: scoreTool(tool, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.tool);

  for (const tool of ranked) {
    if (selected.length >= maxTools) break;
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    selected.push(tool);
  }

  return selected.slice(0, maxTools);
};

const getProviderCandidates = (tool: MCPTool, args: Record<string, unknown>) => {
  const providerMeta = tool.inputSchema?.properties?.provider;
  if (!providerMeta) return [null] as Array<string | null>;

  const enumProviders = getProviderValues(providerMeta);
  const enumSet = new Set(enumProviders.map((x) => x.toLowerCase()));
  const supports = (name: string) =>
    enumSet.size === 0 ? true : enumSet.has(name.toLowerCase());

  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (value?: string | null) => {
    if (!value) return;
    const normalized = value.trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(normalized);
  };

  // Team convention: first attempt with provider=auto.
  push('auto');
  OPENBB_KEYLESS_PROVIDER_PRIORITY.forEach((name) => {
    if (supports(name)) push(name);
  });
  OPENBB_PROVIDER_PRIORITY.forEach((name) => {
    if (supports(name)) push(name);
  });
  enumProviders.forEach((name) => push(name));
  if (typeof args.provider === 'string') push(args.provider);

  return (candidates.length ? candidates : [null]).slice(
    0,
    OPENBB_MAX_PROVIDER_ATTEMPTS,
  );
};

const callToolWithProviderFallback = async (
  client: OpenbbMcpClient,
  tool: MCPTool,
  baseArgs: Record<string, unknown>,
) => {
  const providerCandidates = getProviderCandidates(tool, baseArgs);
  const fallbackTrace: string[] = [];
  let lastError: Error | null = null;

  for (const provider of providerCandidates) {
    const attemptArgs =
      provider === null
        ? { ...baseArgs }
        : {
            ...baseArgs,
            provider,
          };

    try {
      const result = await client.callTool(tool.name, attemptArgs);
      if (isMcpToolError(result)) {
        const text = normalizeToolOutput(result);
        const reason = clampText(text || 'tool returned error');
        fallbackTrace.push(
          `${provider ?? 'n/a'}:error(${reason.replace(/\s+/g, ' ')})`,
        );
        lastError = new Error(reason);
        continue;
      }
      const providerUsed = extractProviderUsed(result, attemptArgs);
      fallbackTrace.push(`${provider ?? 'n/a'}:ok`);
      return {
        result,
        argsUsed: attemptArgs,
        providerUsed,
        fallbackTrace,
      };
    } catch (err: any) {
      const reason = clampText(String(err?.message ?? err ?? 'unknown'));
      fallbackTrace.push(`${provider ?? 'n/a'}:error(${reason})`);
      lastError = err instanceof Error ? err : new Error(reason);
    }
  }

  throw (
    lastError ??
    new Error(`OpenBB MCP call failed: ${tool.name} (${fallbackTrace.join(' -> ')})`)
  );
};

const buildPromptDocs = async (
  client: OpenbbMcpClient,
  query: string,
  selectedTools: MCPTool[],
) => {
  const docs: Document[] = [];
  let prompts: MCPPrompt[] = [];
  try {
    prompts = await client.listPrompts();
  } catch {
    return docs;
  }
  const promptNames = new Set(prompts.map((p) => p.name));

  if (promptNames.has(OPENBB_ROUTER_PROMPT)) {
    try {
      const today = new Date();
      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      const router = await client.getPrompt(OPENBB_ROUTER_PROMPT, {
        task: query,
        provider: 'auto',
        start_date: formatDateISO(monthAgo),
        end_date: formatDateISO(today),
      });
      const text = normalizePromptOutput(router);
      if (text) {
        docs.push(
          new Document({
            pageContent: `[OpenBB MCP Prompt]\nprompt: ${OPENBB_ROUTER_PROMPT}\n\n${text}`.slice(
              0,
              8000,
            ),
            metadata: {
              title: `OpenBB MCP Prompt | ${OPENBB_ROUTER_PROMPT}`,
              url: `openbb-mcp://prompt/${OPENBB_ROUTER_PROMPT}`,
            },
          }),
        );
      }
    } catch (err) {
      console.warn('[openbb-mcp] market-router prompt fetch failed:', err);
    }
  }

  for (const tool of selectedTools) {
    const skillName = `${OPENBB_SKILL_PROMPT_PREFIX}${tool.name}`;
    if (!promptNames.has(skillName)) continue;
    try {
      const skill = await client.getPrompt(skillName, {
        provider: 'auto',
        request_json: JSON.stringify({
          query,
          tool_name: tool.name,
        }),
      });
      const text = normalizePromptOutput(skill);
      if (!text) continue;
      docs.push(
        new Document({
          pageContent: `[OpenBB MCP Prompt]\nprompt: ${skillName}\nfor_tool: ${tool.name}\n\n${text}`.slice(
            0,
            6000,
          ),
          metadata: {
            title: `OpenBB MCP Prompt | ${skillName}`,
            url: `openbb-mcp://prompt/${skillName}`,
          },
        }),
      );
    } catch (err) {
      console.warn('[openbb-mcp] skill prompt fetch failed:', skillName, err);
    }
  }

  return docs;
};

export const probeOpenbbMcp = async (): Promise<ProbeResult> => {
  if (!getOpenbbMcpEnabled()) return { ok: false, reason: 'disabled' };
  const endpoint = getOpenbbMcpUrl();
  if (!endpoint) return { ok: false, reason: 'missing_url' };

  const endpointCandidates = buildOpenbbEndpointCandidates(endpoint);
  const errors: string[] = [];

  for (const ep of endpointCandidates) {
    try {
      const client = new OpenbbMcpClient(ep, getOpenbbMcpApiKey());
      const tools = await client.listTools();
      if (!tools.length) {
        errors.push(`${ep}: no_tools`);
        continue;
      }
      let prompts: MCPPrompt[] = [];
      try {
        prompts = await client.listPrompts();
      } catch {}
      return {
        ok: true,
        tools: tools.slice(0, 20).map((x) => x.name),
        prompts: prompts.slice(0, 20).map((x) => x.name),
        hasMarketRouter: prompts.some((x) => x.name === OPENBB_ROUTER_PROMPT),
      };
    } catch (err: any) {
      errors.push(`${ep}: ${err?.message ?? 'connect failed'}`);
    }
  }

  try {
    const client = new OpenbbMcpClient(endpoint, getOpenbbMcpApiKey());
    const tools = await client.listTools();
    if (!tools.length) return { ok: false, reason: 'no_tools' };
    let prompts: MCPPrompt[] = [];
    try {
      prompts = await client.listPrompts();
    } catch {}
    return {
      ok: true,
      tools: tools.slice(0, 20).map((x) => x.name),
      prompts: prompts.slice(0, 20).map((x) => x.name),
      hasMarketRouter: prompts.some((x) => x.name === OPENBB_ROUTER_PROMPT),
    };
  } catch (err: any) {
    return {
      ok: false,
      reason: 'connect_failed',
      message:
        errors.length > 0
          ? `OpenBB MCP probe failed. Tried: ${errors.join(' | ')}`
          : err?.message ?? 'OpenBB MCP probe failed',
    };
  }
};

export const fetchOpenbbMcpDocsForQuery = async (
  query: string,
): Promise<Document[]> => {
  if (!getOpenbbMcpEnabled()) return [];
  const endpoint = getOpenbbMcpUrl();
  if (!endpoint) return [];

  const endpointCandidates = buildOpenbbEndpointCandidates(endpoint);
  for (const ep of endpointCandidates) {
    try {
      const client = new OpenbbMcpClient(ep, getOpenbbMcpApiKey());
      const tools = await client.listTools();
      if (!tools.length) continue;

      const selected = selectToolsForQuery(
        tools,
        query,
        getOpenbbMcpPreferredTools(),
        getOpenbbMcpMaxTools(),
      );

      const docs: Document[] = [];
      for (const tool of selected) {
        const args = buildToolArguments(tool, query);
        if (!args) continue;

        try {
          const { result, argsUsed, providerUsed, fallbackTrace } =
            await callToolWithProviderFallback(client, tool, args);
          const text = normalizeToolOutput(result);
          if (!text) continue;
          const payload = [
            '[OpenBB MCP]',
            `tool_used: ${tool.name}`,
            `provider_used: ${providerUsed}`,
            `fallback_trace: ${fallbackTrace.join(' -> ')}`,
            `args: ${JSON.stringify(argsUsed)}`,
            '',
            text,
          ]
            .join('\n')
            .slice(0, 5000);
          docs.push(
            new Document({
              pageContent: payload,
              metadata: {
                title: `OpenBB MCP | ${tool.name}`,
                url: `openbb-mcp://${tool.name}`,
                tool_used: tool.name,
                provider_used: providerUsed,
                fallback_trace: fallbackTrace.join(' -> '),
              },
            }),
          );
        } catch (err) {
          console.warn('[openbb-mcp] tool call failed:', tool.name, err);
        }
      }

      const promptDocs = await buildPromptDocs(client, query, selected);
      docs.push(...promptDocs);
      return docs;
    } catch (err) {
      console.warn('[openbb-mcp] query failed on endpoint:', ep, err);
    }
  }

  try {
    const client = new OpenbbMcpClient(endpoint, getOpenbbMcpApiKey());
    const tools = await client.listTools();
    if (!tools.length) return [];

    const selected = selectToolsForQuery(
      tools,
      query,
      getOpenbbMcpPreferredTools(),
      getOpenbbMcpMaxTools(),
    );

    const docs: Document[] = [];
    for (const tool of selected) {
      const args = buildToolArguments(tool, query);
      if (!args) continue;

      try {
        const { result, argsUsed, providerUsed, fallbackTrace } =
          await callToolWithProviderFallback(client, tool, args);
        const text = normalizeToolOutput(result);
        if (!text) continue;
        const payload = [
          '[OpenBB MCP]',
          `tool_used: ${tool.name}`,
          `provider_used: ${providerUsed}`,
          `fallback_trace: ${fallbackTrace.join(' -> ')}`,
          `args: ${JSON.stringify(argsUsed)}`,
          '',
          text,
        ]
          .join('\n')
          .slice(0, 5000);
        docs.push(
          new Document({
            pageContent: payload,
            metadata: {
              title: `OpenBB MCP | ${tool.name}`,
              url: `openbb-mcp://${tool.name}`,
              tool_used: tool.name,
              provider_used: providerUsed,
              fallback_trace: fallbackTrace.join(' -> '),
            },
          }),
        );
      } catch (err) {
        console.warn('[openbb-mcp] tool call failed:', tool.name, err);
      }
    }

    const promptDocs = await buildPromptDocs(client, query, selected);
    docs.push(...promptDocs);

    return docs;
  } catch (err: any) {
    console.warn('[openbb-mcp] query failed:', err);
    return [];
  }
};
