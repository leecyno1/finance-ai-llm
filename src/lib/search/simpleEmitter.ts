import { EventEmitter } from 'events';

type SourceLike = {
  pageContent?: string;
  metadata?: Record<string, any>;
};

type EmitPayload = {
  response: string;
  sources?: SourceLike[];
  chunkSize?: number;
  delayMs?: number;
};

export const createResponseEmitter = ({
  response,
  sources = [],
  chunkSize = 120,
  delayMs = 0,
}: EmitPayload) => {
  const emitter = new EventEmitter();

  const emitData = (payload: Record<string, any>) => {
    emitter.emit('data', JSON.stringify(payload));
  };

  const run = async () => {
    try {
      if (sources.length > 0) {
        emitData({ type: 'sources', data: sources });
      }

      if (!response) {
        emitter.emit('end');
        return;
      }

      let idx = 0;
      while (idx < response.length) {
        const next = response.slice(idx, idx + chunkSize);
        emitData({ type: 'response', data: next });
        idx += chunkSize;

        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      emitter.emit('end');
    } catch (err) {
      emitter.emit(
        'error',
        JSON.stringify({
          type: 'error',
          data: err instanceof Error ? err.message : 'Unknown stream error',
        }),
      );
    }
  };

  setTimeout(() => {
    void run();
  }, 0);

  return emitter;
};
