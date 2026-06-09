export const normalizePushOrigin = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
};

const parseOriginList = (value: string | undefined): string[] =>
  (value || '')
    .split(',')
    .map((origin) => normalizePushOrigin(origin))
    .filter((origin): origin is string => Boolean(origin));

export const getConfiguredPushOrigins = (
  env: NodeJS.ProcessEnv = process.env,
  fallbackOrigins: string[] = []
): string[] => {
  const configured = [
    ...parseOriginList(env.PUSH_ALLOWED_ORIGINS),
    ...parseOriginList(env.PUBLIC_SITE_URL),
    ...parseOriginList(env.SITE_URL),
    ...parseOriginList(env.NEXT_PUBLIC_SITE_URL)
  ];

  if (configured.length > 0) {
    return Array.from(new Set(configured));
  }

  if (env.NODE_ENV === 'production') {
    return ['https://chikapo.yuaru.com'];
  }

  return Array.from(new Set(fallbackOrigins.map(normalizePushOrigin).filter((origin): origin is string => Boolean(origin))));
};

export const getRequestPushOrigin = (
  explicitOrigin: unknown,
  headerOrigin: unknown,
  referer: unknown
): string | null =>
  normalizePushOrigin(explicitOrigin) ||
  normalizePushOrigin(headerOrigin) ||
  normalizePushOrigin(referer);

export const isPushOriginAllowed = (origin: string | null, allowedOrigins: string[]): boolean => {
  if (allowedOrigins.length === 0) return true;
  return Boolean(origin && allowedOrigins.includes(origin));
};

export const filterPushSubscriptionsByOrigin = <T extends Record<string, any>>(
  subscriptions: T[],
  allowedOrigins: string[]
): T[] => {
  if (allowedOrigins.length === 0) return subscriptions;

  // Older deployments may not have the origin column yet. Keep delivery unchanged
  // until the schema migration is applied, then origin-less legacy rows are filtered out.
  const hasOriginColumn = subscriptions.some((sub) =>
    Object.prototype.hasOwnProperty.call(sub, 'origin')
  );
  if (!hasOriginColumn) return subscriptions;

  return subscriptions.filter((sub) =>
    isPushOriginAllowed(normalizePushOrigin(sub.origin), allowedOrigins)
  );
};
