import { getTushareToken } from '@/lib/config/serverRegistry';

type ValidateResponse = {
  ok: boolean;
  reason?: 'missing_token' | 'invalid_token' | 'no_permission' | 'unknown';
  code?: number;
  message?: string;
};

export const runtime = 'nodejs';

export const GET = async () => {
  const token = getTushareToken();
  if (!token) {
    const resp: ValidateResponse = { ok: false, reason: 'missing_token' };
    return Response.json(resp, { status: 200 });
  }

  try {
    const res = await fetch('https://api.tushare.pro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_name: 'trade_cal',
        token,
        params: { exchange: 'SSE', start_date: '20250101', end_date: '20250105' },
        fields: 'exchange,cal_date,is_open',
      }),
      cache: 'no-store',
    });

    const json = (await res.json()) as any;
    if (json?.code === 0) {
      const resp: ValidateResponse = { ok: true };
      return Response.json(resp, { status: 200 });
    }

    const code = Number(json?.code);
    const msg = String(json?.msg ?? 'Unknown error');

    let reason: ValidateResponse['reason'] = 'unknown';
    if (code === 40101) reason = 'invalid_token';
    else if (code === 40203) reason = 'no_permission';

    const resp: ValidateResponse = {
      ok: false,
      reason,
      code: Number.isFinite(code) ? code : undefined,
      message: msg,
    };
    return Response.json(resp, { status: 200 });
  } catch (err: any) {
    const resp: ValidateResponse = {
      ok: false,
      reason: 'unknown',
      message: err?.message ?? 'Failed to validate',
    };
    return Response.json(resp, { status: 200 });
  }
};

