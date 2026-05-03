import { z } from 'zod';
import { getMiniMaxMcpEnabled } from '@/lib/config/serverRegistry';
import { generateImageWithMiniMaxApi } from '@/lib/minimax/api';
import { generateImageViaMiniMaxMcp } from '@/lib/minimax/mcp';

export const runtime = 'nodejs';

const bodySchema = z.object({
  prompt: z.string().min(1, 'prompt is required'),
  aspectRatio: z.string().optional(),
  size: z.string().optional(),
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

    const { prompt, aspectRatio, size, model } = parsed.data;

    try {
      const apiResult = await generateImageWithMiniMaxApi({
        prompt,
        aspectRatio,
        size,
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
      if (!getMiniMaxMcpEnabled()) {
        throw apiErr;
      }
      console.warn('[minimax/image-generation] API failed, fallback to MCP:', apiErr);
    }

    const mcpResult = await generateImageViaMiniMaxMcp(prompt, {
      aspectRatio,
      size,
    });
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
      { message: err?.message || 'MiniMax image-generation failed' },
      { status: 500 },
    );
  }
};
