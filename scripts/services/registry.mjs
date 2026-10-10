// scripts/services/registry.mjs
// MODULE DATE: 2026-10-09 (Friday) · v0.1 — ONE reader for the source registry, scripts/ledger-allowlist.json.
//
// Jerome (source-finder) and Thomas (ledger-build) must agree on which sites count and at what tier, so both read the registry through this file.
// It only reads; the registry is edited by hand or by an approval (scripts/services/registry-dates.mjs), never from here.
//
// Registry shape: { tiers: { <tier>: { canVerify, ceiling, ... } }, domains: [ { domain, tier, enabled, ... } ] }
// A domain with enabled:false is LISTED but not approved. A tier with canVerify:false (e.g. "reported") can be used as a source, but a match on it can
// only ever be called "reported", never "verified".

import { existsSync, readFileSync } from 'node:fs';

// Read at call time, so a test (or a one-off run) can point to another file with LEDGER_ALLOWLIST_PATH.
export const allowlistPath = () => process.env.LEDGER_ALLOWLIST_PATH || 'scripts/ledger-allowlist.json';

export function loadRegistry(path = allowlistPath()) {
  if (!existsSync(path)) throw new Error('allowlist registry not found at ' + path + ' (commit scripts/ledger-allowlist.json first)');
  const r = JSON.parse(readFileSync(path, 'utf8'));
  if (!(r && r.tiers && Array.isArray(r.domains))) throw new Error('allowlist registry at ' + path + ' is not in the expected shape');
  return r;
}

// Most specific registry entry for a host (bible.usccb.org beats usccb.org).
export function regEntry(reg, host) {
  let best = null;
  for (const e of reg.domains) {
    if (host === e.domain || host.endsWith('.' + e.domain)) { if (!best || e.domain.length > best.domain.length) best = e; }
  }
  return best;
}
