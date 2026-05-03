import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Model, ModelList, ProviderMetadata } from '../types';
import BaseModelProvider from './baseProvider';
import { Embeddings } from '@langchain/core/embeddings';
import { UIConfigField } from '@/lib/config/types';
interface TransformersConfig {}

const defaultEmbeddingModels: Model[] = [];

const providerConfigFields: UIConfigField[] = [];

class TransformersProvider extends BaseModelProvider<TransformersConfig> {
  constructor(id: string, name: string, config: TransformersConfig) {
    super(id, name, config);
  }

  async getDefaultModels(): Promise<ModelList> {
    return {
      embedding: [...defaultEmbeddingModels],
      chat: [],
    };
  }

  async getModelList(): Promise<ModelList> {
    return this.getDefaultModels();
  }

  async loadChatModel(key: string): Promise<BaseChatModel> {
    throw new Error('Transformers Provider does not support chat models.');
  }

  async loadEmbeddingModel(_key: string): Promise<Embeddings> {
    throw new Error(
      'Transformers embedding is disabled. Use MiniMax embedding instead.',
    );
  }

  static parseAndValidate(raw: any): TransformersConfig {
    return {};
  }

  static getProviderConfigFields(): UIConfigField[] {
    return providerConfigFields;
  }

  static getProviderMetadata(): ProviderMetadata {
    return {
      key: 'transformers',
      name: 'Transformers',
    };
  }
}

export default TransformersProvider;
