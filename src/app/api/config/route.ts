import configManager from '@/lib/config';
import ModelRegistry from '@/lib/models/registry';
import { NextRequest, NextResponse } from 'next/server';
import { ConfigModelProvider } from '@/lib/config/types';
import { requireAdmin } from '@/lib/server/adminAuth';

type SaveConfigBody = {
  key: string;
  value: string;
};

export const GET = async (req: NextRequest) => {
  try {
    const values = configManager.getCurrentConfig();
    const fields = configManager.getUIConfigSections();

    const modelRegistry = new ModelRegistry();
    const modelProviders = await modelRegistry.getActiveProviders();

    values.modelProviders = values.modelProviders.map(
      (mp: ConfigModelProvider) => {
        const activeProvider = modelProviders.find((p) => p.id === mp.id);

        // Never expose provider secrets (API keys, URLs, etc.) to the client.
        // We only need to expose the available model lists; the actual
        // provider config is kept server-side in configManager.
        return {
          ...mp,
          // Strip config entirely so it cannot be leaked over the network.
          config: {},
          chatModels: activeProvider?.chatModels ?? mp.chatModels,
          embeddingModels:
            activeProvider?.embeddingModels ?? mp.embeddingModels,
        };
      },
    );

    // Never expose non-model secrets (e.g. TuShare token) to the client.
    if (values.economy?.tushareToken) {
      values.economy.tushareToken = '********';
    }
    if (values.economy?.openbbMcpApiKey) {
      values.economy.openbbMcpApiKey = '********';
    }
    if (values.search?.tavilyApiKey) {
      values.search.tavilyApiKey = '********';
    }

    return NextResponse.json({
      values,
      fields,
    });
  } catch (err) {
    console.error('Error in getting config: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};

export const POST = async (req: NextRequest) => {
  try {
    const authError = requireAdmin(req);
    if (authError) return authError;

    const body: SaveConfigBody = await req.json();

    if (!body.key || body.value === undefined) {
      return Response.json(
        {
          message: 'Key and value are required.',
        },
        {
          status: 400,
        },
      );
    }

    // Avoid accidentally overwriting secrets with masked placeholders.
    if (body.value === '********') {
      return Response.json(
        {
          message: 'Config updated successfully.',
        },
        {
          status: 200,
        },
      );
    }

    configManager.updateConfig(body.key, body.value);

    return Response.json(
      {
        message: 'Config updated successfully.',
      },
      {
        status: 200,
      },
    );
  } catch (err) {
    console.error('Error in getting config: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
