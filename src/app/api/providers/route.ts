import ModelRegistry from '@/lib/models/registry';
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/adminAuth';
import { MinimalProvider } from '@/lib/models/types';

const dedupeModels = (models: { key: string; name: string }[]) => {
  const seen = new Set<string>();
  return models.filter((m) => {
    const k = String(m.key || '').trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const normalizeProviders = (providers: MinimalProvider[]) => {
  const byId = new Map<string, MinimalProvider>();
  const isMiniMax = (name: string) =>
    String(name || '').toLowerCase().includes('minimax');
  const isDeepResearch = (name: string) =>
    /gitee|deepseek|深度研究|高阶/i.test(String(name || ''));
  const isEmbeddingOnly = (name: string) =>
    /embedding|向量/i.test(String(name || ''));

  for (const p of providers) {
    const prev = byId.get(p.id);
    const mergedChat = dedupeModels([
      ...(prev?.chatModels || []),
      ...(p.chatModels || []),
    ]);
    const mergedEmbedding = dedupeModels([
      ...(prev?.embeddingModels || []),
      ...(p.embeddingModels || []),
    ]);

    const merged: MinimalProvider = {
      id: p.id,
      name: p.name,
      chatModels: isDeepResearch(p.name) || isEmbeddingOnly(p.name) ? [] : mergedChat,
      embeddingModels: mergedEmbedding,
    };
    byId.set(p.id, merged);
  }

  const mergedProviders = Array.from(byId.values());
  const primaryMiniMaxProviderId =
    mergedProviders.find(
      (p) =>
        isMiniMax(p.name) &&
        p.chatModels.some((m) => m.key === 'MiniMax-M2.7'),
    )?.id ??
    mergedProviders.find((p) => isMiniMax(p.name) && p.chatModels.length > 0)
      ?.id ??
    '';

  return mergedProviders.map((p) => {
    const isPrimaryMiniMax = !!primaryMiniMaxProviderId && p.id === primaryMiniMaxProviderId;
    const chatModels = isPrimaryMiniMax
      ? dedupeModels(p.chatModels.filter((m) => m.key === 'MiniMax-M2.7')).slice(
          0,
          1,
        )
      : [];

    return {
      ...p,
      chatModels,
    };
  });
};

export const GET = async (req: Request) => {
  try {
    const registry = new ModelRegistry();

    const activeProviders = await registry.getActiveProviders();

    const filteredProviders = normalizeProviders(
      activeProviders.filter((p) => !p.chatModels.some((m) => m.key === 'error')),
    ).filter(
      (p) => p.chatModels.length > 0 || p.embeddingModels.length > 0,
    );

    return Response.json(
      {
        providers: filteredProviders,
      },
      {
        status: 200,
      },
    );
  } catch (err) {
    console.error('An error occurred while fetching providers', err);
    return Response.json(
      {
        message: 'An error has occurred.',
      },
      {
        status: 500,
      },
    );
  }
};

export const POST = async (req: NextRequest) => {
  try {
    const authError = requireAdmin(req);
    if (authError) return authError;

    const body = await req.json();
    const { type, name, config } = body;

    if (!type || !name || !config) {
      return Response.json(
        {
          message: 'Missing required fields.',
        },
        {
          status: 400,
        },
      );
    }

    const registry = new ModelRegistry();

    const newProvider = await registry.addProvider(type, name, config);

    return Response.json(
      {
        provider: newProvider,
      },
      {
        status: 200,
      },
    );
  } catch (err) {
    console.error('An error occurred while creating provider', err);
    return Response.json(
      {
        message: 'An error has occurred.',
      },
      {
        status: 500,
      },
    );
  }
};
