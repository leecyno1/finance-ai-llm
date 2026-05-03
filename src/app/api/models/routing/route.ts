import { getModelRoutingSummary } from '@/lib/models/modelRouting';
import { getConfiguredModelProviders } from '@/lib/config/serverRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const redactProvider = (providerId?: string) => {
  if (!providerId) return null;
  const provider = getConfiguredModelProviders().find((p) => p.id === providerId);
  if (!provider) return { providerId };
  return {
    providerId: provider.id,
    name: provider.name,
    type: provider.type,
    baseURL: String(provider.config?.baseURL || '').replace(/\/+$/, ''),
  };
};

export const GET = async () => {
  const summary = getModelRoutingSummary();
  return Response.json({
    daily: summary.daily
      ? { ...summary.daily, provider: redactProvider(summary.daily.providerId) }
      : null,
    deepResearch: summary.deepResearch
      ? {
          ...summary.deepResearch,
          provider: redactProvider(summary.deepResearch.providerId),
        }
      : null,
    embedding: summary.embedding
      ? { ...summary.embedding, provider: redactProvider(summary.embedding.providerId) }
      : null,
  });
};
