const getAbsoluteApiOrigin = (apiBaseUrl: string) => {
  try {
    return /^https?:\/\//i.test(apiBaseUrl) ? new URL(apiBaseUrl).origin : '';
  } catch {
    return '';
  }
};

export const resolveArenaAssetUrlForBase = (value: unknown, apiBaseUrl: string) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;

  if (/^https?:\/\//i.test(raw) && raw.includes('/uploads/')) {
    const backendOrigin = getAbsoluteApiOrigin(apiBaseUrl);
    if (!backendOrigin) return raw;
    try {
      const parsed = new URL(raw);
      const backend = new URL(backendOrigin);
      if (parsed.hostname !== backend.hostname) return raw;
      const uploadsIndex = parsed.pathname.indexOf('/uploads/');
      return uploadsIndex >= 0
        ? `${backendOrigin}${parsed.pathname.slice(uploadsIndex)}${parsed.search}${parsed.hash}`
        : raw;
    } catch {
      return raw;
    }
  }

  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/uploads/') || raw.startsWith('uploads/')) {
    const backendOrigin = getAbsoluteApiOrigin(apiBaseUrl);
    const cleanPath = raw.startsWith('/') ? raw : `/${raw}`;
    return backendOrigin ? `${backendOrigin}${cleanPath}` : cleanPath;
  }
  if (raw.startsWith('/')) return raw;
  return '';
};
