// Expiry of a schedule's authorization attestation. A schedule only scans
// while its authorization is current. Once it expires, runs are skipped
// (with the reason shown) until someone re-attests and picks a new expiry.
// Pure and dependency-free so the dashboard can use it too.

// Offered in the dashboard; any date up to MAX_AUTHORIZATION_DAYS ahead can
// also be picked.
export const AUTHORIZATION_PRESET_DAYS = [30, 90, 180, 365] as const;
export const DEFAULT_AUTHORIZATION_DAYS = 90;
export const MAX_AUTHORIZATION_DAYS = 365;

// Warn in the UI when this close to expiry.
export const EXPIRING_SOON_DAYS = 7;

// Schedules created before expiry existed have no expiry stored; treat them
// as authorized for this long after the attestation.
export const LEGACY_AUTHORIZATION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Returns a human-readable problem with a requested expiry, or null if it's
 * acceptable. Allows one extra day beyond the maximum so "end of the last
 * allowed day" in any timezone passes.
 */
export function validateAuthorizationExpiry(expiresAt: Date, now: Date): string | null {
  if (Number.isNaN(expiresAt.getTime())) return "Authorization expiry is not a valid date.";
  if (expiresAt.getTime() <= now.getTime()) return "Authorization expiry must be in the future.";
  if (expiresAt.getTime() > addDays(now, MAX_AUTHORIZATION_DAYS + 1).getTime()) {
    return `Authorization can be valid for at most ${MAX_AUTHORIZATION_DAYS} days.`;
  }
  return null;
}

export function isAuthorizationExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

export type AuthorizationState = "valid" | "expiring-soon" | "expired";

export function authorizationState(expiresAt: Date, now: Date): AuthorizationState {
  if (isAuthorizationExpired(expiresAt, now)) return "expired";
  if (expiresAt.getTime() - now.getTime() <= EXPIRING_SOON_DAYS * DAY_MS) return "expiring-soon";
  return "valid";
}

/** Whole days until expiry, rounded up (0 once expired). */
export function daysUntil(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS));
}

// Start of the lastError recorded when a run is skipped for this reason, so a
// renewal can clear it (the problem it describes is resolved).
export const AUTHORIZATION_EXPIRED_ERROR_PREFIX = "Authorization expired";
