import { DeletedUserAccount } from '../repositories/interfaces';

export const DEFAULT_ACCOUNT_INTERACTION_RESTRICTION_MS = 24 * 60 * 60 * 1000;

export const parseAccountInteractionRestrictionMs = (
  rawValue: string | number | undefined,
  fallbackMs = DEFAULT_ACCOUNT_INTERACTION_RESTRICTION_MS
): number => {
  if (rawValue === undefined || rawValue === null || rawValue === '') return fallbackMs;

  const raw = String(rawValue).trim().toLowerCase();
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return Math.max(0, numeric);

  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/);
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2];
    const multiplier = unit === 'ms'
      ? 1
      : unit === 's'
        ? 1000
        : unit === 'm'
          ? 60 * 1000
          : unit === 'h'
            ? 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;
    return Math.max(0, Math.floor(amount * multiplier));
  }

  return fallbackMs;
};

export const ACCOUNT_INTERACTION_RESTRICTION_MS = parseAccountInteractionRestrictionMs(
  process.env.ACCOUNT_INTERACTION_RESTRICTION_MS
);

export const parseDeletedAccountTime = (deletedAt?: string | Date | null): number | null => {
  if (!deletedAt) return null;
  if (deletedAt instanceof Date) {
    const time = deletedAt.getTime();
    return Number.isFinite(time) ? time : null;
  }

  const raw = String(deletedAt).trim();
  if (!raw) return null;

  const timezoneLessDateTime = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
  const normalized = timezoneLessDateTime.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) ? time : null;
};

export const getAccountInteractionRestrictedUntil = (deletedAt?: string | Date | null): Date | null => {
  if (!deletedAt || ACCOUNT_INTERACTION_RESTRICTION_MS <= 0) return null;
  const deletedTime = parseDeletedAccountTime(deletedAt);
  if (deletedTime === null) return null;
  return new Date(deletedTime + ACCOUNT_INTERACTION_RESTRICTION_MS);
};

export const getActiveAccountInteractionRestriction = (
  deletedAccount: DeletedUserAccount | null,
  now = Date.now()
): Date | null => {
  const restrictedUntil = getAccountInteractionRestrictedUntil(deletedAccount?.deleted_at);
  if (!restrictedUntil || restrictedUntil.getTime() <= now) return null;
  return restrictedUntil;
};
