import db from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getClientIdFromHeaders } from '@/lib/server/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const owner = getClientIdFromHeaders(new Headers(req.headers));

    const chatExists = await db.query.chats.findFirst({
      where: and(eq(chats.id, id), eq(chats.owner, owner)),
    });

    if (!chatExists) {
      return Response.json({ message: 'Chat not found' }, { status: 404 });
    }

    const chatMessages = await db.query.messages.findMany({
      where: and(eq(messages.chatId, id), eq(messages.owner, owner)),
    });

    return Response.json(
      {
        chat: chatExists,
        messages: chatMessages,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error in getting chat by id: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};

export const DELETE = async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    const owner = getClientIdFromHeaders(new Headers(req.headers));

    const chatExists = await db.query.chats.findFirst({
      where: and(eq(chats.id, id), eq(chats.owner, owner)),
    });

    if (!chatExists) {
      return Response.json({ message: 'Chat not found' }, { status: 404 });
    }

    await db
      .delete(chats)
      .where(and(eq(chats.id, id), eq(chats.owner, owner)))
      .execute();
    await db
      .delete(messages)
      .where(and(eq(messages.chatId, id), eq(messages.owner, owner)))
      .execute();

    return Response.json(
      { message: 'Chat deleted successfully' },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error in deleting chat by id: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
