import { API_BASE_URL } from './api';
import { resolveArenaAssetUrlForBase } from './arenaAssetUrl';

export { resolveArenaAssetUrlForBase } from './arenaAssetUrl';

/**
 * Arena assets are served from the backend root (`/uploads`), not the `/api`
 * namespace. Legacy upload URLs on the same backend host are normalized while
 * third-party CDN URLs remain untouched.
 */
export const resolveArenaAssetUrl = (value?: unknown) => {
  return resolveArenaAssetUrlForBase(value, API_BASE_URL);
};
