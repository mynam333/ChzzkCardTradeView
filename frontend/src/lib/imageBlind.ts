export const normalizeImageBlindKey = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return '';
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(raw) && !raw.startsWith('/')) {
    return raw.split(/[?#]/, 1)[0].trim().toLowerCase().slice(0, 512);
  }

  try {
    const parsed = new URL(raw, 'https://chikapo.local');
    const proxied = parsed.searchParams.get('url');
    if (proxied && parsed.pathname.includes('image-proxy')) {
      return normalizeImageBlindKey(proxied);
    }
    const path = parsed.pathname.replace(/\/+/g, '/');
    if (path.startsWith('/uploads/')) return path.toLowerCase().slice(0, 512);
    return `${parsed.hostname.toLowerCase()}${path}`.slice(0, 512);
  } catch {
    return raw.split(/[?#]/, 1)[0].trim().toLowerCase().slice(0, 512);
  }
};
