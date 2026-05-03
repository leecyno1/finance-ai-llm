import { ensureFundCodeMap, searchFundCodeMap } from '@/lib/finance/fundCodeMapping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (req: Request) => {
  try {
    const { searchParams } = new URL(req.url);
    const q = String(searchParams.get('q') || '').trim();
    const limitRaw = Number(searchParams.get('limit') || 15);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(30, limitRaw)) : 15;

    const loaded = await ensureFundCodeMap();
    const rows = q ? searchFundCodeMap(loaded.items, q, limit) : loaded.items.slice(0, limit);

    return Response.json(
      {
        ok: true,
        q,
        count: rows.length,
        total: loaded.items.length,
        updatedAt: loaded.updatedAt,
        source: loaded.source,
        cached: loaded.cached,
        error: loaded.error || '',
        items: rows.map((x) => ({
          tsCode: x.tsCode,
          code: x.code,
          name: x.name,
          management: x.management,
          fundType: x.fundType,
          status: x.status,
        })),
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error('Error in /api/finance/fund-map:', err);
    return Response.json(
      {
        ok: false,
        message: err?.message || 'An error has occurred.',
      },
      { status: 500 },
    );
  }
};

