import db from '@/lib/db';
import { getClientIdFromHeaders } from '@/lib/server/client';
import { chats } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (req: Request) => {
  try {
    const owner = getClientIdFromHeaders(new Headers(req.headers));
    let chatsList = await db.query.chats.findMany({
      where: eq(chats.owner, owner),
    });
    chatsList = chatsList.reverse();
    return Response.json({ chats: chatsList }, { status: 200 });
  } catch (err) {
    console.error('Error in getting chats: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
