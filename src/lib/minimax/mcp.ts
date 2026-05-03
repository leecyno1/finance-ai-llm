import {
  getMiniMaxMcpApiKey,
  getMiniMaxMcpEnabled,
  getMiniMaxMcpMaxTools,
  getMiniMaxMcpPreferredTools,
  getMiniMaxMcpUrl,
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
      [key: string]: unknown;
    }
  >;
  required?: string[];
};

type MCPTool = {
  name: string;
  description?: string;
  inputSchema?: MCPToolSchema;
};

type MCPCallResult = {
  content?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
};

type ProbeResult = {
  ok: boolean;
  reason?: 'disabled' | 'missing_url' | 'connect_failed' | 'no_tools' | 'unknown';
  message?: string;
  tools?: string[];
  capabilities?: {
    webSearch: boolean;
    understandImage: boolean;
    imageGeneration: boolean;
  };
};

const MCP_CLIENT_INFO = {
  name: 'finance-ai-llm',
  version: '1.11.2',
};

const TOOL_ALIASES = {
  webSearch: ['web_search', 'search_web', 'search', 'websearch'],
  understandImage: [
    'understand_image',
    'image_understand',
    'image_analysis',
    'analyze_image',
  ],
  imageGeneration: [
    'text_to_image',
    'image_generation',
    'generate_image',
    'query_image_generation',
  ],
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

const buildEndpointCandidates = (rawEndpoint: string) => {
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
    // noop
  }

  return candidates;
};

const normalizeToolOutput = (result: MCPCallResult): string => {
  const chunks: string[] = [];
  if (Array.isArray(result.content)) {
    result.content.forEach((item) => {
      if (typeof item?.text === 'string' && item.text.trim()) {
        chunks.push(item.text.trim());
      }
    });
  }

  if (result.structuredContent !== undefined) {
    try {
      const json = JSON.stringify(result.structuredContent, null, 2);
      if (json && json !== 'null' && json !== '{}') {
        chunks.push(`structuredContent:\n${json}`);
      }
    } catch {}
  }

  return chunks.join('\n\n').trim();
};

const resolveRequiredArgValue = (
  requiredKey: string,
  baseArgs: Record<string, unknown>,
  meta?: { enum?: unknown[]; default?: unknown },
) => {
  const key = requiredKey.toLowerCase();
  const enumValues = Array.isArray(meta?.enum) ? meta?.enum : [];
  if (enumValues.length > 0) return enumValues[0];
  if (meta?.default !== undefined) return meta.default;

  if (
    /(query|keyword|q|prompt|text|question|instruction|task)/.test(key) &&
    typeof (baseArgs.prompt ?? baseArgs.query ?? baseArgs.text) === 'string'
  ) {
    return String(baseArgs.prompt ?? baseArgs.query ?? baseArgs.text);
  }

  if (/(image|img).*(url|uri)|url|image/.test(key)) {
    const val = baseArgs.image_url ?? baseArgs.imageUrl ?? baseArgs.url;
    if (typeof val === 'string' && val.trim()) return val;
  }

  if (/(aspect|ratio)/.test(key)) {
    const val = baseArgs.aspect_ratio ?? baseArgs.aspectRatio;
    if (typeof val === 'string' && val.trim()) return val;
    return '16:9';
  }

  if (/(size|resolution)/.test(key)) {
    const val = baseArgs.size;
    if (typeof val === 'string' && val.trim()) return val;
    return '1024x1024';
  }

  if (/(n|count|num)/.test(key)) {
    return 1;
  }

  return undefined;
};

const autoFillArgsBySchema = (tool: MCPTool, args: Record<string, unknown>) => {
  const props = tool.inputSchema?.properties ?? {};
  const required = tool.inputSchema?.required ?? [];

  const finalArgs: Record<string, unknown> = { ...args };
  for (const req of required) {
    if (finalArgs[req] !== undefined && finalArgs[req] !== null) continue;
    const val = resolveRequiredArgValue(req, finalArgs, {
      enum: props[req]?.enum,
      default: props[req]?.default,
    });
    if (val === undefined || val === null || String(val).trim() === '') {
      throw new Error(`MiniMax MCP required argument missing: ${req}`);
    }
    finalArgs[req] = val;
  }

  return finalArgs;
};

