import { getTushareToken } from '@/lib/config/serverRegistry';

type TushareRow = Record<string, string | number | null>;

type TushareResponse = {
  code: number;
  msg: string;
  data?: {
    fields: string[];
    items: (string | number | null)[][];
  };
};

const TUSHARE_ENDPOINT = 'https://api.tushare.pro';

export class TushareApiError extends Error {
  code: number;
  msg: string;

  constructor(code: number, msg: string) {
    super(`Tushare error (${code}): ${msg || 'unknown error'}`);
    this.name = 'TushareApiError';
    this.code = code;
    this.msg = msg || 'unknown error';
  }
}

export const hasTushareToken = () => !!getTushareToken();

export const callTushare = async (
  apiName: string,
  params: Record<string, any>,
  fields: string[],
): Promise<TushareRow[]> => {
  const token = getTushareToken().trim();
  if (!token) {
    throw new Error('Tushare token not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(TUSHARE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_name: apiName,
        token,
        params,
        fields: fields.join(','),
      }),
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`Tushare HTTP error: ${res.status}`);
  }

  const json = (await res.json()) as TushareResponse;
  if (json.code !== 0 || !json.data) {
    throw new TushareApiError(json.code, json.msg);
  }

  const { fields: returnedFields, items } = json.data;
  return items.map((row) => {
    const obj: TushareRow = {};
    returnedFields.forEach((f, idx) => {
      obj[f] = row[idx] ?? null;
    });
    return obj;
  });
};
