import ModelRegistry from '@/lib/models/registry';
import { ModelWithProvider } from '@/lib/models/types';
import { getConfiguredModelProviders } from '@/lib/config/serverRegistry';

const DAILY_MODEL_KEY = process.env.MINIMAX_DEFAULT_MODEL || 'MiniMax-M2.7';
const DEEP_RESEARCH_MODEL_KEY =
  process.env.GITEE_AI_DEEP_RESEARCH_MODEL || 'DeepSeek-V4-Flash';
const GITEE_BASE_URL = process.env.GITEE_AI_BASE_URL || 'https://ai.gitee.com/v1';

const hasChatModel = (provider: { chatModels?: { key: string }[] }, key: string) =>
  Array.isArray(provider.chatModels) && provider.chatModels.some((m) => m.key === key);

const hasEmbeddingModel = (provider: { embeddingModels?: { key: string }[] }, key: string) =>
  Array.isArray(provider.embeddingModels) && provider.embeddingModels.some((m) => m.key === key);

const isMiniMaxProvider = (provider: any) =>
  provider?.type === 'minimax' ||
  String(provider?.name || '').toLowerCase().includes('minimax') ||
  String(provider?.config?.baseURL || '').toLowerCase().includes('minimaxi.com');

const isGiteeProvider = (provider: any) =>
  String(provider?.config?.baseURL || '').replace(/\/+$/, '') === GITEE_BASE_URL;

export const isDeepResearchFocusMode = (focusMode: string, optimizationMode?: string) =>
  focusMode === 'academicSearch' || optimizationMode === 'quality';

export const getDailyChatModelSelection = (): ModelWithProvider | null => {
  const providers = getConfiguredModelProviders();
  const provider =
    providers.find((p) => isMiniMaxProvider(p) && hasChatModel(p, DAILY_MODEL_KEY)) ||
    providers.find((p) => isMiniMaxProvider(p) && p.chatModels?.length);
  const model =
    provider?.chatModels?.find((m) => m.key === DAILY_MODEL_KEY) ||
    provider?.chatModels?.[0];

  if (!provider || !model) return null;
  return { providerId: provider.id, key: model.key };
};

export const getDeepResearchChatModelSelection = (): ModelWithProvider | null => {
  const providers = getConfiguredModelProviders();
  const provider =
    providers.find((p) => isGiteeProvider(p) && hasChatModel(p, DEEP_RESEARCH_MODEL_KEY)) ||
    providers.find((p) => hasChatModel(p, DEEP_RESEARCH_MODEL_KEY));

  if (!provider) return null;
  return { providerId: provider.id, key: DEEP_RESEARCH_MODEL_KEY };
};

export const getPreferredEmbeddingModelSelection = (
  fallback?: ModelWithProvider | null,
): ModelWithProvider | null => {
  const providers = getConfiguredModelProviders();

  if (fallback?.providerId && fallback.key) {
    const provider = providers.find((p) => p.id === fallback.providerId);
    if (provider && hasEmbeddingModel(provider, fallback.key)) return fallback;
  }

  const bgeProvider = providers.find((p) => hasEmbeddingModel(p, 'BAAI/bge-m3'));
  if (bgeProvider) return { providerId: bgeProvider.id, key: 'BAAI/bge-m3' };

  const minimaxProvider = providers.find(
    (p) => isMiniMaxProvider(p) && Array.isArray(p.embeddingModels) && p.embeddingModels.length > 0,
  );
  const minimaxModel = minimaxProvider?.embeddingModels?.[0];
  if (minimaxProvider && minimaxModel) {
    return { providerId: minimaxProvider.id, key: minimaxModel.key };
  }

  const provider = providers.find((p) => Array.isArray(p.embeddingModels) && p.embeddingModels.length > 0);
  const model = provider?.embeddingModels?.[0];
  if (!provider || !model) return null;
  return { providerId: provider.id, key: model.key };
};

export const resolveChatModelForFocus = (
  focusMode: string,
  optimizationMode: string | undefined,
  fallback: ModelWithProvider,
): ModelWithProvider => {
  if (isDeepResearchFocusMode(focusMode, optimizationMode)) {
    return getDeepResearchChatModelSelection() || fallback;
  }

  return getDailyChatModelSelection() || fallback;
};

export const loadRoutedChatModel = async (
  registry: ModelRegistry,
  focusMode: string,
  optimizationMode: string | undefined,
  fallback: ModelWithProvider,
) => {
  const selected = resolveChatModelForFocus(focusMode, optimizationMode, fallback);
  return registry.loadChatModel(selected.providerId, selected.key);
};

export const loadRoutedEmbeddingModel = async (
  registry: ModelRegistry,
  fallback?: ModelWithProvider | null,
) => {
  const selected = getPreferredEmbeddingModelSelection(fallback);
  if (!selected) throw new Error('No embedding model configured');
  return registry.loadEmbeddingModel(selected.providerId, selected.key);
};

export const getModelRoutingSummary = () => ({
  daily: getDailyChatModelSelection(),
  deepResearch: getDeepResearchChatModelSelection(),
  embedding: getPreferredEmbeddingModelSelection(),
});
