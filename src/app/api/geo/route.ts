type GeoResult = {
  latitude: number;
  longitude: number;
  city: string;
  source: 'ip' | 'default';
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT: GeoResult = {
  latitude: 39.9042,
  longitude: 116.4074,
  city: 'Beijing',
  source: 'default',
};

const isPrivateIp = (ip: string) => {
  const normalized = ip.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === '127.0.0.1' || normalized === '::1') return true;
  if (normalized.startsWith('10.')) return true;
  if (normalized.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return true;
  if (normalized.startsWith('fd') || normalized.startsWith('fc')) return true; // IPv6 ULA
  if (normalized.startsWith('fe80:')) return true; // IPv6 link-local
  return false;
};

const extractIp = (headers: Headers): string | null => {
  const direct =
    headers.get('cf-connecting-ip') ||
    headers.get('x-real-ip') ||
    headers.get('x-client-ip');
  if (direct) return direct.split(',')[0]?.trim() || null;

  const forwarded = headers.get('x-forwarded-for');
  if (!forwarded) return null;
  return forwarded.split(',')[0]?.trim() || null;
};

const stripPort = (ip: string) => {
  const s = ip.trim();
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    if (end > 0) return s.slice(1, end);
  }
  // "1.2.3.4:12345"
  if (s.includes(':') && s.split(':').length === 2 && /^\d+\.\d+\.\d+\.\d+:\d+$/.test(s)) {
    return s.split(':')[0]!;
  }
  return s;
};

const GEO_TTL_MS = 24 * 60 * 60 * 1000;
const geoCache = new Map<string, { value: GeoResult; expiresAt: number }>();

const getCached = (ip: string): GeoResult | null => {
  const cached = geoCache.get(ip);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    geoCache.delete(ip);
    return null;
  }
  return cached.value;
};

const setCached = (ip: string, value: GeoResult) => {
  geoCache.set(ip, { value, expiresAt: Date.now() + GEO_TTL_MS });
};

export const GET = async (req: Request) => {
  try {
    const ipRaw = extractIp(new Headers(req.headers));
    const ip = ipRaw ? stripPort(ipRaw) : null;

    if (!ip || isPrivateIp(ip)) {
      return Response.json(DEFAULT, { status: 200 });
    }

    const cached = getCached(ip);
    if (cached) return Response.json(cached, { status: 200 });

    const url = `https://ipwho.is/${encodeURIComponent(
      ip,
    )}?fields=success,city,latitude,longitude`;
    const res = await fetch(url, {
      headers: { 'user-agent': 'finance-ai-llm/geo' },
      cache: 'no-store',
    });

    if (!res.ok) return Response.json(DEFAULT, { status: 200 });
    const data = (await res.json()) as {
      success?: boolean;
      city?: string;
      latitude?: number;
      longitude?: number;
    };

    if (!data.success || !data.latitude || !data.longitude) {
      return Response.json(DEFAULT, { status: 200 });
    }

    const result: GeoResult = {
      latitude: data.latitude,
      longitude: data.longitude,
      city: data.city?.trim() || DEFAULT.city,
      source: 'ip',
    };
    setCached(ip, result);
    return Response.json(result, { status: 200 });
  } catch (err) {
    console.warn('Failed to resolve geo by IP; falling back to Beijing', err);
    return Response.json(DEFAULT, { status: 200 });
  }
};

