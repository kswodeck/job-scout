// Autonomous draft-materials stage: for each match at/above materials.min_score,
// have the LLM tailor a resume + cover letter (grounded ONLY in the master profile),
// build DOCX drafts, and upload them to a Drive review folder. Everything is
// DRAFT-labeled — Kris reviews before sending. Runs last in the pipeline; any
// failure here is non-fatal to the core scout.
//
// Anti-fabrication is enforced in layers: the prompt forbids invention; this module
// filters resume skills to the master pool; build-cli.js asserts every bullet-swap
// matches a real master bullet and hard-fails cover letters that break style.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { runPrompt } = require("./llm");
const { getAccessToken, uploadFile, loadServiceAccount, DOCX_MIME } = require("./drive");
const { MASTER } = require("../materials/master");
const { truncate } = require("./util");

const BUILD_CLI = path.join(__dirname, "..", "materials", "build-cli.js");

const SYSTEM = `You tailor Kris Swodeck's resume and write a cover letter for ONE job posting. Output is a DRAFT he will review before sending.

ABSOLUTE RULE: never invent experience. Every skill, tool, claim, and sentence must be grounded in the MASTER PROFILE provided. If the posting wants something Kris lacks, do NOT claim it — name it honestly in the cover letter's candid paragraph instead.

RESUME (tailoring only, no fabrication):
- tagline: one line emphasizing the posting's stack, using ONLY technologies in Kris's profile.
- skills: the six categories, reordered to surface posting-relevant ones first. Within each category, reorder/drop items to match the posting, but NEVER add an item that isn't already in that category's master list.
- currentlyLearning: null, OR one honest line naming a genuine gap relevant to this posting (only from GENUINE GAPS).
- bulletSwaps: 0 to 3 pairs [oldBullet, newBullet]. oldBullet MUST be copied verbatim from MASTER BULLETS. newBullet re-angles emphasis for this posting but adds NO new fact, tool, metric, employer, or claim.

COVER LETTER — match Kris's established style exactly:
- Exactly 5 body paragraphs.
- P1: hook — why this company/role specifically.
- P2: lead with the 7 years at MIND Education as the primary proof (NEVER open a proof paragraph with a side project).
- P3: a strength the posting emphasizes (testing, AI-assisted dev, etc.); cite CalcCrunch or FantasyFire only if it is the single most relevant proof.
- P4: ONE candid paragraph naming the real gap(s) for THIS role from GENUINE GAPS, and it MUST contain the exact phrase "not a question mark".
- P5: close tying back to the company + "Thank you for your consideration. I look forward to a chance to discuss how I can contribute."
- NO em dashes anywhere (use commas or periods). Do NOT use the phrase "to be candid".

OUTPUT: strict minified JSON, no markdown fences, no commentary:
{"resume":{"tagline":"...","skills":[["Category","items"],...],"currentlyLearning":null,"bulletSwaps":[["old","new"],...]},"cover":{"company":"...","re":"Re: <exact posting title>","paragraphs":["p1","p2","p3","p4","p5"]}}`;

function profileForPrompt() {
  return [
    "MASTER PROFILE",
    `Name: ${MASTER.name}. ${MASTER.summary}`,
    "",
    "SKILL POOL (never add outside these):",
    ...MASTER.skills.map(([c, i]) => `- ${c}: ${i}`),
    "",
    "GENUINE GAPS (use for the candid paragraph / currentlyLearning): Go, C#/.NET, hands-on AWS, Kubernetes/Terraform config, deep MySQL or advanced SQL tuning.",
    "PARTIAL (matched, no gap): Docker, PostgreSQL (Prisma/ORM level).",
    "React/Next.js and Angular are real, claimable (FantasyFire + portfolio) — claim them normally.",
    "",
    "MASTER BULLETS (bulletSwaps.old must be one of these, verbatim):",
    ...MASTER.allBullets.map((b, i) => `${i + 1}. ${b}`),
    "",
    "PROJECTS: Portfolio (4 frameworks), CalcCrunch (autonomous AI publishing pipeline), FantasyFire (Next.js/React/TS, Postgres/Prisma).",
  ].join("\n");
}

