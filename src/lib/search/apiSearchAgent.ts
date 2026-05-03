import { EventEmitter } from 'events';
import type { BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import type { MetaSearchAgentType } from './metaSearchAgent';
import {
  getSearchHandlerCapabilities,
  type SearchHandlerCapabilities,
} from './index';
import { parseLooseJson } from '@/lib/utils/json';

type SearchFinding = {
  content: string;
  metadata: Record<string, any>;
};

type SearchEvent =
  | { type: 'status'; data: string }
  | { type: 'sources'; data: any[] }
  | { type: 'searchResults'; data: SearchFinding[] }
  | { type: 'researchComplete' }
  | { type: 'response'; data: string }
  | { type: 'error'; data: string };

type ApiSearchAgentInput = {
  focusMode: string;
  message: string;
  history: BaseMessage[];
  handler: MetaSearchAgentType;
  llm: BaseChatModel | null;
  embeddings: Embeddings | null;
  optimizationMode: 'speed' | 'balanced' | 'quality';
  fileIds: string[];
  systemInstructions: string;
};

const emitData = (emitter: EventEmitter, payload: SearchEvent) => {
  emitter.emit('data', JSON.stringify(payload));
};

const safeParseEmitterData = (raw: unknown) => {
  const parsed = parseLooseJson<{ type?: string; data?: any }>(raw);
  if (!parsed?.type) return null;
  return parsed;
};

const normalizeSearchResults = (sources: unknown): SearchFinding[] => {
  if (!Array.isArray(sources)) return [];

  return sources
    .map((item) => {
      const pageContent =
        typeof item?.pageContent === 'string'
          ? item.pageContent
          : typeof item?.content === 'string'
            ? item.content
            : '';

      const metadata =
        item && typeof item === 'object' && item.metadata
          ? item.metadata
          : {};

      if (!pageContent.trim() && Object.keys(metadata).length === 0) {
        return null;
      }

      return {
        content: pageContent,
        metadata,
      };
    })
    .filter(Boolean) as SearchFinding[];
};

class ApiSearchAgent {
  private readonly capabilities: SearchHandlerCapabilities;

  constructor(
    private readonly focusMode: string,
    private readonly handler: MetaSearchAgentType,
  ) {
    this.capabilities = getSearchHandlerCapabilities(focusMode);
  }

  async searchAndAnswer(input: ApiSearchAgentInput) {
    const emitter = new EventEmitter();

    setTimeout(() => {
      void this.run(emitter, input);
    }, 0);

    return emitter;
  }

  private async run(emitter: EventEmitter, input: ApiSearchAgentInput) {
    let researchCompleteEmitted = false;
    let searchResultsEmitted = false;

    const emitResearchComplete = () => {
      if (researchCompleteEmitted || !this.capabilities.supportsResearchTimeline) {
        return;
      }
      researchCompleteEmitted = true;
      emitData(emitter, { type: 'researchComplete' });
    };

    const emitSearchResults = (sources: unknown) => {
      if (searchResultsEmitted) return;

      const results = normalizeSearchResults(sources);
      if (results.length === 0) return;

      searchResultsEmitted = true;
      emitData(emitter, {
        type: 'searchResults',
        data: results,
      });
    };

    try {
      if (this.capabilities.requiresModels && (!input.llm || !input.embeddings)) {
        throw new Error(
          `Search handler "${this.focusMode}" requires chat and embedding models`,
        );
      }

      if (this.capabilities.deterministic) {
        emitData(emitter, {
          type: 'status',
          data:
            this.focusMode === 'eventImpactMatrix'
              ? '正在生成事件驱动结果...'
              : '正在生成分析结果...',
        });
      }

      const child = await this.handler.searchAndAnswer(
        input.message,
        input.history,
        input.llm as BaseChatModel,
        input.embeddings as Embeddings,
        input.optimizationMode,
        input.fileIds,
        input.systemInstructions,
      );

      child.on('data', (raw: string) => {
        const parsed = safeParseEmitterData(raw);
        if (!parsed?.type) return;

        if (parsed.type === 'sources') {
          emitSearchResults(parsed.data);
          emitData(emitter, {
            type: 'sources',
            data: Array.isArray(parsed.data) ? parsed.data : [],
          });
          emitResearchComplete();
          return;
        }

        if (parsed.type === 'response') {
          emitResearchComplete();
          emitData(emitter, {
            type: 'response',
            data: String(parsed.data ?? ''),
          });
          return;
        }

        if (parsed.type === 'status') {
          emitData(emitter, {
            type: 'status',
            data: String(parsed.data ?? ''),
          });
          return;
        }

        if (parsed.type === 'error') {
          emitData(emitter, {
            type: 'error',
            data: String(parsed.data ?? 'Unknown search error'),
          });
          return;
        }

        emitter.emit('data', raw);
      });

      child.on('end', () => {
        emitResearchComplete();
        emitter.emit('end');
      });

      child.on('error', (err: unknown) => {
        const message =
          err instanceof Error
            ? err.message
            : String(err || 'Unknown search stream error');
        emitData(emitter, {
          type: 'error',
          data: message,
        });
        emitter.emit('error', err);
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown search initialization error';
      emitData(emitter, {
        type: 'error',
        data: message,
      });
      emitter.emit(
        'error',
        JSON.stringify({
          type: 'error',
          data: message,
        }),
      );
    }
  }
}

export default ApiSearchAgent;
export type { SearchFinding, ApiSearchAgentInput };
