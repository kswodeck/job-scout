# Job Scout

Nightly broad-discovery job agent. Sweeps public job feeds, filters and scores every new posting against my rubric (the same one my Chrome extension uses), and opens a GitHub Issue digest each morning with only the jobs worth my time. GitHub emails the issue to me automatically — no SMTP setup needed.

**Pipeline:** fetch (free feeds) → local keyword prefilter (free) → Haiku screen → Sonnet full-rubric scorecard → digest issue + running match log. Screening and scoring are batched (many jobs per prompt).

**Two ways to pay for the LLM calls** (`llm.transport` in `data/config.json`):

- **`"claude-cli"` (default — $0):** runs prompts through the Claude Code CLI authenticated with your existing Claude Pro/Max subscription. Generate a long-lived token once with `claude setup-token` (official, made for CI) and add it as the `CLAUDE_CODE_OAUTH_TOKEN` repo secret. Usage draws from your subscription's rolling limits instead of billing dollars — batching keeps a typical night to roughly 6–15 prompts, and the run fires at ~6:30am when you're not using the quota. GitHub Actions itself is free at this scale (private repos get 2,000 free minutes/month; this uses ~5/night).
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

**Not covered (all re-verified live 2026-07-10):** LinkedIn, Indeed, Wellfound, Built In, Welcome to the Jungle, and Getro-hosted boards (e.g. jobs.highfivepartners.com) all prohibit automated access in their ToS and/or block bots — Built In even has a technically perfect public JSON API, but its terms forbid using it. They are deliberately excluded. The compliant play: set email job alerts there, then periodically ask Claude (with Gmail connected) to pull the alert emails, dedupe against your tracker, and score them against this same rubric.

## Setup (~10 minutes)

1. Create a **private** GitHub repo and push this folder to it (workflow expects the default branch, unprotected).
2. On your own machine (where Claude Code is logged in), run `claude setup-token` and copy the token it prints (starts `sk-ant-oat01-`, shown once).
3. Repo → Settings → Secrets and variables → Actions → New repository secret: `CLAUDE_CODE_OAUTH_TOKEN` with that value. *(API mode instead: secret `ANTHROPIC_API_KEY` and set `llm.transport` to `"api"`.)*
4. Actions tab → enable workflows if prompted.
5. First run: Actions → Job Scout → **Run workflow** (optionally set lookback, e.g. `14`). Watch the log.
6. Done. It runs nightly at ~6:30am Central and opens an issue only on days with matches. Star-⭐ flags mark Vue/Nuxt/EdTech/faith-keyword hits.

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

- `src/scout.js` — orchestrator. `sources.js` — fetchers (endpoints live-verified 2026-07-08; EdTech.com + Christian Tech Jobs 2026-07-10). `prefilter.js` — free keyword/location/salary gate. `rubric.js` — the scoring prompts (**keep in sync with the Chrome extension rubric if it evolves**). `llm.js` — API client. `digest.js`, `state.js`.
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
