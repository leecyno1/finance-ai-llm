import {
  getMiniMaxApiKey,
  getMiniMaxBaseUrl,
  getMiniMaxDefaultModel,
} from '@/lib/config/serverRegistry';
import fs from 'node:fs/promises';
import path from 'node:path';

const getImageModel = () =>
  String(process.env.MINIMAX_IMAGE_MODEL || 'image-01').trim();

const assertBaseRespOk = (json: any, context: string) => {
  const code = Number(json?.base_resp?.status_code ?? 0);
  if (!Number.isFinite(code) || code === 0) return;
  const msg = String(json?.base_resp?.status_msg || 'unknown error');
  throw new Error(`${context}: ${msg} (code=${code})`);
};

const assertMiniMaxApiKey = () => {
  const apiKey = getMiniMaxApiKey();
  if (!apiKey) {
    throw new Error(
      'MiniMax API key is not configured. Set MINIMAX_API_KEY or configure MiniMax provider.',
    );
  }
  return apiKey;
};

const getMiniMaxApiTimeoutMs = () => {
  const raw = Number(process.env.MINIMAX_API_TIMEOUT_MS || 25000);
  if (!Number.isFinite(raw) || raw <= 0) return 25000;
  return Math.max(3000, raw);
};

const extractTextFromMessageContent = (content: unknown): string => {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  const text = content
    .map((item: any) => {
      if (typeof item?.text === 'string') return item.text;
      if (typeof item?.output_text === 'string') return item.output_text;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();

  return text;
};

const guessImageExtFromContentType = (contentType: string) => {
  const lower = String(contentType || '').toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('webp')) return 'webp';
  return 'jpeg';
};

const guessImageExtFromPath = (filepath: string) => {
  const ext = path.extname(filepath).toLowerCase();
  if (ext === '.png') return 'png';
  if (ext === '.webp') return 'webp';
  return 'jpeg';
};

const fetchWithTimeout = async (
  url: string,
  timeoutMs: number,
  init?: RequestInit,
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));

  try {
    return await fetch(url, {
      ...init,
      cache: init?.cache ?? 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const toImageDataUrl = async (imageSource: string) => {
  const src = String(imageSource || '').trim();
  if (!src) throw new Error('image source is empty');
  if (src.startsWith('data:')) return src;

  if (/^https?:\/\//i.test(src)) {
    const timeoutMs = Number(process.env.MINIMAX_IMAGE_FETCH_TIMEOUT_MS || 12000);
    const res = await fetchWithTimeout(src, timeoutMs);
    if (!res.ok) {
      throw new Error(`failed to fetch image url: HTTP ${res.status}`);
    }
    const contentType = res.headers.get('content-type') || '';
    const ext = guessImageExtFromContentType(contentType);
    const arr = new Uint8Array(await res.arrayBuffer());
    const b64 = Buffer.from(arr).toString('base64');
    return `data:image/${ext};base64,${b64}`;
  }

  const buf = await fs.readFile(src);
  const ext = guessImageExtFromPath(src);
  return `data:image/${ext};base64,${buf.toString('base64')}`;
};

export const webSearchWithMiniMaxApi = async (query: string) => {
  const apiKey = assertMiniMaxApiKey();
  const baseURL = getMiniMaxBaseUrl();
  const res = await fetchWithTimeout(
    `${baseURL}/coding_plan/search`,
    getMiniMaxApiTimeoutMs(),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query }),
      cache: 'no-store',
    },
  );

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json?.error?.message || json?.message || `HTTP ${res.status}`;
    throw new Error(`MiniMax coding_plan/search failed: ${detail}`);
  }
  assertBaseRespOk(json, 'MiniMax coding_plan/search failed');

  return json;
};

export const understandImageWithMiniMaxVlm = async ({
  imageUrl,
  prompt,
}: {
  imageUrl: string;
  prompt: string;
}) => {
  const apiKey = assertMiniMaxApiKey();
  const baseURL = getMiniMaxBaseUrl();
  const imageDataUrl = await toImageDataUrl(imageUrl);
  const res = await fetchWithTimeout(
    `${baseURL}/coding_plan/vlm`,
    getMiniMaxApiTimeoutMs(),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_url: imageDataUrl,
      }),
      cache: 'no-store',
    },
  );

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json?.error?.message || json?.message || `HTTP ${res.status}`;
    throw new Error(`MiniMax coding_plan/vlm failed: ${detail}`);
  }
  assertBaseRespOk(json, 'MiniMax coding_plan/vlm failed');

  const text = String(json?.content || '').trim();
  if (!text) {
    throw new Error('MiniMax coding_plan/vlm returned empty content');
  }

  return {
    text,
    raw: json,
  };
};

