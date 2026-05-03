import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import { Embeddings } from '@langchain/core/embeddings';
import { UIConfigField } from '@/lib/config/types';
import { Model, ModelList, ProviderMetadata } from '../types';
import BaseModelProvider from './baseProvider';
import { getConfiguredModelProviderById } from '@/lib/config/serverRegistry';

interface MiniMaxConfig {
  apiKey: string;
  baseURL: string;
}

const defaultChatModels: Model[] = [
  {
    name: 'MiniMax M2.7',
    key: 'MiniMax-M2.7',
  },
];

const defaultEmbeddingModels: Model[] = [
  {
    name: 'MiniMax Embedding (embo-01)',
    key: 'embo-01',
  },
];

const getDefaultEmbeddingModels = (): Model[] => {
  const envModel = String(process.env.MINIMAX_EMBEDDING_MODEL || '').trim();
  if (!envModel) return defaultEmbeddingModels;
  return [
    { name: `MiniMax Embedding (${envModel})`, key: envModel },
    ...defaultEmbeddingModels.filter((m) => m.key !== envModel),
  ];
};

const providerConfigFields: UIConfigField[] = [
  {
    type: 'password',
    name: 'API Key',
    key: 'apiKey',
    description: 'Your MiniMax API key',
    required: true,
    placeholder: 'MiniMax API Key',
    env: 'MINIMAX_API_KEY',
    scope: 'server',
  },
  {
    type: 'string',
    name: 'Base URL',
    key: 'baseURL',
    description: 'MiniMax OpenAI-compatible API base URL',
    required: true,
    placeholder: 'https://api.minimaxi.com/v1',
    default: 'https://api.minimaxi.com/v1',
    env: 'MINIMAX_BASE_URL',
    scope: 'server',
  },
];

type MiniMaxEmbeddingsConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
};

const parseVectorsFromEmbeddingResponse = (json: any): number[][] => {
  const vectors: number[][] = [];

  if (Array.isArray(json?.data)) {
    for (const item of json.data) {
      if (Array.isArray(item?.embedding)) {
        vectors.push(item.embedding as number[]);
      }
    }
  }

  if (vectors.length === 0 && Array.isArray(json?.vectors)) {
    for (const item of json.vectors) {
      if (Array.isArray(item)) vectors.push(item as number[]);
      else if (Array.isArray(item?.embedding)) vectors.push(item.embedding as number[]);
      else if (Array.isArray(item?.vector)) vectors.push(item.vector as number[]);
    }
  }

  if (vectors.length === 0 && Array.isArray(json?.embedding)) {
    vectors.push(json.embedding as number[]);
  }

  return vectors;
};

class MiniMaxEmbeddings extends Embeddings {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly model: string;

  constructor(config: MiniMaxEmbeddingsConfig) {
    super({});
    this.apiKey = config.apiKey;
    this.baseURL = String(config.baseURL || '').replace(/\/+$/, '');
    this.model = config.model;
  }

  private isAuthError(json: any) {
    const code = Number(json?.base_resp?.status_code ?? 0);
    const msg = String(json?.base_resp?.status_msg || '').toLowerCase();
    return code === 1004 || msg.includes('login fail') || msg.includes('authorization');
  }

