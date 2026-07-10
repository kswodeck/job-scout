// Job source fetchers. Every fetcher returns normalized jobs:
// { id, source, via, company, title, url, location, salary, salaryMin, salaryMax,
//   publishedAt (ISO), text (plain, capped), hnMode?, atsJob?, isRemoteFlag? }
// All endpoints below were live-verified (field names included) on 2026-07-08;
// EdTech.com and Christian Tech Jobs on 2026-07-10.
const crypto = require("crypto");
const { fetchText, fetchJson, htmlToText, prettyToken } = require("./util");

const CAP = 9000; // chars of description kept per job

function norm(j) { return { salary: "", salaryMin: 0, salaryMax: 0, location: "", ...j }; }

// ---------------- Remotive (public API; ~1 call/day is polite) ----------------
async function fetchRemotive(cfg, sinceMs) {
  const out = [];
  for (const cat of cfg.remotive_categories) {
    const d = await fetchJson(`https://remotive.com/api/remote-jobs?category=${encodeURIComponent(cat)}`);
    for (const x of d.jobs || []) {
      const pub = Date.parse(x.publication_date);
      if (Number.isFinite(pub) && pub < sinceMs) continue;
      out.push(norm({
        id: `remotive:${x.id}`, source: "remotive", via: "Remotive",
        company: x.company_name, title: x.title, url: x.url,
        location: x.candidate_required_location || "", salary: x.salary || "",
        publishedAt: Number.isFinite(pub) ? new Date(pub).toISOString() : "",
        text: htmlToText(x.description).slice(0, CAP),
      }));
    }
  }
  return out;
}

// ---------------- RemoteOK (public API; attribution = we link to their pages) ---
async function fetchRemoteOK(sinceMs) {
  const d = await fetchJson("https://remoteok.com/api");
  const out = [];
  for (const x of d) {
    if (!x || !x.id || !x.position) continue; // element 0 is a legal notice
    const pub = Date.parse(x.date);
    if (Number.isFinite(pub) && pub < sinceMs) continue;
    out.push(norm({
      id: `rok:${x.id}`, source: "remoteok", via: "RemoteOK",
      company: x.company || "", title: x.position, url: x.url,
      location: x.location || "", salaryMin: x.salary_min || 0, salaryMax: x.salary_max || 0,
      salary: x.salary_max ? `$${x.salary_min || "?"}\u2013$${x.salary_max}` : "",
      publishedAt: Number.isFinite(pub) ? new Date(pub).toISOString() : "",
      text: htmlToText(x.description).slice(0, CAP),
    }));
  }
  return out;
}

// ---------------- We Work Remotely (RSS) --------------------------------------
function rssTag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : "";
}
async function fetchWWR(cfg, sinceMs) {
  const out = [], seenLinks = new Set();
  for (const cat of cfg.wwr_categories) {
    let xml;
    try { xml = await fetchText(`https://weworkremotely.com/categories/${cat}.rss`); }
    catch (e) { console.log(`  wwr category ${cat} failed: ${e.message}`); continue; }
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const it = m[1];
      const link = rssTag(it, "link");
      if (!link || seenLinks.has(link)) continue;
      seenLinks.add(link);
      const pub = Date.parse(rssTag(it, "pubDate"));
      if (Number.isFinite(pub) && pub < sinceMs) continue;
      const rawTitle = htmlToText(rssTag(it, "title"));
      const ci = rawTitle.indexOf(": ");
      const company = ci > 0 ? rawTitle.slice(0, ci) : "";
      const title = ci > 0 ? rawTitle.slice(ci + 2) : rawTitle;
      const location = [rssTag(it, "region"), rssTag(it, "state"), rssTag(it, "country")].filter(Boolean).join(", ");
      out.push(norm({
        id: `wwr:${link}`, source: "wwr", via: "WeWorkRemotely",
        company, title, url: link, location,
        publishedAt: Number.isFinite(pub) ? new Date(pub).toISOString() : "",
        text: htmlToText(rssTag(it, "description")).slice(0, CAP),
      }));
    }
  }
  return out;
}

