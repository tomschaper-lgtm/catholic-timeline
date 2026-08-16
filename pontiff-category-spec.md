# Spec: New "Pontiff" Category (type key `po`)

For a future Claude Code session working directly on `index.html`. Not yet built — this
describes the change needed so the 264 pontiff stub entries (`pontiff-stubs.json`) render
as their own filterable category instead of falling into an existing one.

## What to add

1. **Type key**: `po` — Pontiff. (Two letters, unlike the existing single-letter keys `s c
   p m u e`; the parser keys off exact string match so this is safe, but confirm nothing in
   the JSON-detection logic assumes single-char type values before relying on it.)
2. **Icon**: a papal tiara or crossed-keys glyph — visually distinct from the Saint halo and
   the Council temple icon, since a pope is very often *also* a saint (Peter, Leo the Great,
   Gregory the Great, Pius V, Pius X, John Paul II, etc.) and the two categories will
   frequently sit at the same year.
3. **Color**: pick something that doesn't collide with the existing six (gold/ivory/ember
   red/light blue/violet/steel blue) — a deep purple-red ("cardinal red") or antique gold
   distinct from the Saint gold reads as fitting without clashing.
4. **Filter**: add "Pontiffs" to the category filter row alongside the existing six.
5. **Facts labels**: this batch uses `Reigned` and `Birthplace (modern country)` — add these
   to whatever per-type Quick Facts vocabulary list the app enforces, or confirm it already
   accepts arbitrary labels.
6. **Lane/lay out**: with 264 entries spanning AD 32–present, expect a dense lane on the
   timeline canvas comparable to (or denser than) Saints — verify the stacking logic handles
   the added volume without perf regression, especially around the 4th–15th centuries where
   Pontiffs, Saints, and Councils will all be crowded together.

## What NOT to change

- No changes to `entries` schema itself — `po` is just a new value for the existing `t`
  field, same shape as any other entry.
- `db.locations` / `db.documents` remain out of scope for this batch.

## Not addressed by this spec

- Cross-linking pope entries to existing Saint entries for the same person (e.g. St. Leo
  the Great already has a `t:"s"` entry — decide whether the new `po` stub is a duplicate to
  merge, a companion "papacy-focused" entry to cross-link via `entry:` links, or should be
  skipped for already-sainted popes). This was intentionally left for Tom to decide before
  publishing the stub batch, since it affects ~48 of the 264 entries.
