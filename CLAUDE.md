# Job Scout — project context for Claude Code

## What this is

Nightly autonomous job-discovery agent for Kris Swodeck's job search (front-end/JS engineer, 7+ yrs, DFW, remote-US or DFW-hybrid, $80k floor). It sweeps public job feeds, prefilters locally for free, screens and scores survivors with LLM calls against Kris's own triage rubric, and opens a GitHub Issue digest each morning with only jobs worth his time (GitHub emails him the issue automatically). It runs on GitHub Actions nightly cron at $0 cash by routing LLM calls through the Claude Code CLI on his Claude subscription.

## Current status (built 2026-07-08 in a Claude.ai session)

- **Deployed and running nightly** — the workflow has committed `data/` state since 2026-07-09 (the "NOT yet deployed" status this section originally carried is obsolete; the runbook below is kept for reference/re-deployment).
- All feed endpoints and field names were **live-verified 2026-07-08** (details in `src/sources.js` comments). Notable: Remotive's correct category slug is `software-development` (not `software-dev`), and their public API currently serves only ~28 recent listings — a legitimately low-volume contributor.
- **2026-07-10 expansion:** lookback widened to 14 days (both knobs), and two sources added after live feed + ToS verification: **EdTech.com** (`/feed` RSS — no per-item dates, so newness is purely the `seen.json` set-diff; IDs are hashes of link+company+title because bare applyLinks collide) and **Christian Tech Jobs** (`/api/rss`, expressly allowed by their robots.txt; company parsed from URL slug). LinkedIn, Indeed, Wellfound, Built In, Welcome to the Jungle, and Getro boards (jobs.highfivepartners.com) were checked the same day: all prohibit automated access in ToS and/or hard-block bots → stay manual via email alerts.
- The full pipeline (fetch → prefilter → batched screen/score → dedupe → caps/deferral → state writes → digest) was tested end-to-end against live feeds using a **shimmed `claude` CLI returning canned JSON**. Real LLM calls have **never** run with real auth — the first real scoring happens at deployment. Treat early scores as unvalidated; spot-check.
- Lever boards: endpoint shape verified live (a valid empty array); the field mapping (`text`, `hostedUrl`, `categories.location`, `createdAt`, `descriptionPlain`) comes from Lever's docs, not live observation. The first Lever board the watchlist discovers will confirm it — check that night's log.

## Kris's working rules (honor these)

- **Vanilla JavaScript, CommonJS, zero npm dependencies.** Node 20+ built-ins only (`fetch`, `child_process`, `fs`). Do not add packages.
- **Flag, don't silently fix.** Surface judgment calls and behavior changes with reasoning before making them; Kris decides. Never silently alter scoring behavior, filters, or state semantics.
- **Blunt honesty over reassurance.** Report failures, uncertainty, and limitations plainly. Inflated results waste his time.
- The scoring prompt in `src/rubric.js` is adapted from his Chrome-extension rubric (`chrome-job-scoring-prompt.md`, lives in his Claude.ai project). **If either rubric is edited, keep the two in sync** — ask him for the other file if you don't have it. Do not weaken the integrity rules baked into it (genuine-gaps list, React/Angular neutrality, salary floor, hard caps, "never invent experience").
- Kris often reads on his phone: lead with the answer, keep reports tight, details in files.

## Architecture

