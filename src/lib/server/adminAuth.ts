const getIncomingToken = (req: Request): string => {
  const headers = new Headers(req.headers);
  const fromHeader = headers.get('x-admin-token')?.trim();
  if (fromHeader) return fromHeader;

  const auth = headers.get('authorization')?.trim() || '';
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || '';
};

export const requireAdmin = (req: Request): Response | null => {
  const configured = (process.env.ADMIN_ACCESS_TOKEN || '').trim();

  // Backward compatible: if not configured, do not enforce.
  if (!configured) return null;

  const token = getIncomingToken(req);
  if (!token || token !== configured) {
    return Response.json(
      { message: 'Admin authorization required.' },
      { status: 401 },
    );
  }

  return null;
};
