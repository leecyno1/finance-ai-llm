import crypto from 'crypto';

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

export const getRequestIp = (headers: Headers): string | null => {
  const direct =
    headers.get('cf-connecting-ip') ||
    headers.get('x-real-ip') ||
    headers.get('x-client-ip');
  if (direct) {
    const ip = stripPort(direct.split(',')[0] || '');
    return ip && !isPrivateIp(ip) ? ip : null;
  }

  const forwarded = headers.get('x-forwarded-for');
  if (!forwarded) return null;
  const ip = stripPort(forwarded.split(',')[0] || '');
  return ip && !isPrivateIp(ip) ? ip : null;
};

export const getClientIdFromHeaders = (headers: Headers): string => {
  const ip = getRequestIp(headers);
  if (!ip) return 'anon';

  const salt = process.env.CLIENT_ID_SALT || 'finance-ai-llm';
  const hash = crypto.createHash('sha256').update(`${ip}|${salt}`).digest('hex');
  return `ip:${hash.slice(0, 16)}`;
};

