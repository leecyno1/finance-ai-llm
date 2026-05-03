import { z } from 'zod';
import { searchSearxng } from '@/lib/searxng';
import { getMiniMaxMcpEnabled } from '@/lib/config/serverRegistry';
import { webSearchViaMiniMaxMcp } from '@/lib/minimax/mcp';
import { webSearchWithMiniMaxApi } from '@/lib/minimax/api';

export const runtime = 'nodejs';

const bodySchema = z.object({
  query: z.string().min(1, 'query is required'),
  limit: z.number().int().min(1).max(20).optional().default(8),
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

    const { query, limit } = parsed.data;

    try {
      const minimaxResult = await webSearchWithMiniMaxApi(query);
      return Response.json(
        {
          ok: true,
          source: 'minimax_api',
          result: minimaxResult,
        },
        { status: 200 },
      );
    } catch (apiErr: any) {
      console.warn('[minimax/web-search] API failed:', apiErr);
      if (getMiniMaxMcpEnabled()) {
        try {
          const mcpResult = await webSearchViaMiniMaxMcp(query);
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
        } catch (mcpErr: any) {
          console.warn('[minimax/web-search] MCP failed, fallback to SearXNG:', mcpErr);
        }
      }
    }

    const searx = await searchSearxng(query);
    return Response.json(
      {
        ok: true,
        source: 'searxng',
        results: (searx?.results || []).slice(0, limit),
      },
      { status: 200 },
    );
  } catch (err: any) {
    return Response.json(
      { message: err?.message || 'MiniMax web-search failed' },
      { status: 500 },
    );
  }
};