class MiniMaxMcpClient {
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
    const timeoutMs = opts?.timeoutMs ?? 30000;
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

      if (notification) return null;

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
      // allow servers that don't require explicit initialize
    }

    this.initialized = true;
  }

  async listTools(): Promise<MCPTool[]> {
    await this.ensureInitialized();
    const result = await this.request<{ tools?: MCPTool[] }>('tools/list', {});
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(name: string, args: Record<string, unknown>) {
    await this.ensureInitialized();
    try {
      const standard = await this.request<MCPCallResult>('tools/call', {
        name,
        arguments: args,
      });
      return standard ?? {};
    } catch (err: any) {
      // Some MCP REST adapters (e.g. minimax-mcp-js rest mode) use
      // { tool, params } instead of { name, arguments }.
      try {
        const legacy = await this.request<MCPCallResult>('tools/call', {
          tool: name,
          params: args,
        });
        return legacy ?? {};
      } catch (legacyErr: any) {
        const msg = err?.message ?? 'unknown';
        const legacyMsg = legacyErr?.message ?? 'unknown';
        throw new Error(
          `MCP tools/call failed (standard: ${msg}; legacy: ${legacyMsg})`,
        );
      }
    }
  }
}

const findToolByAliases = (tools: MCPTool[], aliases: string[]) => {
  const direct = aliases.find((alias) => tools.some((t) => t.name === alias));
  if (direct) return tools.find((t) => t.name === direct) ?? null;

  const lowerAliases = aliases.map((x) => x.toLowerCase());
  return (
    tools.find((tool) => {
      const full = `${tool.name} ${tool.description ?? ''}`.toLowerCase();
      return lowerAliases.some((alias) => full.includes(alias));
    }) ?? null
  );
};

const toolMatchesAliases = (tool: MCPTool, aliases: string[]) => {
  const lowerAliases = aliases.map((x) => x.toLowerCase());
  const toolName = tool.name.toLowerCase();
  const full = `${tool.name} ${tool.description ?? ''}`.toLowerCase();
  return lowerAliases.some(
    (alias) => toolName === alias || full.includes(alias),
  );
};

const pickPreferredTool = (tools: MCPTool[], aliases: string[]) => {
  const preferred = getMiniMaxMcpPreferredTools();
  if (preferred.length > 0) {
    const preferredMatch = preferred.find((name) => {
      const matchedTool = tools.find(
        (tool) => tool.name.toLowerCase() === name.toLowerCase(),
      );
      return matchedTool ? toolMatchesAliases(matchedTool, aliases) : false;
    });
    if (preferredMatch) {
      const tool = tools.find(
        (x) => x.name.toLowerCase() === preferredMatch.toLowerCase(),
      );
      if (tool) return tool;
    }

    const preferredContainsAlias = preferred.find((name) =>
      aliases.some(
        (alias) =>
          name.toLowerCase() === alias.toLowerCase() ||
          name.toLowerCase().includes(alias.toLowerCase()),
      ),
    );
    if (preferredContainsAlias) {
      const tool = tools.find(
        (x) =>
          x.name.toLowerCase() === preferredContainsAlias.toLowerCase() &&
          toolMatchesAliases(x, aliases),
      );
      if (tool) return tool;
    }
  }
  return findToolByAliases(tools, aliases);
};

const withClients = async <T>(
  fn: (client: MiniMaxMcpClient) => Promise<T>,
): Promise<T> => {
  const endpoint = getMiniMaxMcpUrl();
  const candidates = buildEndpointCandidates(endpoint);
  const errors: string[] = [];

  for (const ep of candidates) {
    try {
      const client = new MiniMaxMcpClient(ep, getMiniMaxMcpApiKey());
      return await fn(client);
    } catch (err: any) {
      errors.push(`${ep}: ${err?.message ?? 'unknown error'}`);
    }
  }

  throw new Error(
    errors.length > 0
      ? `MiniMax MCP call failed. Tried: ${errors.join(' | ')}`
      : 'MiniMax MCP call failed',
  );
};

