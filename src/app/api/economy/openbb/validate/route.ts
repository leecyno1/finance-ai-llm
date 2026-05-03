import { probeOpenbbMcp } from '@/lib/openbb/mcp';

export const runtime = 'nodejs';

export const GET = async () => {
  try {
    const result = await probeOpenbbMcp();
    return Response.json(result, { status: 200 });
  } catch (err: any) {
    return Response.json(
      {
        ok: false,
        reason: 'unknown',
        message: err?.message ?? 'Unknown validation error',
      },
      { status: 200 },
    );
  }
};

