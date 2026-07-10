// Builds digest.md (posted as a GitHub Issue by the workflow) and regenerates
// data/matches.md, a browsable cumulative log of every match ever surfaced.
const fs = require("fs");
const path = require("path");
const { truncate } = require("./util");

const ROOT = path.join(__dirname, "..");

function esc(s = "") { return String(s).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim(); }
function li(items, label) {
  return items && items.length ? `- **${label}:** ${items.map(x => esc(x)).join(" \u00B7 ")}\n` : "";
}

function jobBlock(m) {
  const star = m.stars?.length ? ` \u2B50 ${m.stars.join(", ")}` : "";
  let s = `### ${m.score} \u2014 ${esc(m.company)} \u2014 ${esc(m.title)}${star}\n`;
  s += `[View posting](${m.url}) \u00B7 via ${m.via} \u00B7 ${esc(m.salary_out || "Not listed")} \u00B7 ${esc(m.location_out || "?")}\n`;
  s += li(m.strengths, "Why");
  s += li(m.red_flags, "Flags");
  s += li(m.deductions, "Deductions");
  s += li(m.tailoring_tips, "Tailor");
  if (m.ats_keywords?.length) s += `- **ATS:** ${m.ats_keywords.map(esc).join(", ")}\n`;
  return s + "\n";
}

function buildDigest({ date, matches, skippedScored, screenFails = [], stats, cost, preview }) {
  const strong = matches.filter(m => m.score >= 70);
  const worth = matches.filter(m => m.score < 70);
  const title = preview
    ? `Job Scout PREVIEW \u2014 ${date} \u2014 ${matches.length} candidates (unscored)`
    : `Job Scout \u2014 ${date} \u2014 ${strong.length} strong / ${worth.length} worth applying`;

  let md = "";
  if (preview) {
    md += `> **Preview run (no LLM).** These are prefilter survivors only \u2014 not scored, not deduped against future state. Run with \`ANTHROPIC_API_KEY\` set for real scoring.\n\n`;
  }
  md += `**Pipeline:** ${stats.fetched} fetched \u2192 ${stats.fresh} new \u2192 ${stats.prefiltered} passed prefilter`;
  if (stats.appliedSuppressed) md += ` (\u2212${stats.appliedSuppressed} already-applied)`;
  if (!preview) md += ` \u2192 ${stats.screened} passed screen \u2192 ${stats.scored} scored \u2192 **${matches.length} matches**`;
  md += `.`;
  if (cost && cost.subscription) md += ` LLM usage: ${cost.detail}.`;
  else if (cost && cost.total > 0) md += ` Est. LLM cost: ~$${cost.total.toFixed(2)} (${cost.detail}).`;
  if (stats.newCompanies) md += ` Watchlist grew by ${stats.newCompanies} compan${stats.newCompanies === 1 ? "y" : "ies"}.`;
  md += `\n\n`;

  if (preview) {
    for (const m of matches) {
      const star = m.stars?.length ? ` \u2B50 ${m.stars.join(", ")}` : "";
      md += `- **${esc(m.company)}** \u2014 [${esc(m.title)}](${m.url})${star} \u00B7 via ${m.via} \u00B7 ${esc(m.salary || "salary n/a")} \u00B7 ${esc(truncate(m.location || "location n/a", 60))}\n`;
    }
    return { title, md };
  }

  if (strong.length) { md += `## Strong matches (70+)\n\n`; strong.forEach(m => (md += jobBlock(m))); }
  if (worth.length) { md += `## Worth applying (55\u201369)\n\n`; worth.forEach(m => (md += jobBlock(m))); }
  if (!matches.length) md += `_No matches cleared the bar today._\n\n`;

  if (skippedScored.length) {
    md += `<details><summary>Scored but skipped (${skippedScored.length})</summary>\n\n`;
    for (const m of skippedScored) {
      md += `- ${m.score} \u2014 ${esc(m.company)} \u2014 [${esc(m.title)}](${m.url}) \u2014 ${esc(m.red_flags?.[0] || m.deductions?.[0] || "below bar")}\n`;
    }
    md += `\n</details>\n`;
  }

  // Screen rejections, with Haiku's own one-line reason \u2014 the audit trail for
  // "why didn't X show up", without opening the Actions log.
  if (screenFails.length) {
    md += `<details><summary>Failed the screen (${screenFails.length})</summary>\n\n`;
    for (const f of screenFails) {
      md += `- ${esc(f.company)} \u2014 [${esc(f.title)}](${f.url}) \u00b7 via ${f.via} \u2014 ${esc(f.reason)}\n`;
    }
    md += `\n</details>\n`;
  }
  return { title, md };
}

function writeDigest(digest) {
  fs.writeFileSync(path.join(ROOT, "digest.md"), digest.md);
  fs.writeFileSync(path.join(ROOT, "digest_title.txt"), digest.title + "\n");
}

function writeMatchesMd(allMatches) {
  const rows = [...allMatches].reverse().slice(0, 300); // newest first
  let md = `# Match log\n\nEvery posting the scout surfaced at ${"score >= min_score"} \u2014 newest first. Full details in each day's digest issue.\n\n`;
  md += `| Date | Score | Company | Title | Salary | Location | Via |\n|---|---|---|---|---|---|---|\n`;
  for (const m of rows) {
    md += `| ${m.scoutedAt} | ${m.score} | ${esc(m.company)} | [${esc(truncate(m.title, 60))}](${m.url}) | ${esc(truncate(m.salary_out || "\u2014", 30))} | ${esc(truncate(m.location_out || "\u2014", 30))} | ${m.via} |\n`;
  }
  fs.writeFileSync(path.join(ROOT, "data", "matches.md"), md);
}

module.exports = { buildDigest, writeDigest, writeMatchesMd };
