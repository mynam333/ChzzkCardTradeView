import { DeletedUserAccount } from '../repositories/interfaces';

export const ACCOUNT_INTERACTION_RESTRICTION_MS = Math.max(
  0,
  Number(process.env.ACCOUNT_INTERACTION_RESTRICTION_MS || 24 * 60 * 60 * 1000)
);

export const getAccountInteractionRestrictedUntil = (deletedAt?: string | null): Date | null => {
  if (!deletedAt || ACCOUNT_INTERACTION_RESTRICTION_MS <= 0) return null;
  const deletedTime = new Date(deletedAt).getTime();
  if (!Number.isFinite(deletedTime)) return null;
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
