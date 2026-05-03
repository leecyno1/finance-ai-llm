import { z } from 'zod';
import { getMiniMaxMcpEnabled } from '@/lib/config/serverRegistry';
import {
  understandImageWithMiniMaxApi,
  understandImageWithMiniMaxVlm,
} from '@/lib/minimax/api';
import { understandImageViaMiniMaxMcp } from '@/lib/minimax/mcp';

export const runtime = 'nodejs';

const isTimeoutLikeError = (err: unknown) =>
  /abort|timed?\s*out|timeout|UND_ERR/i.test(String((err as any)?.message || err || ''));

const bodySchema = z.object({
  imageUrl: z.string().url('imageUrl must be a valid URL'),
  prompt: z.string().optional().default('请描述图片内容并提取关键信息。'),
  model: z.string().optional(),
});

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

    const { imageUrl, prompt, model } = parsed.data;

    try {
      const apiResult = await understandImageWithMiniMaxApi({
        imageUrl,
        prompt,
        model,
      });
      return Response.json(
        {
          ok: true,
          source: 'minimax_api',
          ...apiResult,
        },
        { status: 200 },
      );
    } catch (apiErr: any) {
      if (isTimeoutLikeError(apiErr)) {
        console.warn('[minimax/understand-image] chat-completions timeout-like failure:', apiErr);
        throw apiErr;
      }
      console.warn('[minimax/understand-image] chat-completions failed, fallback to VLM:', apiErr);
    }

    try {
      const vlmResult = await understandImageWithMiniMaxVlm({
        imageUrl,
        prompt,
      });
      return Response.json(
        {
          ok: true,
          source: 'minimax_vlm',
          text: vlmResult.text,
          raw: vlmResult.raw,
        },
        { status: 200 },
      );
    } catch (vlmErr: any) {
      if (!getMiniMaxMcpEnabled()) {
        throw vlmErr;
      }
      console.warn('[minimax/understand-image] VLM failed, fallback to MCP:', vlmErr);
    }

    const mcpResult = await understandImageViaMiniMaxMcp(imageUrl, prompt);
    return Response.json(
      {
        ok: true,
        source: 'minimax_mcp',
        tool: mcpResult.toolName,
        argsUsed: mcpResult.argsUsed,
        text: mcpResult.text,
        raw: mcpResult.result,
      },
      { status: 200 },
    );
  } catch (err: any) {
    return Response.json(
      { message: err?.message || 'MiniMax understand-image failed' },
      { status: 500 },
    );
  }
};
