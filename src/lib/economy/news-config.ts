/**
 * 财经新闻数据源配置
 * 可以通过环境变量控制启用/禁用特定的新闻源
 */

export type NewsSourceName = 
  | 'cailianpress'
  | 'wallstreetcn'
  | 'eastmoney'
  | 'xueqiu'
  | 'yicai'
  | 'sina'
  | 'ths'
  | 'jrj'
  | 'phoenix';

export type NewsSourceSettings = {
  name: string;
  displayName: string;
  enabled: boolean;
  priority: number; // 优先级，数字越大优先级越高
  rateLimit?: number; // 请求间隔（毫秒）
  timeout?: number; // 超时时间（毫秒）
};

const getEnvBoolean = (key: string, defaultValue: boolean): boolean => {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value === 'true' || value === '1';
};

export const NEWS_SOURCE_SETTINGS: Record<NewsSourceName, NewsSourceSettings> = {
  cailianpress: {
    name: 'cailianpress',
    displayName: '财联社',
    enabled: getEnvBoolean('NEWS_SOURCE_CAILIANPRESS', true),
    priority: 10,
    timeout: 5000,
  },
  wallstreetcn: {
    name: 'wallstreetcn',
    displayName: '华尔街见闻',
    enabled: getEnvBoolean('NEWS_SOURCE_WALLSTREETCN', true),
    priority: 9,
    timeout: 5000,
  },
  eastmoney: {
    name: 'eastmoney',
    displayName: '东方财富',
    enabled: getEnvBoolean('NEWS_SOURCE_EASTMONEY', true),
    priority: 8,
    timeout: 5000,
  },
  xueqiu: {
    name: 'xueqiu',
    displayName: '雪球',
    enabled: getEnvBoolean('NEWS_SOURCE_XUEQIU', true),
    priority: 7,
    timeout: 5000,
  },
  yicai: {
    name: 'yicai',
    displayName: '第一财经',
    enabled: getEnvBoolean('NEWS_SOURCE_YICAI', true),
    priority: 6,
    timeout: 5000,
  },
  sina: {
    name: 'sina',
    displayName: '新浪财经',
    enabled: getEnvBoolean('NEWS_SOURCE_SINA', true),
    priority: 5,
    timeout: 5000,
  },
  ths: {
    name: 'ths',
    displayName: '同花顺',
    enabled: getEnvBoolean('NEWS_SOURCE_THS', true),
    priority: 4,
    timeout: 5000,
  },
  jrj: {
    name: 'jrj',
    displayName: '金融界',
    enabled: getEnvBoolean('NEWS_SOURCE_JRJ', false),
    priority: 3,
    timeout: 5000,
  },
  phoenix: {
    name: 'phoenix',
    displayName: '凤凰财经',
    enabled: getEnvBoolean('NEWS_SOURCE_PHOENIX', false),
    priority: 2,
    timeout: 5000,
  },
};

/**
 * 获取已启用的新闻源列表
 */
export const getEnabledSources = (): NewsSourceSettings[] => {
  return Object.values(NEWS_SOURCE_SETTINGS)
    .filter(source => source.enabled)
    .sort((a, b) => b.priority - a.priority);
};

/**
 * 检查特定新闻源是否启用
 */
export const isSourceEnabled = (sourceName: NewsSourceName): boolean => {
  return NEWS_SOURCE_SETTINGS[sourceName]?.enabled ?? false;
};
