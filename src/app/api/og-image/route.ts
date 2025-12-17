import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const isPrivateIpLiteral = (host: string) => {
  // IPv4 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split('.').map((n) => Number(n));
    if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;

    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }

  const lowered = host.toLowerCase();
  if (
    lowered === 'localhost' ||
    lowered.endsWith('.localhost') ||
    lowered === '0.0.0.0' ||
    lowered === '::1'
  ) {
    return true;
  }

  return false;
};

const normalizePageUrl = (raw: string) => {
  const decoded = decodeURIComponent(raw);
  const url = new URL(decoded);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http/https are allowed');
  }
  if (isPrivateIpLiteral(url.hostname)) {
    throw new Error('Blocked host');
  }
  return url;
};

const extractMetaContent = (html: string, matcher: RegExp) => {
  const match = html.match(matcher);
  if (!match?.[1]) return '';
  return match[1].trim();
};

const extractOgImage = (html: string) => {
  // property="og:image" content="..."
  const og =
    extractMetaContent(
      html,
      /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    ) ||
    extractMetaContent(
      html,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["'][^>]*>/i,
    );

  const twitter =
    extractMetaContent(
      html,
      /<meta[^>]+(?:property|name)=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    ) ||
    extractMetaContent(
      html,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']twitter:image(?::src)?["'][^>]*>/i,
    );

  const imageSrc =
    extractMetaContent(
      html,
      /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["'][^>]*>/i,
    ) ||
    extractMetaContent(
      html,
      /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']image_src["'][^>]*>/i,
    );

  return og || twitter || imageSrc || '';
};