  private async requestEmbeddingsWithAuth(
    input: string | string[],
    authHeader: string,
    embeddingType: 'query' | 'db',
  ): Promise<{ ok: boolean; vectors: number[][]; json: any; status: number }> {
    const textArray = Array.isArray(input) ? input : [input];
    const payloadCandidates: Record<string, unknown>[] = [
      {
        model: this.model,
        input,
      },
      {
        model: this.model,
        texts: textArray,
        type: embeddingType,
      },
      {
        model: this.model,
        input,
        texts: textArray,
        type: embeddingType,
      },
    ];

    let lastStatus = 500;
    let lastJson: any = {};

    for (const payload of payloadCandidates) {
      const res = await fetch(`${this.baseURL}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });

      const json = await res.json().catch(() => ({}));
      lastStatus = res.status;
      lastJson = json;

      if (!res.ok) {
        continue;
      }

      const code = Number(json?.base_resp?.status_code ?? 0);
      if (Number.isFinite(code) && code !== 0) {
        continue;
      }

      const vectors = parseVectorsFromEmbeddingResponse(json);
      if (vectors.length > 0) {
        return {
          ok: true,
          vectors,
          json,
          status: res.status,
        };
      }
    }

    return {
      ok: false,
      vectors: [],
      json: lastJson,
      status: lastStatus,
    };
  }

  private async requestEmbeddings(
    input: string | string[],
    embeddingType: 'query' | 'db',
  ): Promise<number[][]> {
    const bearerAttempt = await this.requestEmbeddingsWithAuth(
      input,
      `Bearer ${this.apiKey}`,
      embeddingType,
    );

    const fallbackNeeded =
      !bearerAttempt.ok && this.isAuthError(bearerAttempt.json);
    const finalResult = fallbackNeeded
      ? await this.requestEmbeddingsWithAuth(input, this.apiKey, embeddingType)
      : bearerAttempt;

    if (!finalResult.ok) {
      const detail =
        String(finalResult.json?.base_resp?.status_msg || '').trim() ||
        String(finalResult.json?.error?.message || '').trim() ||
        `HTTP ${finalResult.status}`;
      throw new Error(`MiniMax embedding request failed: ${detail}`);
    }

    if (finalResult.vectors.length === 0) {
      throw new Error(
        `MiniMax embedding response missing vectors for model "${this.model}"`,
      );
    }

    return finalResult.vectors;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (!Array.isArray(texts) || texts.length === 0) return [];
    const vectors = await this.requestEmbeddings(texts, 'db');

    if (vectors.length === texts.length) return vectors;
    if (vectors.length === 1 && texts.length > 1) {
      return texts.map(() => vectors[0]);
    }

    throw new Error(
      `MiniMax embedding vectors mismatch: expected ${texts.length}, got ${vectors.length}`,
    );
  }

  async embedQuery(text: string): Promise<number[]> {
    const vectors = await this.requestEmbeddings([text], 'query');
    if (!vectors[0]) {
      throw new Error('MiniMax embedding returned empty query vector');
    }
    return vectors[0];
  }
}

class MiniMaxProvider extends BaseModelProvider<MiniMaxConfig> {
  constructor(id: string, name: string, config: MiniMaxConfig) {
    super(id, name, config);
  }

  async getDefaultModels(): Promise<ModelList> {
    return {
      embedding: getDefaultEmbeddingModels(),
      chat: defaultChatModels,
    };
  }

  async getModelList(): Promise<ModelList> {
    const defaultModels = await this.getDefaultModels();
    const configProvider = getConfiguredModelProviderById(this.id)!;
    return {
      embedding: [
        ...defaultModels.embedding,
        ...configProvider.embeddingModels,
      ],
      chat: [...defaultModels.chat, ...configProvider.chatModels],
    };
  }

  async loadChatModel(key: string): Promise<BaseChatModel> {
    const modelList = await this.getModelList();
    const exists = modelList.chat.find((m) => m.key === key);

    if (!exists) {
      throw new Error('Error Loading MiniMax Chat Model. Invalid Model Selected');
    }

    return new ChatOpenAI({
      apiKey: this.config.apiKey,
      temperature: 0.2,
      model: key,
      timeout: 30000,
      maxRetries: 1,
      streamUsage: false,
      configuration: {
        baseURL: this.config.baseURL,
      },
    });
  }

  async loadEmbeddingModel(key: string): Promise<Embeddings> {
    const modelList = await this.getModelList();
    const exists = modelList.embedding.find((m) => m.key === key);

    if (!exists) {
      throw new Error(
        'Error Loading MiniMax Embedding Model. Invalid Model Selected.',
      );
    }

    return new MiniMaxEmbeddings({
      apiKey: this.config.apiKey,
      model: key,
      baseURL: this.config.baseURL,
    });
  }

  static parseAndValidate(raw: any): MiniMaxConfig {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Invalid config provided. Expected object');
    }
    if (!raw.apiKey || !raw.baseURL) {
      throw new Error('Invalid config provided. API key and base URL must be provided');
    }

    return {
      apiKey: String(raw.apiKey),
      baseURL: String(raw.baseURL),
    };
  }

  static getProviderConfigFields(): UIConfigField[] {
    return providerConfigFields;
  }

  static getProviderMetadata(): ProviderMetadata {
    return {
      key: 'minimax',
      name: 'MiniMax',
    };
  }
}

export default MiniMaxProvider;
