import handleImageSearch from '@/lib/chains/imageSearchAgent';
import ModelRegistry from '@/lib/models/registry';
import { loadRoutedChatModel } from '@/lib/models/modelRouting';
import { ModelWithProvider } from '@/lib/models/types';
import { toBaseMessages } from '@/lib/utils/chatHistory';

interface ImageSearchBody {
  query: string;
  chatHistory: unknown;
  chatModel: ModelWithProvider;
}

export const POST = async (req: Request) => {
  try {
    const body: ImageSearchBody = await req.json();

    const chatHistory = toBaseMessages(body.chatHistory);

    const registry = new ModelRegistry();

    const llm = await loadRoutedChatModel(
      registry,
      'minimaxMedia',
      'balanced',
      body.chatModel,
    );

    const images = await handleImageSearch(
      {
        chat_history: chatHistory,
        query: body.query,
      },
      llm,
    );

    return Response.json({ images }, { status: 200 });
  } catch (err) {
    console.error(`An error occurred while searching images: ${err}`);
    return Response.json(
      { message: 'An error occurred while searching images' },
      { status: 500 },
    );
  }
};
