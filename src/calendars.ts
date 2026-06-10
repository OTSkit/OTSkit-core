// src/calendars.ts
//
// Single source of truth for the OpenTimestamps calendar topology used across
// the whole @otskit toolkit. Core owns this data; @otskit/client and
// @otskit/mcp must import from here instead of re-declaring their own copies,
// so that a calendar domain change is a one-line edit in one place.

/**
 * Base registrable domains operated by known OpenTimestamps calendar providers.
 * A hostname is considered "broadly trusted" iff it is a sub-domain of one of
 * these. This is the loosest trust tier and powers {@link CALENDAR_ALLOWLIST}.
 */
export const TRUSTED_CALENDAR_DOMAINS = [
  'opentimestamps.org',
  'eternitywall.com',
  'catallaxy.com',
] as const;

/**
 * Narrow host-pattern tier: the exact wildcard authorities that may serve
 * calendar attestations. Stricter than {@link TRUSTED_CALENDAR_DOMAINS}; the
 * client builds its URL whitelist from these.
 */
export const TRUSTED_CALENDAR_WHITELIST_PATTERNS = [
  'https://*.calendar.opentimestamps.org', // Peter Todd
  'https://*.btc.calendar.opentimestamps.org', // Peter Todd (Bitcoin)
  'https://*.calendar.eternitywall.com', // Eternity Wall
  'https://*.calendar.catallaxy.com', // Catallaxy
] as const;

/** Default calendar servers used when stamping / upgrading a timestamp. */
export const DEFAULT_CALENDAR_URLS = [
  'https://alice.btc.calendar.opentimestamps.org',
  'https://bob.btc.calendar.opentimestamps.org',
  'https://finney.calendar.eternitywall.com',
  'https://btc.calendar.catallaxy.com',
] as const;

/** Default aggregator pool endpoints. */
export const DEFAULT_AGGREGATOR_URLS = [
  'https://a.pool.opentimestamps.org',
  'https://b.pool.opentimestamps.org',
  'https://a.pool.eternitywall.com',
  'https://ots.btc.catallaxy.com',
] as const;

/** Escapes a literal string for safe interpolation into a RegExp. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Broad allowlist of calendar URIs, derived from {@link TRUSTED_CALENDAR_DOMAINS}.
 * Each entry matches any host ending in `.<domain>` (e.g. `a.pool.opentimestamps.org`).
 * Used by `parseCalendarUri`. Kept as derived data so the domain list stays canonical.
 */
export const CALENDAR_ALLOWLIST: ReadonlyArray<RegExp> = TRUSTED_CALENDAR_DOMAINS.map(
  (domain) => new RegExp(`\\.${escapeRegExp(domain)}$`, 'i'),
);