function parseObj(text) {
  const t = String(text).replace(/```(?:json)?/gi, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a === -1 || b === -1) throw new Error("no JSON object in response");
  return JSON.parse(t.slice(a, b + 1));
}

// Filter each skills line to items that actually exist in the master pool (blocks
// invented skills). Keeps the model's ordering; drops anything not in master.
function sanitizeSkills(modelSkills) {
  const masterByCat = new Map(MASTER.skills.map(([c, i]) => [c.toLowerCase(), i.split(",").map(s => s.trim())]));
  const out = [];
  for (const row of Array.isArray(modelSkills) ? modelSkills : []) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const [cat, items] = row;
    const masterItems = masterByCat.get(String(cat).toLowerCase());
    if (!masterItems) continue; // invented category -> drop
    const allow = new Set(masterItems.map(s => s.toLowerCase()));
    const kept = String(items).split(",").map(s => s.trim()).filter(s => allow.has(s.toLowerCase()));
    out.push([cat, (kept.length ? kept : masterItems).join(", ")]);
  }
  // fall back to full master set if the model returned nothing usable
  return out.length === MASTER.skills.length ? out : MASTER.skills;
}

async function generateConfig(match, text, dateStr, cfg) {
  const user = [
    profileForPrompt(),
    "",
    "JOB POSTING",
    `Company: ${match.company}`,
    `Title: ${match.title}`,
    `POSTING TEXT:\n${truncate(text || "", 3800)}`,
    "",
    "Return the JSON now.",
  ].join("\n");
  const raw = await runPrompt(cfg, "score", SYSTEM, user, 3000);
  const obj = parseObj(raw);
  if (!obj.resume || !obj.cover || !Array.isArray(obj.cover.paragraphs)) throw new Error("missing resume/cover fields");
  const label = String(match.company).replace(/[^A-Za-z0-9]+/g, "").slice(0, 40) || "Role";
  return {
    label,
    company: match.company,
    date: dateStr,
    resume: {
      tagline: obj.resume.tagline || MASTER.tagline,
      skills: sanitizeSkills(obj.resume.skills),
      currentlyLearning: obj.resume.currentlyLearning || null,
      bulletSwaps: Array.isArray(obj.resume.bulletSwaps) ? obj.resume.bulletSwaps : [],
    },
    cover: { company: match.company, re: obj.cover.re || `Re: ${match.title}`, paragraphs: obj.cover.paragraphs },
  };
}

async function runMaterials(matches, textById, cfg) {
  // Env-first for the same reason as tracker.spreadsheet_id — see src/tracker.js.
  const m = { ...(cfg.materials || {}) };
  m.drive_folder_id = process.env.MATERIALS_DRIVE_FOLDER_ID || m.drive_folder_id;
  const sa = loadServiceAccount();
  const eligible = matches.filter(x => x.score >= (m.min_score || 60)).slice(0, m.max_per_run || 8);
  if (!eligible.length) { console.log("Materials: no matches at/above the bar."); return; }
  if (!sa) { console.log(`Materials: ${eligible.length} eligible, but GOOGLE_SERVICE_ACCOUNT_JSON not set — skipping upload.`); return; }
  if (!m.drive_folder_id) { console.log("Materials: drive_folder_id not configured — skipping."); return; }

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "jobscout-materials-"));
  let token;
  try { token = await getAccessToken(sa); }
  catch (e) { console.log(`Materials: Drive auth failed (${e.message}) — skipping.`); return; }

  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  let built = 0;
  for (const match of eligible) {
    try {
      const cfgObj = await generateConfig(match, textById.get(match.id), dateStr, cfg);
      const cfgPath = path.join(outDir, `${cfgObj.label}.json`);
      fs.writeFileSync(cfgPath, JSON.stringify(cfgObj));
      const r = spawnSync("node", [BUILD_CLI, cfgPath, outDir], { encoding: "utf8" });
      if (r.status !== 0) { console.log(`  materials ${match.company}: build failed — ${(r.stderr || "").trim().slice(0, 160)}`); continue; }
      const { resume, cover } = JSON.parse(r.stdout.trim());
      for (const [f, kind] of [[resume, "Resume"], [cover, "Cover-Letter"]]) {
        const name = `DRAFT ${match.company} ${kind} ${dateStr}.docx`;
        await uploadFile(token, m.drive_folder_id, f, name, DOCX_MIME);
      }
      built++;
      console.log(`  materials ${match.company} (${match.score}): resume + cover uploaded`);
    } catch (e) {
      console.log(`  materials ${match.company}: ${e.message}`);
    }
  }
  console.log(`Materials: ${built}/${eligible.length} drafts uploaded to Drive review folder.`);
}

module.exports = { runMaterials, generateConfig, sanitizeSkills };
