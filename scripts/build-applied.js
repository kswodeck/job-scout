#!/usr/bin/env node
// Regenerate data/applied.json from a CSV export of the Job Application Tracker.
//
//   node scripts/build-applied.js path/to/tracker.csv
//
// The CSV is the tracker's Company + Role/Title columns (plus the rest — only those
// two are read). Get it in a session that has Drive access, e.g. the sheet's
// gviz CSV endpoint, then run this. Only {company, title} are written; salaries,
// notes, and recruiter contacts are never extracted. Rows whose Status is Skipped
// or Duplicate are dropped; everything else counts as "in pipeline".
//
// Zero-dep: standard-library CSV parse only.
const fs = require("fs");
const path = require("path");

const inPath = process.argv[2];
if (!inPath) { console.error("usage: node scripts/build-applied.js <tracker.csv>"); process.exit(1); }
const outPath = path.join(__dirname, "..", "data", "applied.json");

function parseCSV(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ""; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const rows = parseCSV(fs.readFileSync(inPath, "utf8"));
const header = rows[0].map(h => h.trim().toLowerCase());
const ci = header.indexOf("company");
const ti = header.findIndex(h => h.startsWith("role"));   // "role / title"
const si = header.indexOf("status");
if (ci < 0 || ti < 0) { console.error("could not find Company / Role columns in header:", header.slice(0, 6)); process.exit(1); }

const out = [], seen = new Set();
let emptied = 0, dropped = 0;
for (const r of rows.slice(1)) {
  const company = (r[ci] || "").trim();
  const title = (r[ti] || "").trim();
  const status = (si >= 0 ? (r[si] || "") : "").trim().toLowerCase();
  if (!company || !title) { emptied++; continue; }
  if (status === "skipped" || status === "duplicate") { dropped++; continue; }
  const k = (company + "||" + title).toLowerCase();
  if (seen.has(k)) continue;
  seen.add(k);
  out.push({ company, title });
}

fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n");
console.log(`Wrote ${out.length} roles to data/applied.json (skipped ${emptied} blank, ${dropped} skipped/dup).`);
