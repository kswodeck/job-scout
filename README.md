# Job Scout

Every-other-day broad-discovery job agent. Sweeps public job feeds, filters and scores every new posting against my rubric (the same one my Chrome extension uses), and opens a GitHub Issue digest each morning with only the jobs worth my time. GitHub emails the issue to me automatically — no SMTP setup needed.

**Pipeline:** fetch (free feeds) → local keyword prefilter (free) → Haiku screen → Sonnet full-rubric scorecard → digest issue + running match log. Screening and scoring are batched (many jobs per prompt).

**Two ways to pay for the LLM calls** (`llm.transport` in `data/config.json`):

- **`"claude-cli"` (default — $0):** runs prompts through the Claude Code CLI authenticated with your existing Claude Pro/Max subscription. Generate a long-lived token once with `claude setup-token` (official, made for CI) and add it as the `CLAUDE_CODE_OAUTH_TOKEN` repo secret. Usage draws from your subscription's rolling limits instead of billing dollars — batching keeps a typical night to roughly 6–15 prompts, and the run fires at ~4am when you're not using the quota. GitHub Actions itself is free at this scale (private repos get 2,000 free minutes/month; this uses ~5/night).
- **`"api"`:** direct Anthropic API with an `ANTHROPIC_API_KEY` secret. Pay-as-you-go (~$0.10–0.50/night), fully independent of your subscription limits, no CLI dependency.

If a night's run hits your subscription limit or a call fails, unscored jobs are left unseen and automatically retried the next night.

## Sources

| Source | What | How |
|---|---|---|
| Remotive | Remote software-dev jobs | Public JSON API (`software-development` category) |
| RemoteOK | Remote jobs | Public JSON API (digest links back to their pages, which satisfies their attribution ask) |
| We Work Remotely | Front-end / full-stack / programming categories | Public RSS |
| EdTech.com | EdTech-niche board (strong domain fit) | Public RSS (`/feed`, whole active corpus; no per-item dates — newness = diff vs `seen.json`) |
| Christian Tech Jobs | Faith-based tech roles (starred keyword) | Public RSS (`/api/rss`, expressly allowed by their robots.txt; ~1 FE role/month) |
| HN "Who is hiring?" | Monthly thread, high-signal small companies | Algolia HN API, incremental (only new comments each run) |
| ATS watchlist | Direct Greenhouse / Lever / Ashby boards | Public board APIs; **self-growing** — see below |

**Self-growing watchlist:** whenever a candidate posting's text or URL contains a `boards.greenhouse.io/x`, `jobs.lever.co/x`, or `jobs.ashbyhq.com/x` link (HN comments contain these constantly), that company's board is added to `data/companies-discovered.json` and polled directly every night from then on. It starts seeded with GitLab (the flagship Vue/Nuxt shop, remote-first) and Linear; add or delete entries freely — format: `{"ats": "greenhouse|lever|ashby", "token": "board-slug"}`.

**Not covered (all re-verified live 2026-07-10; Handshake added 2026-07-15):** LinkedIn, Indeed, Wellfound, Built In, Welcome to the Jungle, ZipRecruiter, Handshake, and Getro-hosted boards (e.g. jobs.highfivepartners.com) all prohibit automated access in their ToS and/or block bots — Built In even has a technically perfect public JSON API, but its terms forbid using it, and ZipRecruiter's robots.txt blanket-disallows everything while its job-search API is an approved-publishers-only partner program. **Handshake** (`app.joinhandshake.com/job-search`, checked 2026-07-15): the search page is login-gated and `app.joinhandshake.com/robots.txt` is `Disallow: /`; the only API access is the partner-only EDU API (Career Services / institution-scoped, beta). A public jobs sitemap does exist (`joinhandshake.com/api/handshake-public-jobs.xml` → `/public/jobs/{id}` pages, robots-allowed for indexing), but the ToS (`joinhandshake.com/legal/tos/`) expressly bans it: *"does not permit third parties to bulk collect … job descriptions, or other marketplace information … through the use of automated scripts ('scraping'), similar or other technologies."* So a sitemap-driven crawler would still violate the terms — same verdict as Built In. **UnlistedJobs** (`unlistedjobs.com/jobs`, checked 2026-07-17): a signup/paid aggregator whose whole product is jobs it scrapes from company career pages; its origin answers 403 to any non-browser client (confirmed live on `robots.txt` and `/rss`), and no public feed or API exists. Its ToS could not be read (same bot-block), but a paid data product behind a bot wall is the Wellfound situation → excluded; note its inventory *is* company ATS pages, which the scout's self-growing watchlist already polls directly and legitimately. **Jobs24x** (`jobs24x.com`, checked 2026-07-17): **unverified, not condemned** — the check ran from a sandboxed environment whose network policy blocked the domain outright, so robots.txt, ToS, and feed existence were all unreachable; web search shows a young aggregator of ~1,200 company career pages with no advertised feed/API and only a middling third-party trust score. Do not add until someone confirms a public feed + permissive ToS from a normal connection (overlap with the ATS watchlist would be substantial anyway). All deliberately excluded. The compliant play: set email job alerts there, then periodically ask Claude (with Gmail connected) to pull the alert emails, dedupe against your tracker, and score them against this same rubric.

