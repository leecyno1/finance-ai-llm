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

const ogCache = new Map<string, { imageUrl: string; expiresAt: number }>();
const OG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
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

const setCache = (key: string, imageUrl: string) => {
  ogCache.set(key, { imageUrl, expiresAt: Date.now() + OG_CACHE_TTL_MS });
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
    const res = await fetchWithTimeout(pageUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; FinanceAI/1.0; +https://github.com/leecyno1/finance-ai-llm)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      cache: 'no-store',
      timeoutMs: 8_000,
    });

    if (!res.ok) {
      setCache(cacheKey, '__none__');
      return Response.redirect(new URL('/dr-lemon-logo.svg', requestBase), 307);
    }

    const maxBytes = 1 * 1024 * 1024;
    const lengthHeader = res.headers.get('content-length');
    if (lengthHeader && Number(lengthHeader) > maxBytes) {
      setCache(cacheKey, '__none__');
      return Response.redirect(new URL('/dr-lemon-logo.svg', requestBase), 307);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      setCache(cacheKey, '__none__');
      return Response.redirect(new URL('/dr-lemon-logo.svg', requestBase), 307);
    }

    const html = buf.toString('utf8');
    const found = extractOgImage(html);
    if (!found) {
      setCache(cacheKey, '__none__');
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
    setCache(cacheKey, '__none__');
    if (err?.name === 'AbortError') {
      return Response.redirect(new URL('/dr-lemon-logo.svg', requestBase), 307);
    }
    return Response.redirect(new URL('/dr-lemon-logo.svg', requestBase), 307);
  }
};
