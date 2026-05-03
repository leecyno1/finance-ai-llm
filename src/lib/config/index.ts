import path from 'node:path';
import fs from 'fs';
import { Config, ConfigModelProvider, UIConfigSections } from './types';
import { hashObj } from '../serverUtils';
import { getModelProvidersUIConfigSection } from '../models/providers';

class ConfigManager {
  configPath: string = path.join(
    process.env.DATA_DIR || process.cwd(),
    '/data/config.json',
  );
  configVersion = 1;
  currentConfig: Config = {
    version: this.configVersion,
    setupComplete: false,
    preferences: {},
    personalization: {},
    modelProviders: [],
    search: {
      searxngURL: '',
      tavilyApiKey: '',
      tavilyMaxResults: '',
    },
    economy: {
      tushareToken: '',
      openbbMcpEnabled: false,
      openbbMcpUrl: '',
      openbbMcpApiKey: '',
      openbbMcpPreferredTools: '',
      openbbMcpMaxTools: 3,
      minimaxMcpEnabled: false,
      minimaxMcpUrl: '',
      minimaxMcpApiKey: '',
      minimaxMcpPreferredTools: '',
      minimaxMcpMaxTools: 3,
      fundUniverseLocalPath: '',
      fundUniverseCompanyFilter: '',
      eventImpactMarketViewPromptTemplate: '',
      eventImpactFundPanelPromptTemplate: '',
      portfolioCheckAgentPromptTemplate: '',
      portfolioCheckAgentSystemPrompt: '',
    },
  };
  uiConfigSections: UIConfigSections = {
    preferences: [
      {
        name: 'Theme',
        key: 'theme',
        type: 'select',
        options: [
          {
            name: 'Light',
            value: 'light',
          },
          {
            name: 'Dark',
            value: 'dark',
          },
        ],
        required: false,
        description: 'Choose between light and dark layouts for the app.',
        default: 'dark',
        scope: 'client',
      },
      {
        name: 'Measurement Unit',
        key: 'measureUnit',
        type: 'select',
        options: [
          {
            name: 'Imperial',
            value: 'Imperial',
          },
          {
            name: 'Metric',
            value: 'Metric',
          },
        ],
        required: false,
        description: 'Choose between Metric  and Imperial measurement unit.',
        default: 'Metric',
        scope: 'client',
      },
      {
        name: 'Auto video & image search',
        key: 'autoMediaSearch',
        type: 'switch',
        required: false,
        description: 'Automatically search for relevant images and videos.',
        default: true,
        scope: 'client',
      },
      {
        name: 'Show weather widget',
        key: 'showWeatherWidget',
        type: 'switch',
        required: false,
        description: 'Display the weather card on the home screen.',
        default: true,
        scope: 'client',
      },
      {
        name: 'Show news widget',
        key: 'showNewsWidget',
        type: 'switch',
        required: false,
        description: 'Display the recent news card on the home screen.',
        default: true,
        scope: 'client',
      },
    ],
    personalization: [
      {
        name: 'System Instructions',
        key: 'systemInstructions',
        type: 'textarea',
        required: false,
        description: 'Add custom behavior or tone for the model.',
        placeholder:
          'e.g., "Respond in a friendly and concise tone" or "Use British English and format answers as bullet points."',
        scope: 'client',
      },
    ],
    modelProviders: [],
    search: [
      {
        name: 'SearXNG URL',
        key: 'searxngURL',
        type: 'string',
        required: false,
        description: 'The URL of your SearXNG instance',
        placeholder: 'http://localhost:4000',
        default: '',
        scope: 'server',
        env: 'SEARXNG_API_URL',
      },
      {
        name: 'Tavily API Key',
        key: 'tavilyApiKey',
        type: 'password',
        required: false,
        description:
          'Tavily 检索密钥（用于混合检索，服务端保存，不会返回到浏览器）。',
        placeholder: 'tvly-...',
        default: '',
        scope: 'server',
        env: 'TAVILY_API_KEY',
      },
      {
        name: 'Tavily Max Results',
        key: 'tavilyMaxResults',
        type: 'string',
        required: false,
        description: '每次 Tavily 检索返回条数（建议 4-10）。',
        placeholder: '6',
        default: '6',
        scope: 'server',
        env: 'TAVILY_MAX_RESULTS',
      },
    ],
    economy: [
      {
        name: 'TuShare Token',
        key: 'tushareToken',
        type: 'password',
        required: false,
        description:
          'TuShare Pro Token，用于拉取真实市场与宏观数据（服务端保存，不会返回到浏览器）。',
        placeholder: '粘贴你的 TuShare token（不会明文展示）',
        default: '',
        scope: 'server',
        env: 'TUSHARE_TOKEN',
      },
      {
        name: 'Enable OpenBB MCP',
        key: 'openbbMcpEnabled',
        type: 'switch',
        required: false,
        description: '启用 OpenBB MCP 数据调用（用于金融问答实时数据增强）。',
        default: false,
        scope: 'server',
        env: 'OPENBB_MCP_ENABLED',
      },
      {
        name: 'OpenBB MCP URL',
        key: 'openbbMcpUrl',
        type: 'string',
        required: false,
        description:
          'OpenBB MCP 服务地址（本机示例：http://127.0.0.1:8011/mcp；Docker 内访问宿主机示例：http://host.docker.internal:8011/mcp）。',
        placeholder: 'http://127.0.0.1:8011/mcp',
        default: '',
        scope: 'server',
        env: 'OPENBB_MCP_URL',
      },
      {
        name: 'OpenBB MCP API Key',
        key: 'openbbMcpApiKey',
        type: 'password',
        required: false,
        description: 'OpenBB MCP 鉴权密钥（服务端保存，不会返回浏览器）。',
        placeholder: 'OpenBB MCP API Key',
        default: '',
        scope: 'server',
        env: 'OPENBB_MCP_API_KEY',
      },
      {
        name: 'OpenBB Preferred Tools',
        key: 'openbbMcpPreferredTools',
        type: 'textarea',
        required: false,
        description:
          '优先调用的 OpenBB MCP 工具名（逗号或换行分隔），留空则自动匹配。',
        placeholder: 'equity_price_quote\neconomy_calendar',
        default: '',
        scope: 'server',
        env: 'OPENBB_MCP_PREFERRED_TOOLS',
      },
      {
        name: 'OpenBB Max Tools',
        key: 'openbbMcpMaxTools',
        type: 'string',
        required: false,
        description: '每次问题最多调用几个 OpenBB MCP 工具（1-6）。',
        placeholder: '3',
        default: '3',
        scope: 'server',
        env: 'OPENBB_MCP_MAX_TOOLS',
      },
      {
        name: 'Enable MiniMax MCP',
        key: 'minimaxMcpEnabled',
        type: 'switch',
        required: false,
        description:
          '启用 MiniMax MCP 工具（用于 web_search / understand_image / text_to_image）。',
        default: false,
        scope: 'server',
        env: 'MINIMAX_MCP_ENABLED',
      },
      {
        name: 'MiniMax MCP URL',
        key: 'minimaxMcpUrl',
        type: 'string',
        required: false,
        description:
          'MiniMax MCP 服务地址（建议 REST 端点，如 http://127.0.0.1:8090/mcp）。',
        placeholder: 'http://127.0.0.1:8090/mcp',
        default: '',
        scope: 'server',
        env: 'MINIMAX_MCP_URL',
      },
      {
        name: 'MiniMax MCP API Key',
        key: 'minimaxMcpApiKey',
        type: 'password',
        required: false,
        description: 'MiniMax MCP 鉴权密钥（服务端保存，不会返回浏览器）。',
        placeholder: 'MiniMax MCP API Key',
        default: '',
        scope: 'server',
        env: 'MINIMAX_MCP_API_KEY',
      },
      {
        name: 'MiniMax Preferred Tools',
        key: 'minimaxMcpPreferredTools',
        type: 'textarea',
        required: false,
        description:
          '优先调用的 MiniMax MCP 工具名（逗号或换行分隔），留空则自动匹配。',
        placeholder: 'web_search\nunderstand_image\ntext_to_image',
        default: '',
        scope: 'server',
        env: 'MINIMAX_MCP_PREFERRED_TOOLS',
      },
      {
        name: 'MiniMax Max Tools',
        key: 'minimaxMcpMaxTools',
        type: 'string',
        required: false,
        description: '每次请求最多调用几个 MiniMax MCP 工具（1-6）。',
        placeholder: '3',
        default: '3',
        scope: 'server',
        env: 'MINIMAX_MCP_MAX_TOOLS',
      },
      {
        name: 'Fund Universe Local Path',
        key: 'fundUniverseLocalPath',
        type: 'string',
        required: false,
        description:
          '本地基金池 JSON 路径（可选，支持绝对路径或相对 DATA_DIR）。可用于接入自建基金库，不再固定南方基金。',
        placeholder: 'data/fund/southern-fund-a-universe.json',
        default: '',
        scope: 'server',
        env: 'FUND_UNIVERSE_LOCAL_PATH',
      },
      {
        name: 'Fund Universe Company Filter',
        key: 'fundUniverseCompanyFilter',
        type: 'textarea',
        required: false,
        description:
          '基金公司筛选（逗号或换行分隔，可留空表示全市场）。示例：南方基金管理股份有限公司',
        placeholder: '留空=全市场；可填：南方基金管理股份有限公司',
        default: '',
        scope: 'server',
        env: 'FUND_UNIVERSE_COMPANY_FILTER',
      },
      {
        name: 'Event-Impact Market Prompt',
        key: 'eventImpactMarketViewPromptTemplate',
        type: 'textarea',
        required: false,
        description:
          '事件驱动-资产配置观点模板（可选）。支持占位符：{{summary_json}}。',
        placeholder:
          '留空使用默认模板；可填自定义提示词并包含 {{summary_json}}',
        default: '',
        scope: 'server',
        env: 'EVENT_IMPACT_MARKET_VIEW_PROMPT_TEMPLATE',
      },
      {
        name: 'Event-Impact Fund Panel Prompt',
        key: 'eventImpactFundPanelPromptTemplate',
        type: 'textarea',
        required: false,
        description:
          '事件驱动-行业基金推荐模板（可选）。支持占位符：{{rows_json}}。',
        placeholder:
          '留空使用默认模板；可填自定义提示词并包含 {{rows_json}}',
        default: '',
        scope: 'server',
        env: 'EVENT_IMPACT_FUND_PANEL_PROMPT_TEMPLATE',
      },
      {
        name: 'Portfolio Agent Prompt',
        key: 'portfolioCheckAgentPromptTemplate',
        type: 'textarea',
        required: false,
        description:
          '基金诊断-Agent分析模板（可选）。支持占位符：{{input_text}} {{risk_score}} {{top_holdings}} {{top_sectors}} {{top_factors}} {{tushare_brief}}。',
        placeholder:
          '留空使用默认模板；可填自定义提示词并包含相关占位符',
        default: '',
        scope: 'server',
        env: 'PORTFOLIO_CHECK_AGENT_PROMPT_TEMPLATE',
      },
      {
        name: 'Portfolio Agent System Prompt',
        key: 'portfolioCheckAgentSystemPrompt',
        type: 'textarea',
        required: false,
        description: '基金诊断-Agent系统提示词（可选）。',
        placeholder: '留空使用默认系统提示词',
        default: '',
        scope: 'server',
        env: 'PORTFOLIO_CHECK_AGENT_SYSTEM_PROMPT',
      },
    ],
  };

