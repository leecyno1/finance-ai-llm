import type { BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import type { MetaSearchAgentType } from '@/lib/search/metaSearchAgent';
import {
  buildEventImpactMatrix,
  formatEventImpactAsMarkdown,
} from '@/lib/finance/eventImpact';
import { createResponseEmitter } from '@/lib/search/simpleEmitter';

class EventImpactSearchHandler implements MetaSearchAgentType {
  async searchAndAnswer(
    message: string,
    _history: BaseMessage[],
    _llm: BaseChatModel,
    _embeddings: Embeddings,
    _optimizationMode: 'speed' | 'balanced' | 'quality',
    _fileIds: string[],
    _systemInstructions: string,
  ) {
    const matrix = buildEventImpactMatrix({ query: message, limit: 16 });
    const response = formatEventImpactAsMarkdown(matrix);

    const sources = matrix
      .filter((x) => x.sourceUrl)
      .slice(0, 8)
      .map((x) => ({
        pageContent: `${x.event}\n${x.rationale}`,
        metadata: {
          title: `${x.source} | ${x.event}`,
          url: x.sourceUrl,
        },
      }));

    return createResponseEmitter({
      response,
      sources,
      chunkSize: 140,
      delayMs: 0,
    });
  }
}

export default EventImpactSearchHandler;
