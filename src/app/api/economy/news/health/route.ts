import { getNewsSourceHealth } from '@/lib/economy/news-sources';

export const GET = async () => {
  try {
    const health = getNewsSourceHealth();
    const total = health.length;
    const available = health.filter((item) => item.configuredEnabled && !item.circuitOpen).length;
    const openCircuits = health.filter((item) => item.circuitOpen).length;

    return Response.json({
      ok: true,
      total,
      available,
      openCircuits,
      health,
      updatedAt: Date.now(),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        health: [],
      },
      { status: 500 },
    );
  }
};