export const probeMiniMaxMcp = async (): Promise<ProbeResult> => {
  if (!getMiniMaxMcpEnabled()) return { ok: false, reason: 'disabled' };
  if (!getMiniMaxMcpUrl()) return { ok: false, reason: 'missing_url' };

  try {
    return await withClients(async (client) => {
      const tools = await client.listTools();
      if (!tools.length) return { ok: false, reason: 'no_tools' };

      const hasWebSearch = !!findToolByAliases(tools, TOOL_ALIASES.webSearch);
      const hasUnderstandImage = !!findToolByAliases(
        tools,
        TOOL_ALIASES.understandImage,
      );
      const hasImageGeneration = !!findToolByAliases(
        tools,
        TOOL_ALIASES.imageGeneration,
      );

      return {
        ok: true,
        tools: tools.slice(0, 30).map((x) => x.name),
        capabilities: {
          webSearch: hasWebSearch,
          understandImage: hasUnderstandImage,
          imageGeneration: hasImageGeneration,
        },
      };
    });
  } catch (err: any) {
    return {
      ok: false,
      reason: 'connect_failed',
      message: err?.message ?? 'MiniMax MCP probe failed',
    };
  }
};

export const callMiniMaxToolByAliases = async (
  aliases: string[],
  args: Record<string, unknown>,
) => {
  if (!getMiniMaxMcpEnabled()) {
    throw new Error('MiniMax MCP disabled');
  }
  if (!getMiniMaxMcpUrl()) {
    throw new Error('MiniMax MCP URL missing');
  }

  return withClients(async (client) => {
    const tools = await client.listTools();
    if (!tools.length) {
      throw new Error('MiniMax MCP no tools available');
    }

    const candidateTools: MCPTool[] = [];
    const preferred = pickPreferredTool(tools, aliases);
    if (preferred) candidateTools.push(preferred);

    const ranked = tools
      .filter((tool) => !candidateTools.some((x) => x.name === tool.name))
      .filter((tool) => toolMatchesAliases(tool, aliases))
      .slice(0, Math.max(1, getMiniMaxMcpMaxTools()));
    candidateTools.push(...ranked);

    if (!candidateTools.length) {
      throw new Error(`MiniMax MCP tool not found for aliases: ${aliases.join(', ')}`);
    }

    const errors: string[] = [];
    for (const tool of candidateTools) {
      try {
        const finalArgs = autoFillArgsBySchema(tool, args);
        const result = await client.callTool(tool.name, finalArgs);
        return {
          toolName: tool.name,
          argsUsed: finalArgs,
          result,
          text: normalizeToolOutput(result),
        };
      } catch (err: any) {
        errors.push(`${tool.name}: ${err?.message ?? 'unknown error'}`);
      }
    }

    throw new Error(`MiniMax MCP tool call failed: ${errors.join(' | ')}`);
  });
};

export const webSearchViaMiniMaxMcp = async (query: string) =>
  callMiniMaxToolByAliases(TOOL_ALIASES.webSearch, {
    query,
    keyword: query,
    q: query,
    prompt: query,
    text: query,
  });

export const understandImageViaMiniMaxMcp = async (
  imageUrl: string,
  prompt: string,
) =>
  callMiniMaxToolByAliases(TOOL_ALIASES.understandImage, {
    image_source: imageUrl,
    image_url: imageUrl,
    imageUrl,
    url: imageUrl,
    query: prompt,
    prompt,
    text: prompt,
  });

export const generateImageViaMiniMaxMcp = async (
  prompt: string,
  options?: { aspectRatio?: string; size?: string },
) =>
  callMiniMaxToolByAliases(TOOL_ALIASES.imageGeneration, {
    prompt,
    query: prompt,
    text: prompt,
    aspect_ratio: options?.aspectRatio,
    aspectRatio: options?.aspectRatio,
    size: options?.size,
  });