const extractPreloadImage = (html: string) => {
  const linkRe = /<link\b[^>]*>/gi;
  const candidates: string[] = [];
  let match: RegExpExecArray | null;

  // eslint-disable-next-line no-cond-assign
  while ((match = linkRe.exec(html))) {
    const tag = match[0] || '';
    const attrs = parseImgAttributes(tag);

    const rel = (attrs.rel || '').toLowerCase();
    const as = (attrs.as || '').toLowerCase();
    if (!rel.includes('preload') || as !== 'image') continue;

    if (attrs.href && looksLikeImageUrl(attrs.href)) candidates.push(attrs.href);
    if (attrs.imagesrcset) {
      const picked = pickFromSrcset(attrs.imagesrcset);
      if (picked && looksLikeImageUrl(picked)) candidates.push(picked);
    }

    if (candidates.length >= 20) break;
  }

  if (!candidates.length) return '';

  let best = candidates[0]!;
  let bestScore = scoreImageCandidate(best);
  for (const candidate of candidates.slice(1)) {
    const score = scoreImageCandidate(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return bestScore < -3 ? '' : best;
};

const parseImgAttributes = (tag: string) => {
  const attrs: Record<string, string> = {};
  const attrRe =
    /([a-zA-Z0-9_:\\-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = attrRe.exec(tag))) {
    const key = (match[1] || '').toLowerCase();
    const value = (match[2] ?? match[3] ?? match[4] ?? '').trim();
    if (!key || !value) continue;
    attrs[key] = value;
  }
  return attrs;
};

const pickFromSrcset = (srcset: string) => {
  // "url1 1x, url2 2x" or "url1 400w, url2 800w"
  const first = srcset.split(',')[0]?.trim() ?? '';
  if (!first) return '';
  return first.split(/\s+/)[0]?.trim() ?? '';
};

const looksLikeImageUrl = (value: string) => {
  const url = value.toLowerCase();
  if (!url) return false;
  if (url.startsWith('data:')) return false;
  if (url.endsWith('.svg')) return false;
  if (url.includes('favicon')) return false;
  return true;
};

const scoreImageCandidate = (value: string) => {
  const url = value.toLowerCase();
  let score = 0;

  if (url.includes('nmediafile')) score += 8;
  if (url.includes('wpimg') || url.includes('upload') || url.includes('image'))
    score += 4;
  if (url.match(/\.(jpg|jpeg|png|webp)(\?|#|$)/)) score += 3;
  if (url.match(/\.(gif)(\?|#|$)/)) score += 1;
  if (url.includes('lazyload')) score -= 5;

  if (url.includes('logo')) score -= 8;
  if (url.includes('icon') || url.includes('sprite') || url.includes('avatar'))
    score -= 6;
  if (url.includes('ads') || url.includes('banner')) score -= 3;

  return score;
};

const extractFirstContentImage = (html: string) => {
  // Try to find a plausible content image from <img> tags (many CN sites don't expose og:image).
  const imgRe = /<img\b[^>]*>/gi;
  const candidates: string[] = [];
  let match: RegExpExecArray | null;

  // eslint-disable-next-line no-cond-assign
  while ((match = imgRe.exec(html))) {
    const tag = match[0] || '';
    const attrs = parseImgAttributes(tag);
    const preferredKeys = [
      'data-original',
      'data-src',
      'data-lazy-src',
      'data-echo',
      'data-url',
      'src',
    ];

    let picked = '';
    for (const key of preferredKeys) {
      if (attrs[key]) {
        picked = attrs[key];
        break;
      }
    }

    if (!picked && attrs.srcset) {
      picked = pickFromSrcset(attrs.srcset);
    }

    if (!picked) continue;
    if (!looksLikeImageUrl(picked)) continue;

    candidates.push(picked);
    if (candidates.length >= 30) break;
  }

  if (!candidates.length) return '';

  let best = candidates[0]!;
  let bestScore = scoreImageCandidate(best);
  for (const candidate of candidates.slice(1)) {
    const score = scoreImageCandidate(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  // If the best one still looks like a logo/icon, allow empty fallback.
  if (bestScore < -3) return '';
  return best;
};

const ogCache = new Map<string, { imageUrl: string; expiresAt: number }>();
const OG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const OG_NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000;
const OG_CACHE_MAX = 500;

const getFromCache = (key: string) => {
  const hit = ogCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    ogCache.delete(key);
    return null;
  }
  return hit.imageUrl;
};

const setCache = (key: string, imageUrl: string, ttlMs = OG_CACHE_TTL_MS) => {
  ogCache.set(key, { imageUrl, expiresAt: Date.now() + ttlMs });
  if (ogCache.size <= OG_CACHE_MAX) return;
  const firstKey = ogCache.keys().next().value as string | undefined;
  if (firstKey) ogCache.delete(firstKey);
};

const fetchWithTimeout = async (
  url: URL,
  init: RequestInit & { timeoutMs?: number } = {},
) => {
  const timeoutMs = init.timeoutMs ?? 8_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const readFirstBytes = async (res: Response, maxBytes: number) => {
  const body = res.body;
  if (!body) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > maxBytes ? buf.subarray(0, maxBytes) : buf;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (received < maxBytes) {
    const { value, done } = await reader.read();
    if (done || !value) break;

    const remaining = maxBytes - received;
    if (value.byteLength > remaining) {
      chunks.push(value.subarray(0, remaining));
      received += remaining;
      break;
    }

    chunks.push(value);
    received += value.byteLength;
  }

  try {
    await reader.cancel();
  } catch {
    // ignore
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
};

export const GET = async (req: NextRequest) => {
  const urlParam = req.nextUrl.searchParams.get('url');
  if (!urlParam) {
    return Response.json({ message: 'Missing url' }, { status: 400 });
  }

  const requestBase = new URL(req.url);

  let pageUrl: URL;
  try {
    pageUrl = normalizePageUrl(urlParam);
  } catch (err: any) {
    return Response.json(
      { message: err?.message ?? 'Invalid url' },
      { status: 400 },
    );
  }

  const cacheKey = pageUrl.toString();
  const cached = getFromCache(cacheKey);
  if (cached) {
    const target =
      cached === '__none__'
        ? new URL('/dr-lemon-logo.svg', requestBase)
        : new URL(
            `/api/image-proxy?url=${encodeURIComponent(cached)}`,
            requestBase,
          );
    return Response.redirect(target, 307);
  }

  try {
    const maxBytes = 1 * 1024 * 1024;

    const fetchHtmlChunk = async (range?: string) => {
      const res = await fetchWithTimeout(pageUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; FinanceAI/1.0; +https://github.com/leecyno1/finance-ai-llm)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...(range ? { Range: range } : {}),
        },
        redirect: 'follow',
        cache: 'no-store',
        timeoutMs: 8_000,
      });

      if (!res.ok) return null;
      const buf = await readFirstBytes(res, maxBytes);
      return buf.toString('utf8');
    };

    // First try: head chunk.
    const headHtml = await fetchHtmlChunk();
    if (!headHtml) {
      setCache(cacheKey, '__none__', OG_NEGATIVE_CACHE_TTL_MS);
      return Response.redirect(new URL('/dr-lemon-logo.svg', requestBase), 307);
    }

    let found =
      extractOgImage(headHtml) ||
      extractPreloadImage(headHtml) ||
      extractFirstContentImage(headHtml);

    // Some sites (notably WordPress templates) render og:image near the end of the HTML.
    if (!found) {
      const tailHtml = await fetchHtmlChunk('bytes=-1048575');
      if (tailHtml) {
        found =
          extractOgImage(tailHtml) ||
          extractPreloadImage(tailHtml) ||
          extractFirstContentImage(tailHtml);
      }
    }

    if (!found) {
      setCache(cacheKey, '__none__', OG_NEGATIVE_CACHE_TTL_MS);
      return Response.redirect(new URL('/dr-lemon-logo.svg', requestBase), 307);
    }

    const resolved = new URL(found, pageUrl).toString();
    setCache(cacheKey, resolved);
    return Response.redirect(
      new URL(
        `/api/image-proxy?url=${encodeURIComponent(resolved)}`,
        requestBase,
      ),
      307,
    );
  } catch (err: any) {
    setCache(cacheKey, '__none__', OG_NEGATIVE_CACHE_TTL_MS);
    if (err?.name === 'AbortError') {
      return Response.redirect(new URL('/dr-lemon-logo.svg', requestBase), 307);
    }
    return Response.redirect(new URL('/dr-lemon-logo.svg', requestBase), 307);
  }
};