| File | Role |
|---|---|
| `src/scout.js` | Orchestrator + CLI flags (`--no-llm`, `--lookback N`, `--digest-always`; env `LOOKBACK_DAYS`) |
| `src/sources.js` | Fetchers: Remotive, RemoteOK, WWR RSS, EdTech.com RSS, ChristianTechJobs RSS, HN Who's Hiring (Algolia, incremental cursor), ATS boards (Greenhouse/Lever/Ashby), + `scanForATSTokens` regex discovery |
| `src/prefilter.js` | Free local gate: `TITLE_POS`/`TITLE_NEG`/`NON_IC`/`SENIORITY_EXCL` regexes, strict location gate (remote-US or ~45 mi of Arlington TX; hybrid counts as in-office), structured-salary floor, HN full-text + apply-link mode |
| `src/rubric.js` | Batch prompts: screen gate (pass/fail per posting) + full scorecard (Kris's rubric, strict JSON array out) |
| `src/llm.js` | Dual transport (`claude-cli` spawn / direct `api` fetch), batching, retries, fail-open screen / fail-closed score, prompt+token accounting |
| `src/state.js` | `data/*.json` persistence, 120-day seen pruning, watchlist growth |
| `src/digest.js` | `digest.md` + `digest_title.txt` (workflow posts as issue) + cumulative `data/matches.md` |
| `src/util.js` | fetch helpers, HTML→text (entity-decode FIRST — Greenhouse ships entity-encoded HTML), title-family normalizer |
| `src/tracker.js` | Appends 60+ matches as `Radar` rows to the Job Application Tracker Google Sheet (Sheets API `values.append`, service-account auth from `drive.js`) |
| `src/materials.js` + `src/drive.js` + `materials/` | Tailored DRAFT resume + cover letter DOCX per 60+ match → Drive review folder (layered anti-fabrication; `materials/` is the one sanctioned npm island) |
| `src/applied.js` | Already-applied dedup against `data/applied.json` (snapshot of the tracker; rebuild via `scripts/build-applied.js`) |
| `.github/workflows/scout.yml` | Nightly cron `30 11 * * *` (~6:30am CDT), installs Claude Code CLI, runs scout, commits `data/`, opens issue |

## Data & state semantics

- `data/config.json` — every knob: `llm` (transport, models per tier, batch sizes), caps (`max_llm_screens_per_run` 150 / `max_scores_per_run` 40 / `max_watchlist` 150), `min_score` 55, source toggles, `star_keywords`, lookbacks.
- `data/seen.json` — `id → date`. Everything fetched gets marked seen **except** jobs deferred by the screen cap, score cap, or a failed score call — those are un-seen so the next night retries them. Delete the file to force a full rescan (e.g. after loosening the prefilter).
- `data/matches.json` — permanent log of every surfaced match; `data/matches.md` is regenerated from it.
- `data/companies-discovered.json` — self-growing ATS watchlist: Greenhouse/Lever/Ashby board tokens regex-harvested from **all** fresh postings' text/URLs (HN comments are the main source), then polled directly every night. Seeds: `gitlab` (Greenhouse, verified, Vue shop), `linear` (Ashby, verified). Delete junk entries freely.
- First-run detection: empty `seen.json` → uses `first_run_lookback_days` (14) instead of `lookback_days` (also 14 since 2026-07-10; they can diverge again if the nightly window is ever narrowed).
- Duplicate suppression: company + de-seniorized title family, 30-day window against `matches.json`.
- `--no-llm` = preview: fetch + prefilter only, writes a preview digest, **no state writes**.
- **Google integration (tracker append + materials), 2026-07-10:** both stages are `enabled` in config but self-skip with a log line until (a) the `GOOGLE_SERVICE_ACCOUNT_JSON` secret exists and (b) for the tracker, `tracker.spreadsheet_id` is set. Kris's tracker was verified to be an **`.xlsx`** (Sheets API can't write those) shared **anyone-with-link=writer** (flagged; should be Restricted) — he must convert it to a native Sheet, share it + the Drive folder with the SA's `client_email` as Editor, and put the new sheet ID in config (full runbook in README "Google integration"). **Never ask Kris to paste the SA key JSON into a conversation** — same rule as the OAuth token: he sets the secret directly. Tracker rows mirror his manual format: Status `Radar`, Priority High (70+)/Medium, `NN/100 <verdict>` in Notes, score in Rank; tab name `Applications`.

## LLM transports

- **`claude-cli` (default, $0 cash):** spawns `claude -p <prompt> --model haiku|sonnet --output-format text` with stdin closed. Auth: `CLAUDE_CODE_OAUTH_TOKEN` env (from `claude setup-token`; officially documented for CI) or a local `claude` login. Draws from Kris's subscription rolling limits. Measured in testing: ~14 prompts for a 40-score night; expect ~6–15 typical, ~20–25 on the first 7-day run.
- **`api`:** direct `api.anthropic.com` with `ANTHROPIC_API_KEY`. ~$0.10–0.50/night, independent of subscription limits.
- Failure semantics: a failed **screen** batch fails OPEN (all its jobs pass to the scorer); a twice-failed **score** batch fails CLOSED with deferral (jobs retried next night). A run that dies mid-way loses nothing permanently.