  constructor() {
    this.initialize();
  }

  private initialize() {
    this.initializeConfig();
    this.initializeFromEnv();
  }

  private saveConfig() {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = JSON.stringify(this.currentConfig, null, 2);
    const tmpPath = `${this.configPath}.${process.pid}.${Date.now()}.tmp`;

    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, this.configPath);
  }

  private initializeConfig() {
    const exists = fs.existsSync(this.configPath);
    if (!exists) {
      this.saveConfig();
      return;
    }

    try {
      this.currentConfig = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
    } catch (err) {
      if (err instanceof SyntaxError) {
        console.error(`Error parsing config file at ${this.configPath}:`, err);
        console.log('Loading default config and overwriting the existing file.');
        this.saveConfig();
        return;
      }

      console.log('Unknown error reading config file:', err);
      return;
    }

    this.currentConfig = this.migrateConfig(this.currentConfig);
  }

  private migrateConfig(config: Config): Config {
    // Lightweight "migration"/backfill so older config files keep working when
    // new sections/fields are added.
    if (!config || typeof config !== 'object') {
      return JSON.parse(JSON.stringify(this.currentConfig));
    }

    config.version = this.configVersion;
    config.setupComplete = config.setupComplete ?? false;
    config.preferences = config.preferences ?? {};
    config.personalization = config.personalization ?? {};
    config.modelProviders = config.modelProviders ?? [];

    config.search = config.search ?? {
      searxngURL: '',
      tavilyApiKey: '',
      tavilyMaxResults: 6,
    };
    config.search.searxngURL = config.search.searxngURL ?? '';
    config.search.tavilyApiKey = config.search.tavilyApiKey ?? '';
    const parsedMaxResults = Number(config.search.tavilyMaxResults);
    config.search.tavilyMaxResults =
      Number.isFinite(parsedMaxResults) && parsedMaxResults > 0
        ? Math.floor(parsedMaxResults)
        : 6;

    config.economy = config.economy ?? {
      tushareToken: '',
      openbbMcpEnabled: false,
      openbbMcpUrl: '',
      openbbMcpApiKey: '',
      openbbMcpPreferredTools: '',
      openbbMcpMaxTools: 3,
      minimaxMcpEnabled: false,
      minimaxMcpUrl: '',
      minimaxMcpApiKey: '',
      minimaxMcpPreferredTools: '',
      minimaxMcpMaxTools: 3,
      fundUniverseLocalPath: '',
      fundUniverseCompanyFilter: '',
    };
    config.economy.tushareToken = config.economy.tushareToken ?? '';
    const enabledRaw = config.economy.openbbMcpEnabled;
    config.economy.openbbMcpEnabled =
      enabledRaw === true || String(enabledRaw).toLowerCase() === 'true';
    config.economy.openbbMcpUrl = config.economy.openbbMcpUrl ?? '';
    config.economy.openbbMcpApiKey = config.economy.openbbMcpApiKey ?? '';
    config.economy.openbbMcpPreferredTools =
      config.economy.openbbMcpPreferredTools ?? '';
    const parsedMaxTools = Number(config.economy.openbbMcpMaxTools);
    config.economy.openbbMcpMaxTools =
      Number.isFinite(parsedMaxTools) && parsedMaxTools > 0
        ? Math.floor(parsedMaxTools)
        : 3;
    const minimaxEnabledRaw = config.economy.minimaxMcpEnabled;
    config.economy.minimaxMcpEnabled =
      minimaxEnabledRaw === true ||
      String(minimaxEnabledRaw).toLowerCase() === 'true';
    config.economy.minimaxMcpUrl = config.economy.minimaxMcpUrl ?? '';
    config.economy.minimaxMcpApiKey = config.economy.minimaxMcpApiKey ?? '';
    config.economy.minimaxMcpPreferredTools =
      config.economy.minimaxMcpPreferredTools ?? '';
    const parsedMiniMaxTools = Number(config.economy.minimaxMcpMaxTools);
    config.economy.minimaxMcpMaxTools =
      Number.isFinite(parsedMiniMaxTools) && parsedMiniMaxTools > 0
        ? Math.floor(parsedMiniMaxTools)
        : 3;
    config.economy.fundUniverseLocalPath =
      config.economy.fundUniverseLocalPath ?? '';
    config.economy.fundUniverseCompanyFilter =
      config.economy.fundUniverseCompanyFilter ?? '';
    config.economy.eventImpactMarketViewPromptTemplate =
      config.economy.eventImpactMarketViewPromptTemplate ?? '';
    config.economy.eventImpactFundPanelPromptTemplate =
      config.economy.eventImpactFundPanelPromptTemplate ?? '';
    config.economy.portfolioCheckAgentPromptTemplate =
      config.economy.portfolioCheckAgentPromptTemplate ?? '';
    config.economy.portfolioCheckAgentSystemPrompt =
      config.economy.portfolioCheckAgentSystemPrompt ?? '';

    return config;
  }

  private initializeFromEnv() {
    /* providers section*/
    const providerConfigSections = getModelProvidersUIConfigSection();

    this.uiConfigSections.modelProviders = providerConfigSections;

    const newProviders: ConfigModelProvider[] = [];

    providerConfigSections.forEach((provider) => {
      const newProvider: ConfigModelProvider & { required?: string[] } = {
        id: crypto.randomUUID(),
        name: `${provider.name}`,
        type: provider.key,
        chatModels: [],
        embeddingModels: [],
        config: {},
        required: [],
        hash: '',
      };

      provider.fields.forEach((field) => {
        newProvider.config[field.key] =
          process.env[field.env!] ||
          field.default ||
          ''; /* Env var must exist for providers */

        if (field.required) newProvider.required?.push(field.key);
      });

      let configured = true;

      newProvider.required?.forEach((r) => {
        if (!newProvider.config[r]) {
          configured = false;
        }
      });

      if (configured) {
        const hash = hashObj(newProvider.config);
        newProvider.hash = hash;
        delete newProvider.required;

        const exists = this.currentConfig.modelProviders.find(
          (p) => p.hash === hash,
        );

        if (!exists) {
          newProviders.push(newProvider);
        }
      }
    });

    this.currentConfig.modelProviders.push(...newProviders);

    const roleProviders: ConfigModelProvider[] = [];

    const upsertRoleProvider = (provider: ConfigModelProvider) => {
      const exists = this.currentConfig.modelProviders.some((p) => p.id === provider.id);
      if (!exists) roleProviders.push(provider);
    };

    const minimaxApiKey = process.env.MINIMAX_API_KEY || '';
    if (minimaxApiKey) {
      const modelKey = process.env.MINIMAX_DEFAULT_MODEL || 'MiniMax-M2.7';
      const embeddingKey = process.env.MINIMAX_EMBEDDING_MODEL || 'embo-01';
      const config = {
        apiKey: minimaxApiKey,
        baseURL: process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1',
      };
      upsertRoleProvider({
        id: 'dasheng-minimax-daily',
        name: 'MiniMax 日常与多模态',
        type: 'minimax',
        chatModels: [{ name: 'MiniMax M2.7', key: modelKey }],
        embeddingModels: [{ name: `MiniMax Embedding ${embeddingKey}`, key: embeddingKey }],
        config,
        hash: hashObj(config),
      });
    }

    const giteeApiKey = process.env.GITEE_AI_API_KEY || '';
    if (giteeApiKey) {
      const config = {
        apiKey: giteeApiKey,
        baseURL: process.env.GITEE_AI_BASE_URL || 'https://ai.gitee.com/v1',
      };
      upsertRoleProvider({
        id: 'dasheng-gitee-deep-research',
        name: 'Gitee AI 高阶深度研究',
        type: 'openai',
        chatModels: [
          {
            name: 'DeepSeek V4 Flash',
            key: process.env.GITEE_AI_DEEP_RESEARCH_MODEL || 'DeepSeek-V4-Flash',
          },
        ],
        embeddingModels: [],
        config,
        hash: hashObj(config),
      });
    }

    const siliconflowApiKey = process.env.SILICONFLOW_API_KEY || '';
    if (siliconflowApiKey) {
      const config = {
        apiKey: siliconflowApiKey,
        baseURL: process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1',
      };
      upsertRoleProvider({
        id: 'dasheng-siliconflow-embedding',
        name: 'SiliconFlow Embedding',
        type: 'openai',
        chatModels: [],
        embeddingModels: [
          {
            name: 'BAAI bge-m3',
            key: process.env.SILICONFLOW_EMBEDDING_MODEL || 'BAAI/bge-m3',
          },
        ],
        config,
        hash: hashObj(config),
      });
    }

    this.currentConfig.modelProviders.push(...roleProviders);

    /* search section */
    this.uiConfigSections.search.forEach((f) => {
      if (f.env && !this.currentConfig.search[f.key]) {
        this.currentConfig.search[f.key] =
          process.env[f.env] ?? f.default ?? '';
      }
    });

    /* economy section */
    this.uiConfigSections.economy.forEach((f) => {
      if (f.env && !this.currentConfig.economy[f.key]) {
        this.currentConfig.economy[f.key] =
          process.env[f.env] ?? f.default ?? '';
      }
    });

    this.saveConfig();
  }

  public getConfig(key: string, defaultValue?: any): any {
    const nested = key.split('.');
    let obj: any = this.currentConfig;

    for (let i = 0; i < nested.length; i++) {
      const part = nested[i];
      if (obj == null) return defaultValue;

      obj = obj[part];
    }

    return obj === undefined ? defaultValue : obj;
  }

  public updateConfig(key: string, val: any) {
    const parts = key.split('.');
    if (parts.length === 0) return;

    let target: any = this.currentConfig;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (target[part] === null || typeof target[part] !== 'object') {
        target[part] = {};
      }

      target = target[part];
    }

    const finalKey = parts[parts.length - 1];
    target[finalKey] = val;

    this.saveConfig();
  }

  public addModelProvider(type: string, name: string, config: any) {
    const newModelProvider: ConfigModelProvider = {
      id: crypto.randomUUID(),
      name,
      type,
      config,
      chatModels: [],
      embeddingModels: [],
      hash: hashObj(config),
    };

    this.currentConfig.modelProviders.push(newModelProvider);
    this.saveConfig();

    return newModelProvider;
  }

  public removeModelProvider(id: string) {
    const index = this.currentConfig.modelProviders.findIndex(
      (p) => p.id === id,
    );

    if (index === -1) return;

    this.currentConfig.modelProviders =
      this.currentConfig.modelProviders.filter((p) => p.id !== id);

    this.saveConfig();
  }

  public async updateModelProvider(id: string, name: string, config: any) {
    const provider = this.currentConfig.modelProviders.find((p) => {
      return p.id === id;
    });

    if (!provider) throw new Error('Provider not found');

    provider.name = name;
    provider.config = config;

    this.saveConfig();

    return provider;
  }

  public addProviderModel(
    providerId: string,
    type: 'embedding' | 'chat',
    model: any,
  ) {
    const provider = this.currentConfig.modelProviders.find(
      (p) => p.id === providerId,
    );

    if (!provider) throw new Error('Invalid provider id');

    delete model.type;

    if (type === 'chat') {
      provider.chatModels.push(model);
    } else {
      provider.embeddingModels.push(model);
    }

    this.saveConfig();

    return model;
  }

  public removeProviderModel(
    providerId: string,
    type: 'embedding' | 'chat',
    modelKey: string,
  ) {
    const provider = this.currentConfig.modelProviders.find(
      (p) => p.id === providerId,
    );

    if (!provider) throw new Error('Invalid provider id');

    if (type === 'chat') {
      provider.chatModels = provider.chatModels.filter(
        (m) => m.key !== modelKey,
      );
    } else {
      provider.embeddingModels = provider.embeddingModels.filter(
        (m) => m.key != modelKey,
      );
    }

    this.saveConfig();
  }

  public isSetupComplete() {
    return this.currentConfig.setupComplete;
  }

  public markSetupComplete() {
    if (!this.currentConfig.setupComplete) {
      this.currentConfig.setupComplete = true;
    }

    this.saveConfig();
  }

  public getUIConfigSections(): UIConfigSections {
    return this.uiConfigSections;
  }

  public getCurrentConfig(): Config {
    return JSON.parse(JSON.stringify(this.currentConfig));
  }
}

const configManager = new ConfigManager();

export default configManager;