// ---------------- EdTech.com (RSS) ----------------------------------------------
// https://www.edtech.com/feed serves the full active corpus (~1,900 items, ~15 MB)
// as RSS 2.0 with custom item fields: jobTitle, companyName, jobType, applyLink,
// location, description (entity-encoded plain text). robots.txt allows /feed —
// Cloudflare gates the HTML pages but deliberately leaves /feed open to
// non-browser clients — while /api/ is disallowed: never probe their API. ToS
// (checked 2026-07-10) contains no scraping/automation clause.
// Feed quirks (verified): NO per-item pubDate and NO guid, so lookback filtering
// is impossible — newness is purely the set-diff against seen.json — and a bare
// applyLink is NOT unique (one URL served two distinct jobs in a single
// snapshot), so the id hashes link+company+title. The board lists many on-site
// university roles; the prefilter's strict location gate (remote-US or DFW)
// handles them. location is "US" (nationwide), "City, ST, US", or a bare ISO
// country code; "US" usually means remote (~72% sampled), so isRemoteFlag lets
// it pass as remote-ish and the LLM screen verifies against the description.
async function fetchEdTech(seen) {
  const xml = await fetchText("https://www.edtech.com/feed", { timeout: 90000 });
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const title = htmlToText(rssTag(it, "jobTitle"));
    const company = htmlToText(rssTag(it, "companyName"));
    const url = rssTag(it, "applyLink");
    if (!title || !url) continue;
    const location = htmlToText(rssTag(it, "location"));
    const country = (location.split(",").pop() || "").trim();
    if (/^[A-Z]{2}$/.test(country) && country !== "US") continue; // non-US listing
    const id = `edtech:${crypto.createHash("sha1").update(`${url}|${company}|${title}`).digest("hex").slice(0, 16)}`;
    if (seen[id]) continue;
    const jobType = htmlToText(rssTag(it, "jobType"));
    out.push(norm({
      id, source: "edtech", via: "EdTech.com",
      company, title, url, location,
      isRemoteFlag: location === "US",
      publishedAt: "",
      text: ((jobType ? `Job type: ${jobType}\n` : "") + htmlToText(rssTag(it, "description"))).slice(0, CAP),
    }));
  }
  return out;
}

// ---------------- Christian Tech Jobs (RSS) --------------------------------------
// https://www.christiantechjobs.io/api/rss is the whole archive (~940 items back
// to Oct 2024) as RSS 2.0: title, link (= guid = job URL), pubDate (RFC-822),
// description (CDATA HTML: og-image, a "Tags:" skill line, then the posting).
// robots.txt explicitly allows /api/rss while disallowing the rest of /api/, and
// the ToS bans scraping only "except where expressly permitted" — one nightly
// fetch of the allowed RSS is that permitted path. Their JSON API (/api/v1/jobs)
// is 401 without a key: not usable. ToS licenses content for PERSONAL use —
// keep this repo and its digest issues private. The feed is NOT strictly
// newest-first (verified: 2 inversions), so every item is date-filtered
// independently; never early-break on the first old item.
// Company is not a field; it is parsed from the URL slug
// ([remote-]<title-words>-<company-words>-<id>) by stripping title words — a
// company whose name repeats a title word loses that word (rare; blank company
// worst case).
function ctjCompany(link, title) {
  const slug = (link.split("/").pop() || "").toLowerCase().replace(/-\d+$/, "").replace(/^remote-/, "");
  const titleWords = new Set(String(title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" "));
  const words = slug.split("-").filter(Boolean);
  let i = 0;
  while (i < words.length && titleWords.has(words[i])) i++;
  return prettyToken(words.slice(i).join(" "));
}
async function fetchChristianTechJobs(sinceMs) {
  const xml = await fetchText("https://www.christiantechjobs.io/api/rss", { timeout: 60000 });
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const link = rssTag(it, "link");
    if (!link) continue;
    const pub = Date.parse(rssTag(it, "pubDate"));
    if (Number.isFinite(pub) && pub < sinceMs) continue;
    const title = htmlToText(rssTag(it, "title"));
    const slug = link.split("/").pop() || "";
    const idNum = (slug.match(/-(\d+)$/) || [])[1];
    const text = htmlToText(rssTag(it, "description")).slice(0, CAP);
    const remote = /^remote-/.test(slug) || /remote christian jobs/i.test(text.slice(0, 400));
    out.push(norm({
      id: `ctj:${idNum || link}`, source: "christiantechjobs", via: "ChristianTechJobs",
      company: ctjCompany(link, title), title, url: link,
      location: remote ? "Remote" : "", isRemoteFlag: remote,
      publishedAt: Number.isFinite(pub) ? new Date(pub).toISOString() : "",
      text,
    }));
  }
  return out;
}

// ---------------- Hacker News "Who is hiring?" (Algolia API) --------------------
async function fetchHN(cfg, hnState) {
  const s = await fetchJson("https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=who%20is%20hiring&hitsPerPage=4");
  const thread = (s.hits || []).find(h => /who is hiring/i.test(h.title || ""));
  if (!thread) return { jobs: [], lastTs: hnState.last_ts || 0 };
  const item = await fetchJson(`https://hn.algolia.com/api/v1/items/${thread.objectID}`);
  let kids = (item.children || []).filter(c => c && c.text);
  kids.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); // newest first
  const prevTs = thread.objectID === hnState.thread_id ? (hnState.last_ts || 0) : 0;
  kids = prevTs
    ? kids.filter(c => Date.parse(c.created_at) > prevTs)
    : kids.slice(0, cfg.hn_first_run_limit); // new thread / first run: cap the backfill
  const jobs = kids.map(c => {
    const text = htmlToText(c.text).slice(0, CAP);
    const firstLine = text.split("\n")[0] || "";
    const segs = firstLine.split("|").map(x => x.trim()).filter(Boolean);
    const roleGuess = segs.find(x => /engineer|developer|front.?end|full.?stack/i.test(x));
    return norm({
      id: `hn:${c.id}`, source: "hn", via: "HN Who's Hiring", hnMode: true,
      company: (segs[0] || "HN posting").slice(0, 80),
      title: (roleGuess || segs[1] || firstLine).slice(0, 110),
      url: `https://news.ycombinator.com/item?id=${c.id}`,
      location: "", publishedAt: c.created_at, text,
    });
  });
  const lastTs = Math.max(prevTs, ...kids.map(c => Date.parse(c.created_at)), 0);
  return { jobs, lastTs, threadId: thread.objectID, threadTitle: thread.title };
}

