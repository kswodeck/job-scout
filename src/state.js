// State lives as JSON in data/ and is committed back by the workflow, so the
// repo itself is the database: seen IDs, the running match log, the growing
// company watchlist, and the HN thread cursor.
const fs = require("fs");
const path = require("path");
const { todayISO } = require("./util");

const DATA = path.join(__dirname, "..", "data");
const P = {
  config: path.join(DATA, "config.json"),
  seen: path.join(DATA, "seen.json"),
  matches: path.join(DATA, "matches.json"),
  companies: path.join(DATA, "companies-discovered.json"),
  misc: path.join(DATA, "misc-state.json"),
};

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function load() {
  return {
    config: readJson(P.config, null),
    seen: readJson(P.seen, {}),           // { jobId: "YYYY-MM-DD" }
    matches: readJson(P.matches, []),     // running log of every surfaced match
    companies: readJson(P.companies, []), // [{ats, token, via, first_seen}]
    misc: readJson(P.misc, {}),           // { hn: {thread_id, last_ts} }
  };
}

function pruneSeen(seen, days = 120) {
  const cutoff = Date.now() - days * 86400000;
  for (const [id, d] of Object.entries(seen)) {
    if (Date.parse(d) < cutoff) delete seen[id];
  }
}

function addCompanies(companies, found, via, max) {
  const have = new Set(companies.map(c => `${c.ats}:${c.token}`));
  let added = 0;
  for (const f of found) {
    const key = `${f.ats}:${f.token}`;
    if (have.has(key) || companies.length >= max) continue;
    companies.push({ ats: f.ats, token: f.token, via, first_seen: todayISO() });
    have.add(key);
    added++;
  }
  return added;
}

function save(state) {
  pruneSeen(state.seen);
  fs.writeFileSync(P.seen, JSON.stringify(state.seen, null, 0));
  fs.writeFileSync(P.matches, JSON.stringify(state.matches, null, 1));
  fs.writeFileSync(P.companies, JSON.stringify(state.companies, null, 1));
  fs.writeFileSync(P.misc, JSON.stringify(state.misc, null, 1));
}

module.exports = { load, save, addCompanies, DATA };
