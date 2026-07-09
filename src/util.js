// Shared helpers. Zero dependencies — Node 20+ built-in fetch only.
const UA = "job-scout/1.0 (personal job-search agent)";

async function fetchText(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.timeout || 25000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return text;
}

async function fetchJson(url, opts = {}) {
  return JSON.parse(await fetchText(url, opts));
}

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "\u2019", lsquo: "\u2018", ldquo: "\u201C", rdquo: "\u201D",
  mdash: "\u2014", ndash: "\u2013", bull: "\u2022", hellip: "\u2026", middot: "\u00B7",
};
function decodeEntities(s = "") {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

// Decode first (Greenhouse ships entity-encoded HTML), then strip tags, then tidy.
function htmlToText(html = "") {
  let s = decodeEntities(String(html));
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n\u2022 ")
    .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return s.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function todayISO() { return new Date().toISOString().slice(0, 10); }

// Company + de-seniorized title, for duplicate suppression across days/sources.
function normFamily(company, title) {
  const t = String(title || "").toLowerCase()
    .replace(/\b(senior|sr\.?|staff|lead|principal|junior|jr\.?|mid[- ]?level|level|i{1,3}|iv|v|\d)\b/g, " ")
    .replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return String(company || "").toLowerCase().trim() + "::" + t;
}

function truncate(s = "", n) { return s.length > n ? s.slice(0, n) + "\u2026" : s; }
function prettyToken(token = "") {
  return token.replace(/[-_.]+/g, " ").trim().replace(/\b\w/g, c => c.toUpperCase());
}

module.exports = { fetchText, fetchJson, htmlToText, decodeEntities, sleep, todayISO, normFamily, truncate, prettyToken };
