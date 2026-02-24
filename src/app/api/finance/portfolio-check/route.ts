import {
  formatPortfolioCheckAsMarkdown,
  runPortfolioCheck,
} from '@/lib/finance/portfolioCheck';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (req: Request) => {
  try {
    const body = (await req.json()) as { input?: string };
    const input = String(body?.input || '').trim();

    const result = runPortfolioCheck(input);

    return Response.json(
      {
        ok: true,
        result,
        markdown: formatPortfolioCheckAsMarkdown(result),
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error('Error in /api/finance/portfolio-check:', err);
    return Response.json(
      {
        ok: false,
        message: err?.message || 'An error has occurred.',
      },
      { status: 500 },
    );
  }
};
