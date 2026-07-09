#!/usr/bin/env node
// Job Scout orchestrator.
//   node src/scout.js                 normal run (needs ANTHROPIC_API_KEY)
//   node src/scout.js --no-llm        free preview: fetch + prefilter only, no state writes
//   node src/scout.js --lookback 7    override lookback window (also env LOOKBACK_DAYS)
//   node src/scout.js --digest-always write digest.md even with zero matches
const { fetchRemotive, fetchRemoteOK, fetchWWR, fetchHN, fetchATSBoards, scanForATSTokens } = require("./sources");
const { passes, isStarred } = require("./prefilter");
const { screenBatch, scoreBatch, chunk, costSummary } = require("./llm");
const { buildDigest, writeDigest, writeMatchesMd } = require("./digest");
const state = require("./state");
const { todayISO, normFamily } = require("./util");
const { loadAppliedSet, isAlreadyApplied } = require("./applied");

const args = process.argv.slice(2);
const flag = f => args.includes(f);
const argVal = f => { const i = args.indexOf(f); return i > -1 ? args[i + 1] : undefined; };

(async () => {
  const st = state.load();
  const cfg = st.config;
  if (!cfg) { console.error("data/config.json missing or invalid"); process.exit(1); }

  const noLLM = flag("--no-llm");
  if (!noLLM) {
    if (cfg.llm.transport === "api" && !process.env.ANTHROPIC_API_KEY) {
      console.error("llm.transport is 'api' but ANTHROPIC_API_KEY is not set. Set the secret, switch transport to 'claude-cli', or use --no-llm.");
      process.exit(1);
    }
    if (cfg.llm.transport === "claude-cli" && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      console.log("Note: CLAUDE_CODE_OAUTH_TOKEN not set — relying on a local `claude` login (fine on your own machine; required as a secret in CI).");
    }
  }

  const firstRun = Object.keys(st.seen).length === 0;
  const lookbackDays = Number(argVal("--lookback") || process.env.LOOKBACK_DAYS || (firstRun ? cfg.first_run_lookback_days : cfg.lookback_days));
  const sinceMs = Date.now() - lookbackDays * 86400000;
  console.log(`Job Scout ${todayISO()} \u2014 lookback ${lookbackDays}d${firstRun ? " (first run)" : ""}${noLLM ? " [PREVIEW: no LLM, no state writes]" : ""}`);

  // ---- 1. Fetch all enabled sources (a dead source never kills the run) ----
  const tasks = [];
  const src = cfg.sources || {};
  if (src.remotive) tasks.push(["remotive", fetchRemotive(cfg, sinceMs)]);
  if (src.remoteok) tasks.push(["remoteok", fetchRemoteOK(sinceMs)]);
  if (src.wwr) tasks.push(["wwr", fetchWWR(cfg, sinceMs)]);
  if (src.hn) tasks.push(["hn", fetchHN(cfg, st.misc.hn || {})]);
  if (src.ats_watchlist && st.companies.length) tasks.push(["ats", fetchATSBoards(st.companies, st.seen)]);

  let jobs = [];
  let hnResult = null;
  const results = await Promise.allSettled(tasks.map(t => t[1]));
  results.forEach((r, i) => {
    const name = tasks[i][0];
    if (r.status === "rejected") { console.log(`  source ${name} FAILED: ${r.reason?.message || r.reason}`); return; }
    const list = name === "hn" ? (hnResult = r.value).jobs : r.value;
    console.log(`  ${name}: ${list.length} postings`);
    jobs.push(...list);
  });
  const fetched = jobs.length;

  // ---- 2. Drop already-seen ----
  jobs = jobs.filter(j => !st.seen[j.id]);
  const fresh = jobs.length;

  // ---- 3. Local prefilter (free) ----
  const candidates = [];
  const dropReasons = {};
  for (const j of jobs) {
    const r = passes(j, cfg);
    if (r.pass) candidates.push(j);
    else dropReasons[r.reason.split(":")[0]] = (dropReasons[r.reason.split(":")[0]] || 0) + 1;
  }
  console.log(`Prefilter: ${candidates.length}/${fresh} passed. Drops: ${JSON.stringify(dropReasons)}`);

  // ---- 4. Duplicate suppression ----
  //   (a) already-applied: same company + same CORE role as a tracker row
  //       (data/applied.json). No time window — a role stays blocked while it's
  //       in the tracker. See src/applied.js.
  //   (b) recent scout matches: same company + de-seniorized title family, 30 days.
  const appliedSet = loadAppliedSet();
  const recentFamilies = new Set(
    st.matches.filter(m => Date.now() - Date.parse(m.scoutedAt) < 30 * 86400000).map(m => m.family)
  );
  const thisRun = new Set();
  const deduped = [];
  let appliedSuppressed = 0;
  for (const j of candidates) {
    j.family = normFamily(j.company, j.title);
    if (isAlreadyApplied(j, appliedSet)) { appliedSuppressed++; continue; }
    if (recentFamilies.has(j.family) || thisRun.has(j.family)) continue;
    thisRun.add(j.family);
    deduped.push(j);
  }
  if (appliedSuppressed) console.log(`Already-applied suppressed: ${appliedSuppressed} (tracker has ${appliedSet ? appliedSet.size : 0} roles)`);
  const dupSuppressed = candidates.length - appliedSuppressed - deduped.length;
  if (dupSuppressed > 0) console.log(`Duplicates suppressed: ${dupSuppressed}`);

  // ---- 5. Grow the ATS watchlist from ALL fresh postings' text/urls ----
  const newCompanies = state.addCompanies(st.companies, scanForATSTokens(jobs), "auto-discovered", cfg.max_watchlist);
  if (newCompanies) console.log(`Watchlist: +${newCompanies} companies (now ${st.companies.length})`);

  // ---- 6. LLM stages ----
  const stats = { fetched, fresh, prefiltered: candidates.length, appliedSuppressed, screened: 0, scored: 0, newCompanies };
  let matches = [], skippedScored = [];

  if (noLLM) {
    matches = deduped.map(j => ({ ...j, stars: isStarred(j, cfg) }));
    const digest = buildDigest({ date: todayISO(), matches, skippedScored: [], stats, cost: null, preview: true });
    writeDigest(digest);
    console.log(`\nPREVIEW: ${matches.length} candidates written to digest.md. State NOT saved.`);
    console.log(matches.map(m => `  - ${m.company} \u2014 ${m.title} [${m.via}]`).join("\n"));
    return;
  }

  const toScreen = deduped.slice(0, cfg.max_llm_screens_per_run);
  if (deduped.length > toScreen.length) console.log(`Screen cap: ${deduped.length - toScreen.length} deferred to future runs`);
  const screened = [];
  for (const batch of chunk(toScreen, cfg.llm.screen_batch)) {
    const passes = await screenBatch(batch, cfg);
    batch.forEach((j, k) => { if (passes[k]) screened.push(j); });
  }
  stats.screened = screened.length;
  console.log(`Screen: ${screened.length}/${toScreen.length} passed`);

  const toScore = screened.slice(0, cfg.max_scores_per_run);
  const deferredIds = new Set(screened.slice(cfg.max_scores_per_run).map(j => j.id));
  for (const batch of chunk(toScore, cfg.llm.score_batch)) {
    const cards = await scoreBatch(batch, cfg);
    batch.forEach((j, k) => {
      const s = cards[k];
      if (!s) { deferredIds.add(j.id); return; } // couldn't score -> retry next run
      stats.scored++;
      const rec = {
        ...s, salary_out: s.salary, location_out: s.location,
        id: j.id, company: j.company, title: j.title, url: j.url, via: j.via,
        family: j.family, stars: isStarred(j, cfg), scoutedAt: todayISO(),
      };
      delete rec.salary; delete rec.location;
      if (rec.score >= cfg.min_score) matches.push(rec);
      else skippedScored.push(rec);
    });
  }
  matches.sort((a, b) => b.score - a.score);
  skippedScored.sort((a, b) => b.score - a.score);

  // ---- 7. Persist: seen IDs (everything fetched this run), matches, HN cursor ----
  const day = todayISO();
  for (const j of jobs) st.seen[j.id] = day;
  // Anything deferred (screen cap, score cap, or a failed score call) stays
  // unseen so tomorrow's run picks it up.
  for (const j of deduped.slice(cfg.max_llm_screens_per_run)) delete st.seen[j.id];
  for (const id of deferredIds) delete st.seen[id];
  st.matches.push(...matches);
  if (hnResult?.threadId) st.misc.hn = { thread_id: hnResult.threadId, last_ts: hnResult.lastTs };
  state.save(st);
  writeMatchesMd(st.matches);

  // ---- 8. Digest ----
  const cost = costSummary(cfg);
  console.log(`\nScored ${stats.scored}: ${matches.length} matches, ${skippedScored.length} skips. ${cost.subscription ? cost.detail : "Est. cost ~$" + cost.total.toFixed(2)}`);
  for (const m of matches) console.log(`  ${m.score} \u2014 ${m.company} \u2014 ${m.title}${m.stars.length ? " \u2B50" : ""}`);
  if (matches.length || flag("--digest-always") || cfg.digest_when_empty) {
    writeDigest(buildDigest({ date: day, matches, skippedScored, stats, cost, preview: false }));
    console.log("digest.md written.");
  } else {
    console.log("No matches \u2014 no digest issue today (set digest_when_empty to change).");
  }
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