export const understandImageWithMiniMaxApi = async ({
  imageUrl,
  prompt,
  model,
}: {
  imageUrl: string;
  prompt: string;
  model?: string;
}) => {
  const apiKey = assertMiniMaxApiKey();
  const baseURL = getMiniMaxBaseUrl();
  const selectedModel = (model || getMiniMaxDefaultModel() || 'MiniMax-M2.7').trim();
  let imageDataUrl = '';

  try {
    imageDataUrl = await toImageDataUrl(imageUrl);
  } catch (err: any) {
    console.warn('[minimax/vision] failed to convert image to data url, keep raw URL payload:', err);
  }

  const payloadCandidates: Record<string, unknown>[] = [
    {
      model: selectedModel,
      stream: false,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
    },
    ...(imageDataUrl
      ? [
          {
            model: selectedModel,
            stream: false,
            temperature: 0.2,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  {
                    type: 'image_url',
                    image_url: {
                      url: imageDataUrl,
                    },
                  },
                ],
              },
            ],
          },
          {
            model: selectedModel,
            stream: false,
            temperature: 0.2,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  {
                    type: 'image_url',
                    image_url: imageDataUrl,
                  },
                ],
              },
            ],
          },
        ]
      : []),
    {
      model: selectedModel,
      stream: false,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: imageUrl,
            },
          ],
        },
      ],
    },
    {
      model: selectedModel,
      stream: false,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: `${prompt}\n图片URL：${imageUrl}`,
        },
      ],
    },
  ];

  let lastError: Error | null = null;
  for (const payload of payloadCandidates) {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `${baseURL}/chat/completions`,
        getMiniMaxApiTimeoutMs(),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          cache: 'no-store',
        },
      );
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const timeoutLike = /abort|timed?\s*out|timeout/i.test(
        String(lastError.message || ''),
      );
      // Timeout-like failures are unlikely to succeed by retrying payload variants.
      if (timeoutLike) break;
      continue;
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = json?.error?.message || json?.message || `HTTP ${res.status}`;
      lastError = new Error(`MiniMax vision API failed: ${detail}`);
      continue;
    }
    try {
      assertBaseRespOk(json, 'MiniMax vision API failed');
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }

    const content = json?.choices?.[0]?.message?.content;
    const text = extractTextFromMessageContent(content) || JSON.stringify(content || json);
    const missImage = /(没有看到.*图|没有看到任何图片|没有上传图片|未上传图片|未提供图片|请上传图片|似乎没有上传|didn.?t see any image|cannot see (the )?image|can.?t see (the )?image|no image provided|no picture provided|no picture attached|there'?s no picture|share (the )?image|please upload( an)? image)/i.test(
      text,
    );
    if (!missImage) {
      return {
        model: selectedModel,
        text,
        raw: json,
      };
    }
  }

  if (lastError) throw lastError;
  throw new Error('MiniMax vision API did not return a valid image understanding result');
};

const normalizeImageItems = (json: any): string[] => {
  const candidates: any[] = [];
  if (Array.isArray(json?.data)) candidates.push(...json.data);
  if (Array.isArray(json?.data?.image_urls)) {
    json.data.image_urls.forEach((url: string) => candidates.push({ url }));
  }
  if (Array.isArray(json?.images)) candidates.push(...json.images);
  if (Array.isArray(json?.output?.images)) candidates.push(...json.output.images);

  const urls = candidates
    .map((item) => {
      const url = item?.url || item?.image_url || item?.imageUrl;
      if (typeof url === 'string' && url.trim()) return url.trim();

      const b64 = item?.b64_json || item?.base64 || item?.image_base64;
      if (typeof b64 === 'string' && b64.trim()) {
        return `data:image/png;base64,${b64.trim()}`;
      }

      return '';
    })
    .filter(Boolean);

  return urls;
};

export const generateImageWithMiniMaxApi = async ({
  prompt,
  aspectRatio,
  size,
  model,
}: {
  prompt: string;
  aspectRatio?: string;
  size?: string;
  model?: string;
}) => {
  const apiKey = assertMiniMaxApiKey();
  const baseURL = getMiniMaxBaseUrl();
  const selectedModel = String(model || getImageModel()).trim();

  const payload: Record<string, unknown> = {
    model: selectedModel,
    prompt,
    response_format: 'url',
  };
  if (aspectRatio) payload.aspect_ratio = aspectRatio;
  if (size) payload.size = size;

  const res = await fetchWithTimeout(
    `${baseURL}/image_generation`,
    getMiniMaxApiTimeoutMs(),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    },
  );

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json?.error?.message || json?.message || `HTTP ${res.status}`;
    throw new Error(`MiniMax image_generation failed: ${detail}`);
  }
  assertBaseRespOk(json, 'MiniMax image_generation failed');

  const images = normalizeImageItems(json);
  if (images.length === 0) {
    throw new Error('MiniMax image_generation returned no image URLs');
  }

  return {
    model: selectedModel,
    images,
    raw: json,
  };
};