// ---------------- ATS boards (self-growing watchlist) ---------------------------
// Greenhouse / Lever / Ashby all expose free public JSON. Verified live.
async function fetchATSBoards(companies, seen) {
  const out = [];
  for (const c of companies) {
    try {
      if (c.ats === "greenhouse") {
        const d = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${c.token}/jobs?content=true`);
        for (const x of (d.jobs || []).slice(0, 200)) {
          const id = `gh:${c.token}:${x.id}`;
          if (seen[id]) continue;
          out.push(norm({
            id, source: "ats", via: `Greenhouse (${c.token})`, atsJob: true,
            company: x.company_name || prettyToken(c.token), title: x.title, url: x.absolute_url,
            location: x.location?.name || "",
            publishedAt: x.first_published || x.updated_at || "",
            text: htmlToText(x.content || "").slice(0, CAP),
          }));
        }
      } else if (c.ats === "lever") {
        const d = await fetchJson(`https://api.lever.co/v0/postings/${c.token}?mode=json`);
        for (const x of (Array.isArray(d) ? d : []).slice(0, 200)) {
          const id = `lever:${c.token}:${x.id}`;
          if (seen[id]) continue;
          out.push(norm({
            id, source: "ats", via: `Lever (${c.token})`, atsJob: true,
            company: prettyToken(c.token), title: x.text, url: x.hostedUrl,
            location: [x.categories?.location, x.workplaceType].filter(Boolean).join(" \u00B7 "),
            publishedAt: x.createdAt ? new Date(x.createdAt).toISOString() : "",
            text: (x.descriptionPlain || htmlToText(x.description || "")).slice(0, CAP),
          }));
        }
      } else if (c.ats === "ashby") {
        const d = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${c.token}?includeCompensation=true`);
        for (const x of (d.jobs || []).filter(x => x.isListed !== false).slice(0, 200)) {
          const id = `ashby:${c.token}:${x.id}`;
          if (seen[id]) continue;
          out.push(norm({
            id, source: "ats", via: `Ashby (${c.token})`, atsJob: true, isRemoteFlag: !!x.isRemote,
            company: prettyToken(c.token), title: x.title, url: x.jobUrl || x.applyUrl,
            location: [x.location, x.isRemote ? "Remote" : "", x.workplaceType].filter(Boolean).join(" \u00B7 "),
            salary: x.compensation?.compensationTierSummary || "",
            publishedAt: x.publishedAt || "",
            text: (x.descriptionPlain || htmlToText(x.descriptionHtml || "")).slice(0, CAP),
          }));
        }
      }
    } catch (e) {
      console.log(`  ats board ${c.ats}:${c.token} failed: ${e.message}`);
    }
  }
  return out;
}

// Scan job text/urls for Greenhouse/Lever/Ashby board tokens -> grows the watchlist.
const JUNK = new Set(["embed", "job", "jobs", "boards", "apply", "careers", "postings", "job_board", "www"]);
function scanForATSTokens(jobs) {
  const blob = jobs.map(j => `${j.url || ""} ${j.text || ""}`).join("\n");
  const found = [];
  const push = (ats, re) => {
    for (const m of blob.matchAll(re)) {
      const token = m[1].toLowerCase();
      if (token.length >= 2 && token.length <= 40 && !JUNK.has(token)) found.push({ ats, token });
    }
  };
  push("greenhouse", /boards\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_-]{2,40})/g);
  push("greenhouse", /job-boards\.greenhouse\.io\/([A-Za-z0-9_-]{2,40})/g);
  push("lever", /jobs\.lever\.co\/([A-Za-z0-9_-]{2,40})/g);
  push("ashby", /jobs\.ashbyhq\.com\/([A-Za-z0-9_.\-]{2,40})/g);
  const uniq = new Map();
  for (const f of found) uniq.set(`${f.ats}:${f.token}`, f);
  return [...uniq.values()];
}

module.exports = { fetchRemotive, fetchRemoteOK, fetchWWR, fetchEdTech, fetchChristianTechJobs, fetchHN, fetchATSBoards, scanForATSTokens };
