// Suppress candidates that duplicate a role already in Kris's application tracker.
//
// data/applied.json is a snapshot of {company, title} pairs pulled from
// the Company + Role/Title columns of his Google Sheet — nothing else (no salaries,
// notes, or recruiter names). The nightly GitHub Actions run has no Google login,
// so this file is the tracker's stand-in; refresh it on demand from a session that
// has Drive access (see scripts/refresh-applied note in the PR).
//
// Match rule (per Kris's call): same company + same CORE role. Core role
// de-seniorizes the title and drops sub-descriptors, so "Senior Frontend Engineer,
// Community Builders" blocks a new "Frontend Engineer" at that company — but two
// genuinely different roles at one company (e.g. Amazon "Front-End Engineer" vs
// "Software Dev Engineer") stay independent. No time window: while a role sits in
// the tracker, it stays blocked.
const fs = require("fs");
const path = require("path");

const APPLIED = path.join(__dirname, "..", "data", "applied.json");

// Company key: lowercase, drop legal/boilerplate suffixes and punctuation. Kept
// deliberately light so distinct firms don't collapse (e.g. "Pearl" vs "Pearl
// Health" stay separate — only obvious suffixes like Inc/LLC/Careers are removed).
function normCompany(c) {
  return String(c || "")
    .toLowerCase()
    .replace(/^company:\s*/, "")               // HN posts sometimes prefix "Company:"
    .replace(/\([^)]*\)/g, " ")                // drop parentheticals e.g. "(S14)", "(www.x.co)"
    .replace(/https?:\/\/\S+|www\.\S+/g, " ")  // drop stray URLs from HN company fields
    .replace(/&/g, " and ")
    .replace(/\b(inc|llc|l\.l\.c|ltd|co|corp|corporation|careers)\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Core-role key: normalize front/back/full-stack spellings and developer==engineer,
// drop parentheticals and any sub-descriptor after the first comma / spaced dash /
// pipe, then de-seniorize. "Senior Front-End Developer, Growth (React)" -> "frontend
// engineer".
function roleCore(title) {
  let t = String(title || "").toLowerCase();
  t = t.replace(/front[\s-]?end/g, "frontend")
       .replace(/back[\s-]?end/g, "backend")
       .replace(/full[\s-]?stack/g, "fullstack");
  t = t.split(/,|\s[-–—]\s|\|/)[0];      // keep the head role only
  t = t.replace(/\([^)]*\)/g, " ");                // drop any leftover parenthetical
  t = t.replace(/\bdevelopers?\b/g, "engineer")
       .replace(/\bengineers?\b/g, "engineer");    // developer == engineer for dedup
  t = t.replace(/\b(senior|sr|staff|lead|principal|junior|jr|mid|midlevel|level|associate|i{1,3}|iv|v|\d+)\b/g, " ");
  t = t.replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  return t;
}

function key(company, title) {
  const co = normCompany(company), role = roleCore(title);
  return co && role ? co + "::" + role : null;
}

// Returns a Set of "company::role" keys, or null if the tracker file is absent
// (feature simply no-ops until data/applied.json exists).
function loadAppliedSet() {
  let rows;
  try { rows = JSON.parse(fs.readFileSync(APPLIED, "utf8")); } catch { return null; }
  if (!Array.isArray(rows)) return null;
  const set = new Set();
  for (const r of rows) {
    const k = key(r.company, r.title);
    if (k) set.add(k);
  }
  return set;
}

function isAlreadyApplied(job, appliedSet) {
  if (!appliedSet) return false;
  const k = key(job.company, job.title);
  return !!k && appliedSet.has(k);
}

module.exports = { loadAppliedSet, isAlreadyApplied, normCompany, roleCore, key };
