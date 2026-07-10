// Append each night's 60+ matches to Kris's Job Application Tracker (Google
// Sheet) so they land in his pipeline automatically, formatted the way he
// already enters them by hand: Status "Radar" (surfaced, not yet applied),
// Priority High for 70+, "NN/100 <verdict>" in Notes, bare score in Rank.
//
// Auth reuses the service-account JWT flow in drive.js — the
// https://www.googleapis.com/auth/drive scope is accepted by the Sheets API,
// so one secret (GOOGLE_SERVICE_ACCOUNT_JSON) powers both this and the
// materials upload. Requirements (see README "Google integration"):
//   - the tracker must be a NATIVE Google Sheet (the Sheets API cannot write
//     to an .xlsx stored in Drive — the original tracker was one),
//   - the sheet must be shared with the service account's client_email as
//     Editor, and tracker.spreadsheet_id set in config.
// Non-fatal by design: scout.js wraps the call; any failure just logs.
const { getAccessToken, loadServiceAccount } = require("./drive");

// Column layout of the "Applications" tab (verified 2026-07-10):
// Company | Role / Title | Location | Remote? | Salary Low | Salary High |
// Source | Job Posting URL | Date Applied | Status | Priority |
// Contact / Recruiter | Next Action | Next Action Date | Notes | Rank

// Pull dollar bounds out of the scorer's free-text salary ("$120,000 - $160,000",
// "120k–160k"). Unparseable but non-empty text (e.g. "$60/hr") is passed through
// raw in Salary Low, matching how Kris records hourly rates by hand.
function salaryBounds(s = "") {
  const raw = String(s).trim();
  if (!raw || /not listed/i.test(raw)) return ["", ""];
  const nums = [...raw.matchAll(/\$?\s?(\d{2,3})\s?k\b|\$\s?(\d{1,3}(?:,\d{3})+)/gi)]
    .map(m => (m[1] ? Number(m[1]) * 1000 : Number(m[2].replace(/,/g, ""))));
  if (!nums.length) return [raw.slice(0, 40), ""];
  const fmt = n => "$" + n.toLocaleString("en-US");
  const lo = Math.min(...nums), hi = Math.max(...nums);
  return [fmt(lo), hi !== lo ? fmt(hi) : ""];
}

function remoteFlag(location = "") {
  if (/hybrid/i.test(location)) return "Hybrid";
  if (/remote|anywhere|distributed|work from home|\bwfh\b/i.test(location)) return "Yes";
  if (/on-?site|in-?office/i.test(location)) return "No";
  return "";
}

function buildRow(m) {
  const [lo, hi] = salaryBounds(m.salary_out);
  const verdict = m.verdict || (m.score >= 70 ? "Strong match" : "Worth applying");
  const date = new Date(`${m.scoutedAt}T12:00:00`).toLocaleDateString("en-US");
  return [
    m.company, m.title, m.location_out || "", remoteFlag(m.location_out),
    lo, hi, m.via || "", m.url || "", date, "Radar",
    m.score >= 70 ? "High" : "Medium", "", "", "",
    `${m.score}/100 ${verdict}${m.stars?.length ? ` ⭐ ${m.stars.join(", ")}` : ""}`,
    m.score,
  ];
}

async function appendToTracker(matches, cfg) {
  const t = cfg.tracker || {};
  const rows = matches.filter(m => m.score >= (t.min_score || 60)).map(buildRow);
  if (!rows.length) { console.log("Tracker: no matches at/above the bar."); return; }
  const sa = loadServiceAccount();
  if (!sa) { console.log(`Tracker: ${rows.length} row(s) ready, but GOOGLE_SERVICE_ACCOUNT_JSON not set — skipping.`); return; }
  if (!t.spreadsheet_id) { console.log(`Tracker: ${rows.length} row(s) ready, but tracker.spreadsheet_id not set — skipping (the tracker must be converted to a native Google Sheet first; see README).`); return; }

  const token = await getAccessToken(sa);
  const range = encodeURIComponent(`${t.sheet_name || "Applications"}!A1`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${t.spreadsheet_id}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ values: rows }),
      signal: AbortSignal.timeout(30000),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`sheets append failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  console.log(`Tracker: appended ${rows.length} row(s) to the Job Application Tracker.`);
}

module.exports = { appendToTracker, buildRow, salaryBounds, remoteFlag };
