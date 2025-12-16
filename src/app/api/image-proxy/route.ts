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

  // Basic localhost / loopback hostname blocks (best-effort)
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

const normalizeUpstreamUrl = (raw: string) => {
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

export const GET = async (req: NextRequest) => {
  const urlParam = req.nextUrl.searchParams.get('url');
  if (!urlParam) {
    return Response.json({ message: 'Missing url' }, { status: 400 });
  }

  let upstream: URL;
  try {
    upstream = normalizeUpstreamUrl(urlParam);
  } catch (err: any) {
    return Response.json(
      { message: err?.message ?? 'Invalid url' },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(upstream, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Many sites block unknown/no UA for images.
        'User-Agent':
          'Mozilla/5.0 (compatible; FinanceAI/1.0; +https://github.com/leecyno1/finance-ai-llm)',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return Response.json(
        { message: `Upstream error: ${res.status}` },
        { status: 502 },
      );
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType && !contentType.toLowerCase().startsWith('image/')) {
      return Response.json(
        { message: 'Upstream is not an image' },
        { status: 415 },
      );
    }

    const maxBytes = 8 * 1024 * 1024;
    const lengthHeader = res.headers.get('content-length');
    if (lengthHeader && Number(lengthHeader) > maxBytes) {
      return Response.json({ message: 'Image too large' }, { status: 413 });
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      return Response.json({ message: 'Image too large' }, { status: 413 });
    }

    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': contentType || 'image/*',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return Response.json({ message: 'Timeout' }, { status: 504 });
    }
    return Response.json({ message: 'Failed to fetch image' }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
};