## Deployment runbook (first session)

1. **Preview test locally** (no auth needed): `node src/scout.js --no-llm --lookback 3`. Expect a few hundred fetched, ~50–100 prefilter survivors, a preview `digest.md`, no state saved. Show Kris the numbers and the drop-reason tally.
2. **Create a PRIVATE repo and push** (default branch, unprotected): `gh repo create job-scout --private --source . --push` (or walk Kris through the UI if `gh` is missing/unauthenticated). Delete any leftover `digest.md`/`digest_title.txt` before the initial commit.
3. **Token (Kris does this interactively, not you):** he runs `claude setup-token` in his own terminal, copies the printed token (`sk-ant-oat01-…`, shown once). **Security: never ask him to paste the token into the conversation.** Have him set it directly: `gh secret set CLAUDE_CODE_OAUTH_TOKEN` (paste at the hidden prompt) or GitHub UI → Settings → Secrets and variables → Actions.
4. **Repo settings:** Actions enabled; Settings → Actions → Workflow permissions → "Read and write permissions" (the workflow commits state and opens issues).
5. **First real run:** Actions → Job Scout → Run workflow with `lookback_days` = 7. Watch the log with him. Prefer the first real run in Actions (exercises the whole issue flow); a local real run is acceptable but consumes his subscription prompts and its `data/` changes must be committed.
6. **Verify:** digest issue opened; `data/` committed back by the bot; then **spot-check 3–5 scorecards** against the rubric and flag anything that looks miscalibrated. Recommend he sanity-checks scores for the first week or two before trusting the digest blindly.

## Troubleshooting

- **Auth failure in Actions** (`Not logged in`, credential errors): regenerate via `claude setup-token` and update the secret. There are community reports of intermittent OAuth-token flakiness in CI; the scout degrades gracefully (failed batches defer to next night). Chronic → flip `llm.transport` to `"api"` + `ANTHROPIC_API_KEY` secret.
- **Subscription limit hit mid-run:** partial night; deferred jobs retry automatically. If it recurs, lower `max_scores_per_run` or move the cron earlier.
- **Too noisy:** raise `min_score` to 60–65, tighten `TITLE_POS`, or prune junk watchlist entries.
- **Missing expected jobs:** read the drop-reason tally in the Actions log, loosen the relevant prefilter rule, delete `data/seen.json`, re-run with a bigger lookback.
- **A discovered ATS board 404s nightly:** remove its entry from `companies-discovered.json`.
- **Issue creation fails:** check workflow permissions (step 4 above) and that `digest_title.txt` exists alongside `digest.md`.

## Known limitations (be upfront with Kris)

- Feeds are remote-heavy, so **DFW-local hybrid roles are under-covered**. LinkedIn/Indeed prohibit scraping — they stay manual via email alerts (optionally triaged in a Gmail-connected Claude.ai session). Same verdict, re-verified live 2026-07-10, for Wellfound (DataDome-blocked, ToS ban), Built In (public JSON API exists and works, but ToS prohibits automated use), Welcome to the Jungle (job data credential-gated; ToS ban), and Getro-hosted boards like jobs.highfivepartners.com (Getro ToS bans crawling any of its boards; 403s non-browser UAs; that board is mostly non-dev ed-sector roles anyway).
- vuejobs.com has no verified public feed. If asked to add it (or any new board), **verify a feed/API exists and check ToS first** — do not scrape blindly. (christiantechjobs.io was re-checked 2026-07-10 and now IS covered via its robots.txt-allowed `/api/rss`.)
- EdTech.com's feed carries no posting dates: its listings ignore the lookback window (pure `seen.json` set-diff), and `publishedAt` is empty on its jobs. Both EdTech.com and christiantechjobs.io license content for personal use — keep the repo/digests private and don't republish posting text.
- HN parsing is best-effort: company/title fields on HN entries can be rough; the link always goes to the real comment.
- Scores are the rubric run headless and are unvalidated until real runs accumulate.

## Roadmap candidates (only when Kris asks)

Tuning pass after week 1 (min_score / prefilter / rubric wording) · `digest_when_empty` or cron changes · add `"artificial-intelligence"` to `remotive_categories` · SMTP email delivery instead of issues · periodic watchlist prune · surface DFW-hybrid ideas.
