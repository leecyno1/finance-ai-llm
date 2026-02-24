import type { BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import type { MetaSearchAgentType } from '@/lib/search/metaSearchAgent';
import {
  runPortfolioCheck,
  formatPortfolioCheckAsMarkdown,
} from '@/lib/finance/portfolioCheck';
import { createResponseEmitter } from '@/lib/search/simpleEmitter';

class PortfolioCheckSearchHandler implements MetaSearchAgentType {
  async searchAndAnswer(
    message: string,
    _history: BaseMessage[],
    _llm: BaseChatModel,
    _embeddings: Embeddings,
    _optimizationMode: 'speed' | 'balanced' | 'quality',
    _fileIds: string[],
    _systemInstructions: string,
  ) {
    const result = runPortfolioCheck(message);
    const response = formatPortfolioCheckAsMarkdown(result);

    return createResponseEmitter({
      response,
      sources: [],
      chunkSize: 140,
      delayMs: 0,
    });
  }
}

export default PortfolioCheckSearchHandler;
