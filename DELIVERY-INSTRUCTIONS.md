# How Claude delivers files in this project

**Last updated:** 2026-10-08 (Thursday) · v2 (adds patch mode and the article log)
**For:** any Claude chat in the Church Timeline Website project. Read this before handing Tom any file.

## The situation

- Claude's chat sandbox has **no network and no way to push to GitHub**. Claude cannot commit. Do not say or imply that it can.
- Tom works **from his phone**. Navigating folders and uploading many files one by one is error-prone for him. Make delivery as few taps as possible.
- Tom's repo has a service that does the placing: `scripts/services/place-files.mjs`, run by `.github/workflows/place-files.yml`. Claude hands over **one bundle file**; Tom uploads it; GitHub unpacks it, checks it, runs its tests, and commits.

## The normal delivery: one bundle

1. Build and test everything in the sandbox first (see "Before sending" below).
2. Make the bundle with the tool, never by hand:

   ```
   node scripts/services/place-files.mjs --make \
     --message "Short commit message" \
     --out <name>.bundle.json \
     scripts/services/x.mjs scripts/tests/x.test.mjs scripts/config.json:create-only docs/note.md
   ```

   Run it from the folder that mirrors the repo root (in the sandbox, `/mnt/user-data/outputs`). Paths are repo-relative. Add `:create-only` to a config or data file Tom may have edited (for example `scripts/category-rules.json` after its first delivery) so a newer default never overwrites his edits.
3. Name it `<what>-<version>.bundle.json` (example: `jerome-v0.8.bundle.json`). The name must end in `.bundle.json`.
4. Present the bundle with the file tool. In the reply, **list every file inside it**, say which are new, replaced or create-only, and say what Tom needs to do: **download it, upload it to the top folder of the repo (or `inbox/`) with Add file, Upload files.** Nothing else.
5. After Tom uploads, he can check the run in GitHub: Actions, "Place files". Green = committed. Red = refused; the run summary says why. If he pastes the reason, fix and send a new bundle. A failed bundle stays in the repo: tell him to delete it before uploading the fixed one.

## Changing a small part of a big file: patch mode

For a few lines in a large file Claude has not just read in this chat (for example adding a line to `scripts/orchestrator.mjs`), do NOT send the whole file: the repo copy may be newer than Claude's copy. Send a patch. Write the edits to a JSON file, then:

```
node scripts/services/place-files.mjs --make --message "..." --out <name>.bundle.json scripts/orchestrator.mjs:patch=edits.json
```

`edits.json` is a list of `{"find": "exact text", "replace": "new text"}`. Each `find` must occur exactly once in the file AS IT IS IN THE REPO. If the text is missing (the file changed) or ambiguous, the whole bundle is refused and nothing changes. Insert new lines BEFORE an anchor line instead of splitting a line that has a trailing comment. Patch mode needs place-files.mjs v0.2 or newer (check its header date).

## What a bundle may NOT contain (it will be refused)

`.github/` (workflows), `.git/`, `node_modules/`, `inbox/`, `ledger/`, `sources/`, `data.json`, `workLog.json`, `index.html`, `package.json`, `scripts/ledger-allowlist.json` (the source registry; Tom edits it), `scripts/place-rules.json`, `scripts/services/place-files.mjs`. Allowed places: `scripts/`, `docs/`, and top-level `.md` files. The authoritative list is `scripts/place-rules.json`; if it disagrees with this file, the rules file wins.

**Things that must go in by hand, and Claude must say so plainly:**
- Any workflow file (`.github/workflows/*.yml`). GitHub's automatic token cannot change workflows, and a workflow is code with write access.
- Changes to the placing service or its rules (the gatekeeper protects itself).
- Changes to `index.html`, `data.json`, the registry. Give these as separate files with the exact path, or as a patch, per the project's patch conventions.

If a change needs both, send the bundle for what can be bundled and list the by-hand files separately, with exact paths. Say which to do first.

## Before sending (every time)

- Run the relevant tests in the sandbox. A bundle with failing tests is refused by the gate anyway; do not send one hoping it will pass. Include the test file for any code you change. The gate only runs test files that are in the bundle.
- Run `node --check` on every `.mjs`. The service does this too; do it first so the problem is found here and not on Tom's phone.
- Put a **dated header** in every code file and every HTML file Claude produces, as the first lines: the module date (with weekday) and the version, e.g. `// MODULE DATE: 2026-10-08 (Thursday) · v0.7 — what this is`. Tom asked for this. For HTML, a comment line with date/time and version.
- Bump the version when behavior changes. Keep the previous version's name in the message so history is readable.
- Do not claim a feature works live unless it has been run live. The sandbox has no network: say "tested with mocked pages" when that is the truth.
- Check that every file the change touches is in the bundle. List them in the reply, so Tom (and the next chat) can see what is inside.
- No secrets, keys or tokens in any file, ever.

## Bootstrapping (first time only)

The placing service cannot install itself. The first time, Tom uploads these four by hand, in these paths:

- `scripts/services/place-files.mjs` (v0.2 or newer)
- `scripts/place-rules.json`
- `scripts/tests/place-files.test.mjs`
- `.github/workflows/place-files.yml`

After that, everything else goes by bundle.

## The article log (v2)

Each article job is recorded in `article-log.json` (repo root): numbered steps with who did it, what happened, minutes, and raw usage (model, tokens, web searches). Code writes the steps from real numbers; never write them by hand or with an AI. A service adds its steps with `addStep` from `scripts/services/article-log.mjs`, using the SAME `jobId` for every service on one article (the task's `payload.jobId`, default the task id), and returns `filesToCommit: ['article-log.json']`. Dollars are not stored; they are computed from `scripts/pricing.json` when the log is shown. A service that charges by something other than tokens (audio, images) reports its own dollars as `usage.otherUsd`. Jerome (task type `source-find`) already logs. The website Log view and the Add Task option for `source-find` need `index.html`, which Claude has not seen.

## Other workflows Tom has

- **Test source-finder** (`.github/workflows/test-source-finder.yml`): runs the Jerome tests. Starts by itself when anything under `scripts/` changes, or by hand in Actions. Green means all tests pass.
- **Jerome pilot** (`.github/workflows/jerome-pilot.yml`, v2): a LIVE run of Jerome (real web search, real fetches, uses the `ANTHROPIC_API_KEY` secret). By hand only, with fields for an existing entry id or a new subject. The summary line and the numbered article log show at the top of the run; the run also commits `article-log.json`. It shares the `orchestrator` concurrency group so it never overlaps an orchestrator run.
- **Orchestrator** (`orchestrator.yml`): the existing Task Automation runner. Handlers return `filesToCommit`; it commits them itself. Do not replace it with the placing service.

## If something fails

- **Refused with a checksum error:** the bundle was edited or damaged on the way. Rebuild it with `--make` and resend; do not hand-edit bundle files.
- **Tests failed:** the run summary has the tail of the test output. Fix and resend. Nothing was changed in the repo.
- **"Protected" or "outside the allowed locations":** the file does not belong in a bundle. Deliver it by hand (see above).
- **Same bundle uploaded twice:** it is skipped and removed. To re-send a changed bundle, rebuild it; changed content means a new checksum.

## Tone for Tom

Tom prefers direct, honest answers, no flattery, and short replies on his phone. Lead with what he has to do. Say plainly what is untested and what he must do by hand.
