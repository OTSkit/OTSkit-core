// test/calendars.test.ts
import { describe, it, expect } from 'vitest';
import {
  TRUSTED_CALENDAR_DOMAINS,
  TRUSTED_CALENDAR_WHITELIST_PATTERNS,
  DEFAULT_CALENDAR_URLS,
  DEFAULT_AGGREGATOR_URLS,
  CALENDAR_ALLOWLIST,
  parseCalendarUri,
} from '../src/index.js';

/** True if `host` matches at least one allowlist regex. */
function allowed(host: string): boolean {
  return CALENDAR_ALLOWLIST.some((re) => re.test(host));
}

describe('canonical calendar data', () => {
  it('exposes the three trusted base domains', () => {
    expect([...TRUSTED_CALENDAR_DOMAINS]).toEqual([
      'opentimestamps.org',
      'eternitywall.com',
      'catallaxy.com',
    ]);
  });

  it('default calendar URLs are https and end in a trusted domain', () => {
    expect(DEFAULT_CALENDAR_URLS.length).toBeGreaterThan(0);
    for (const url of DEFAULT_CALENDAR_URLS) {
      const u = new URL(url);
      expect(u.protocol).toBe('https:');
      expect(TRUSTED_CALENDAR_DOMAINS.some((d) => u.hostname.endsWith('.' + d))).toBe(true);
    }
  });

  it('default aggregator URLs are https and end in a trusted domain', () => {
    expect(DEFAULT_AGGREGATOR_URLS.length).toBeGreaterThan(0);
    for (const url of DEFAULT_AGGREGATOR_URLS) {
      const u = new URL(url);
      expect(u.protocol).toBe('https:');
      expect(TRUSTED_CALENDAR_DOMAINS.some((d) => u.hostname.endsWith('.' + d))).toBe(true);
    }
  });

  it('whitelist patterns are https wildcards under trusted domains', () => {
    for (const pattern of TRUSTED_CALENDAR_WHITELIST_PATTERNS) {
      expect(pattern.startsWith('https://*.')).toBe(true);
      const host = new URL(pattern.replace('*.', '')).hostname;
      expect(TRUSTED_CALENDAR_DOMAINS.some((d) => host === d || host.endsWith('.' + d))).toBe(true);
    }
  });
});

describe('CALENDAR_ALLOWLIST (derived)', () => {
  it('reproduces the historical three-regex allowlist exactly', () => {
    // Byte-for-byte stable: regression guard against accidental tightening/loosening.
    expect(CALENDAR_ALLOWLIST.map((re) => re.source)).toEqual([
      '\\.opentimestamps\\.org$',
      '\\.eternitywall\\.com$',
      '\\.catallaxy\\.com$',
    ]);
    expect(CALENDAR_ALLOWLIST.every((re) => re.flags.includes('i'))).toBe(true);
  });

  it('matches sub-domains of trusted providers', () => {
    expect(allowed('a.pool.opentimestamps.org')).toBe(true);
    expect(allowed('alice.btc.calendar.opentimestamps.org')).toBe(true);
    expect(allowed('finney.calendar.eternitywall.com')).toBe(true);
    expect(allowed('btc.calendar.catallaxy.com')).toBe(true);
  });

  it('every default calendar and aggregator host is allowlisted', () => {
    for (const url of [...DEFAULT_CALENDAR_URLS, ...DEFAULT_AGGREGATOR_URLS]) {
      expect(allowed(new URL(url).hostname)).toBe(true);
    }
  });

  it('rejects look-alike and suffix-injection hosts', () => {
    expect(allowed('opentimestamps.org.evil.com')).toBe(false);
    expect(allowed('evil-opentimestamps.org')).toBe(false); // no leading dot boundary
    expect(allowed('opentimestamps.org')).toBe(false); // bare apex, no sub-domain dot
    expect(allowed('attacker.com')).toBe(false);
  });

  it('treats the dot as a literal, not a regex wildcard', () => {
    // If the domain were interpolated unescaped, "Xopentimestamps.org" would match.
    expect(allowed('aXopentimestampsXorg')).toBe(false);
  });
});

describe('parseCalendarUri uses the canonical allowlist', () => {
  it('accepts a trusted aggregator URL', () => {
    expect(parseCalendarUri('https://a.pool.opentimestamps.org')).toBe(
      'https://a.pool.opentimestamps.org/',
    );
  });

  it('rejects an untrusted host', () => {
    expect(() => parseCalendarUri('https://evil.com')).toThrow();
  });
});
