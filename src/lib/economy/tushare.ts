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

export const hasTushareToken = () =>
  !!(process.env.TUSHARE_TOKEN || process.env.TUSHARE_API_TOKEN);

export const callTushare = async (
  apiName: string,
  params: Record<string, any>,
  fields: string[],
): Promise<TushareRow[]> => {
  const token = process.env.TUSHARE_TOKEN || process.env.TUSHARE_API_TOKEN;
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
    throw new Error(`Tushare error: ${json.msg || 'unknown error'}`);
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
