import { z } from 'zod';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { getMiniMaxMcpEnabled } from '@/lib/config/serverRegistry';
import db from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import { getClientIdFromHeaders } from '@/lib/server/client';
import { generateImageWithMiniMaxApi } from '@/lib/minimax/api';
import { generateImageViaMiniMaxMcp } from '@/lib/minimax/mcp';

export const runtime = 'nodejs';

const bodySchema = z.object({
  prompt: z.string().min(1, 'prompt is required'),
  aspectRatio: z.string().optional(),
  size: z.string().optional(),
  model: z.string().optional(),
  chatId: z.string().optional(),
  messageId: z.string().optional(),
  focusMode: z.string().optional(),
});

const buildImageMarkdown = (images: string[], text?: string) => {
  if (images.length > 0) {
    return [
      '已为你生成图片：',
      '',
      ...images.flatMap((url, index) => [
        `![生成图片 ${index + 1}](${url})`,
        '',
      ]),
      `[打开原图](${images[0]})`,
    ].join('\n');
  }

  return text || '图片生成已完成，但服务未返回可展示的图片链接。';
};

const persistImageGenerationChat = async ({
  req,
  chatId,
  messageId,
  prompt,
  focusMode,
  content,
}: {
  req: Request;
  chatId?: string;
  messageId?: string;
  prompt: string;
  focusMode?: string;
  content: string;
}) => {
  if (!chatId || !messageId) return;

  const owner = getClientIdFromHeaders(new Headers(req.headers));
  const now = new Date().toString();

  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
  });

  if (!chat) {
    await db
      .insert(chats)
      .values({
        id: chatId,
        title: prompt,
        createdAt: now,
        focusMode: focusMode || 'minimaxMedia',
        owner,
        files: [],
      })
      .execute();
  }

  const userMessage = await db.query.messages.findFirst({
    where: eq(messages.messageId, messageId),
  });

  if (!userMessage) {
    await db
      .insert(messages)
      .values({
        owner,
        chatId,
        messageId,
        role: 'user',
        content: prompt,
        createdAt: now,
      })
      .execute();
  }

  await db
    .insert(messages)
    .values([
      {
        owner,
        chatId,
        messageId: `${crypto.randomBytes(7).toString('hex')}-status`,
        role: 'status' as const,
        content: '已调用 MiniMax 图片生成接口',
        createdAt: now,
      },
      {
        owner,
        chatId,
        messageId: crypto.randomBytes(7).toString('hex'),
        role: 'assistant' as const,
        content,
        createdAt: now,
      },
    ])
    .execute();
};

export const POST = async (req: Request) => {
  try {
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { message: parsed.error.errors[0]?.message || 'Invalid payload' },
        { status: 400 },
      );
    }

    const { prompt, aspectRatio, size, model, chatId, messageId, focusMode } = parsed.data;

    try {
      const apiResult = await generateImageWithMiniMaxApi({
        prompt,
        aspectRatio,
        size,
        model,
      });
      const content = buildImageMarkdown(apiResult.images);
      await persistImageGenerationChat({
        req,
        chatId,
        messageId,
        prompt,
        focusMode,
        content,
      });

      return Response.json(
        {
          ok: true,
          source: 'minimax_api',
          content,
          ...apiResult,
        },
        { status: 200 },
      );
    } catch (apiErr: any) {
      if (!getMiniMaxMcpEnabled()) {
        throw apiErr;
      }
      console.warn('[minimax/image-generation] API failed, fallback to MCP:', apiErr);
    }

    const mcpResult = await generateImageViaMiniMaxMcp(prompt, {
      aspectRatio,
      size,
    });
    const content = buildImageMarkdown([], mcpResult.text);
    await persistImageGenerationChat({
      req,
      chatId,
      messageId,
      prompt,
      focusMode,
      content,
    });

    return Response.json(
      {
        ok: true,
        source: 'minimax_mcp',
        content,
        tool: mcpResult.toolName,
        argsUsed: mcpResult.argsUsed,
        text: mcpResult.text,
        raw: mcpResult.result,
      },
      { status: 200 },
    );
  } catch (err: any) {
    return Response.json(
      { message: err?.message || 'MiniMax image-generation failed' },
      { status: 500 },
    );
  }
};