## Setup (~10 minutes)

1. Create a **private** GitHub repo and push this folder to it (workflow expects the default branch, unprotected).
2. On your own machine (where Claude Code is logged in), run `claude setup-token` and copy the token it prints (starts `sk-ant-oat01-`, shown once).
3. Repo → Settings → Secrets and variables → Actions → New repository secret: `CLAUDE_CODE_OAUTH_TOKEN` with that value. *(API mode instead: secret `ANTHROPIC_API_KEY` and set `llm.transport` to `"api"`.)*
4. Actions tab → enable workflows if prompted.
5. First run: Actions → Job Scout → **Run workflow** (optionally set lookback, e.g. `14`). Watch the log.
6. Done. It runs every other day (odd days of the month) at 4:00am Central (3:00am in winter; GitHub cron often adds 1–2h of lag) and opens a digest issue each run morning. Star-⭐ flags mark Vue/Nuxt/EdTech/faith-keyword hits.

## Google integration (tracker rows + tailored materials) — one-time setup

Two optional nightly stages use one Google service account: **tracker append** (every 60+ match becomes a `Radar` row in the Job Application Tracker sheet) and **materials** (a DRAFT tailored resume + cover letter DOCX per 60+ match, uploaded to the "Tailored Resumes and Cover Letters" Drive folder for review). Both are enabled in config but self-skip with a log line until this setup exists. GitHub Actions has no Google login, so a service account is the bridge:

1. **Create the service account:** [console.cloud.google.com](https://console.cloud.google.com) → create (or pick) a project → *APIs & Services → Library* → enable **Google Drive API** and **Google Sheets API** → *IAM & Admin → Service Accounts → Create* (no roles needed) → open it → *Keys → Add key → Create new key → JSON* (downloads a `.json` file).
2. **Set the secret:** `gh secret set GOOGLE_SERVICE_ACCOUNT_JSON < ~/Downloads/<key>.json` (or GitHub UI → Settings → Secrets and variables → Actions → paste the file's contents). Treat the key file like a password; delete the local copy after.
3. **Convert the tracker to a native Google Sheet** — required: the tracker is currently an `.xlsx` and the Sheets API cannot write to xlsx. Open it in Google Sheets → *File → Save as Google Sheets*. This creates a NEW spreadsheet (new ID); use it as the live tracker from now on and archive the xlsx (a stale copy invites split-brain edits). Copy the new ID from its URL (`/spreadsheets/d/<ID>/`) and set it as the **`TRACKER_SPREADSHEET_ID`** repo secret (`gh secret set TRACKER_SPREADSHEET_ID`) — **not** in `data/config.json`. This repo is public, and a Google resource ID is effectively a capability for anything shared "anyone with the link". The config key still works as a fallback for private forks, but leave it blank here.
4. **Share both with the service account:** the folder `Tailored Resumes and Cover Letters` and the new tracker Sheet → Share → the SA's `client_email` (`...@...iam.gserviceaccount.com`) as **Editor**. Set the folder's ID (from its URL, `/folders/<ID>`) as the **`MATERIALS_DRIVE_FOLDER_ID`** secret, same reasoning as step 3.
5. **Fix link sharing — do this first, it is the one that bites:** both the tracker and the folder were last seen set to **"anyone with the link can edit"**. Set both to **Restricted**; the explicit SA share from step 4 is what the automation actually uses. Link-open + a published ID means any reader can open and edit the sheet, so this must be true before the repo is public *or* the IDs go anywhere.
6. **Resume contact details:** set the **`RESUME_PHONE`** and **`RESUME_EMAIL`** secrets. `materials/master.js` deliberately does not carry them (a committed phone number in a public repo gets scraped); without the secrets the generated DOCX simply omits that line.
7. **Verify:** Actions → Job Scout → Run workflow. The log should show `Tracker: appended N row(s)…` and `Materials: N/M drafts uploaded…` on a night with 60+ matches. New tracker rows arrive as Status `Radar`, Priority High (70+) / Medium, score in Notes + Rank — same shape as manual entries.

`data/applied.json` (the already-applied dedup snapshot) is still refreshed manually from a tracker CSV via `scripts/build-applied.js` — refresh it occasionally, or ask a Drive-connected Claude session to. Auto-refreshing it nightly from the live Sheet is a natural follow-up once the SA works.

### Local testing

```bash
node src/scout.js --no-llm --lookback 3   # free preview: fetch + prefilter only, no state writes
ANTHROPIC_API_KEY=sk-... node src/scout.js --lookback 3   # full scored run
```

## Costs (estimates)

Typical night: ~300–800 fetched → ~20–60 past prefilter → a few batched Haiku screen prompts → ~2–6 batched Sonnet scoring prompts. (The first night after adding a source with no per-item dates — EdTech.com — spikes to ~2,000 fetched, but the title prefilter absorbs almost all of it.)

- **Subscription mode (default):** $0 cash; roughly 6–15 prompts/night against your Pro/Max rolling limits (more on a first run with the full 14-day lookback). On Max this is negligible; on Pro it's a modest early-morning slice — if a run ever exhausts the window, unscored jobs simply retry the next night.
- **API mode:** ~$0.10–$0.50/night; the digest shows actual token usage. Pricing constants live in `src/llm.js`.

Hard caps in config (`max_llm_screens_per_run`, `max_scores_per_run`) bound the worst case; anything deferred by a cap or a failed call is left unseen and picked up the next night.

## Files

- `src/scout.js` — orchestrator. `sources.js` — fetchers (endpoints live-verified 2026-07-08; EdTech.com + Christian Tech Jobs 2026-07-10). `prefilter.js` — free keyword/location/salary gate. `tracker.js` — 60+ matches → tracker Sheet rows. `materials.js` + `drive.js` + `materials/` — tailored DOCX drafts → Drive. `applied.js` — already-applied dedup. `rubric.js` — the scoring prompts (**keep in sync with the Chrome extension rubric if it evolves**). `llm.js` — API client. `digest.js`, `state.js`.
- `data/config.json` — thresholds, sources on/off, models, star keywords.
- `data/seen.json` — processed IDs (pruned after 120 days; delete it to force a full rescan, e.g. after loosening the prefilter).
- `data/matches.json` + `data/matches.md` — the running "good fits" log, every match ever surfaced.
- `data/companies-discovered.json` — the growing ATS watchlist.

## Honest limitations

- **Remote-heavy by construction.** These feeds are remote-first, so **DFW-local hybrid roles are under-covered**. LinkedIn/Indeed email alerts remain the best channel for those.
- Vue/Nuxt-specific boards (vuejobs.com) have no public feed I verified, so they're not automated here — keep those as a manual weekly check. (christiantechjobs.io IS now automated: its `/api/rss` feed was verified 2026-07-10.) Star keywords flag Vue/Nuxt/faith hits from all covered sources.
- EdTech.com's feed has **no per-item posting dates**, so its jobs bypass the lookback window: each night only never-seen-before listings are processed. Its content license is personal-use — keep this repo private (it already must be for the tracker data anyway). Same personal-use note for christiantechjobs.io.
- HN comment parsing is best-effort (freeform text); company/title fields on those can be rough. The link always goes to the actual comment.
- Scores are the rubric run headless — **spot-check against your own judgment for the first couple of weeks** and tune `min_score`, the prefilter regexes, or the rubric text accordingly. The scorer only sees the posting text a feed provides; a few feeds truncate descriptions.
- Duplicate suppression is company + de-seniorized title with a 30-day window; distinct teams at one company can occasionally collapse into one entry.
- Subscription-token auth in CI is officially supported (`claude setup-token` is documented for exactly this), but community reports show occasional token/auth flakiness in Actions. The scout degrades gracefully (failed batches defer to the next night); if it becomes chronic, regenerate the token or flip `llm.transport` to `"api"`.

## Tuning

- Too much noise → raise `min_score` to 60–65, or tighten `TITLE_POS` in `prefilter.js`.
- Missing things you'd want → check the nightly Actions log's drop-reason tally, loosen the relevant rule, delete `seen.json`, re-run with a bigger lookback.
- Want AI-adjacent frontend roles → add `"artificial-intelligence"` to `remotive_categories` (prefilter kills the ML-research noise).
- A daily issue even on zero-match days → `"digest_when_empty": true`.
