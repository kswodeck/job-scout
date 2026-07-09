#!/usr/bin/env node
/* Build a tailored resume + cover letter PDF from a generated config.
 *
 *   node materials/build-cli.js <config.json> <outDir>
 *
 * config.json shape (produced by src/materials.js, never hand-edited in CI):
 * {
 *   "label": "MavenClinic", "company": "Maven Clinic", "date": "June 11, 2026",
 *   "resume": { "tagline": "...", "skills": [["Languages","..."], ...],
 *               "currentlyLearning": null|"...", "bulletSwaps": [["oldExact","new"], ...] },
 *   "cover":  { "re": "Re: ...", "paragraphs": ["p1","p2","p3","p4","p5"] }
 * }
 *
 * Output: <outDir>/DRAFT-Kris-Swodeck-Resume-<label>.docx
 *         <outDir>/DRAFT-Kris-Swodeck-Cover-Letter-<label>.docx
 * Files are DRAFT-labeled and land in a review folder — never send unread. DOCX
 * (not PDF) on purpose: no LibreOffice dependency, and drafts stay editable so
 * Kris can tweak before exporting to PDF himself.
 *
 * Isolated from the zero-dep core scout: this dir has its own package.json (docx).
 */
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ExternalHyperlink,
  AlignmentType, TabStopType, LevelFormat, BorderStyle,
} = require("docx");
const { MASTER } = require("./master");

const ACCENT = "1F4E79", LINKCOL = "0563C1", RIGHT_TAB = 10080;

// ---- resume helpers (verbatim layout from build_resume.js) ----
function link(text, url) { return new ExternalHyperlink({ link: url, children: [new TextRun({ text, color: LINKCOL, underline: {}, size: 18, font: "Arial" })] }); }
function sep() { return new TextRun({ text: "   |   ", font: "Arial", size: 18, color: "595959" }); }
function sectionHeader(text) {
  return new Paragraph({ spacing: { before: 220, after: 90 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 2 } },
    children: [new TextRun({ text, bold: true, allCaps: true, size: 22, color: ACCENT, font: "Arial" })] });
}
function orgLine(boldText, restText, dateText) {
  const kids = [new TextRun({ text: boldText, bold: true, size: 21, font: "Arial" })];
  if (restText) kids.push(new TextRun({ text: restText, size: 21, font: "Arial" }));
  kids.push(new TextRun({ text: "\t" + dateText, size: 20, font: "Arial" }));
  return new Paragraph({ spacing: { before: 120, after: 0 }, tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }], children: kids });
}
function roleLine(title, dateText) {
  const kids = [new TextRun({ text: title, italics: true, size: 20, font: "Arial" })];
  if (dateText) kids.push(new TextRun({ text: "\t" + dateText, italics: true, size: 19, font: "Arial" }));
  return new Paragraph({ spacing: { before: 60, after: 0 }, tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }], children: kids });
}
function projectLine(name, linkText, linkUrl, dateText) {
  const kids = [new TextRun({ text: name, bold: true, size: 21, font: "Arial" })];
  if (linkText && linkUrl) { kids.push(new TextRun({ text: "  ", size: 21, font: "Arial" })); kids.push(link(linkText, linkUrl)); }
  kids.push(new TextRun({ text: "\t" + dateText, size: 20, font: "Arial" }));
  return new Paragraph({ spacing: { before: 120, after: 0 }, tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }], children: kids });
}
function bullet(text) { return new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { before: 20, after: 20 }, children: [new TextRun({ text, size: 20, font: "Arial" })] }); }
function skillRow(cat, items) { return new Paragraph({ spacing: { after: 30 }, children: [new TextRun({ text: cat + ": ", bold: true, size: 20, font: "Arial" }), new TextRun({ text: items, size: 20, font: "Arial" })] }); }

// Bullet swaps: replace an EXACT master bullet with new text, asserting exactly one match.
// This is the core anti-fabrication guard — the generator can only rephrase real bullets.
function applySwaps(data, swaps) {
  const d = JSON.parse(JSON.stringify(data));
  for (const [oldT, newT] of (swaps || [])) {
    let count = 0;
    const replaceIn = arr => { for (let i = 0; i < arr.length; i++) if (arr[i] === oldT) { arr[i] = newT; count++; } };
    d.experience.forEach(co => co.roles.forEach(r => replaceIn(r.bullets)));
    d.projects.forEach(p => replaceIn(p.bullets));
    if (count !== 1) throw new Error(`bullet swap matched ${count} times (expected 1): "${oldT.slice(0, 70)}..."`);
  }
  return d;
}

function buildResume(cfg, outDir) {
  const data = applySwaps(MASTER, cfg.resume.bulletSwaps);
  data.tagline = cfg.resume.tagline || MASTER.tagline;
  data.skills = cfg.resume.skills || MASTER.skills;
  const c = MASTER.contact;
  const children = [];
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20 }, children: [new TextRun({ text: data.name, bold: true, size: 40, font: "Arial" })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 10 }, children: [new TextRun({ text: data.title, size: 23, color: ACCENT, font: "Arial" })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: data.tagline, size: 18, color: "595959", font: "Arial" })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 10 }, children: [new TextRun({ text: c.location, size: 18, font: "Arial" }), sep(), link(c.phone, c.phoneUrl), sep(), link(c.email, c.emailUrl)] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [link(c.linkedin, c.linkedinUrl), sep(), link(c.github, c.githubUrl), sep(), link(c.site, c.siteUrl)] }));
  children.push(sectionHeader("Professional Summary"));
  children.push(new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ size: 20, font: "Arial", text: data.summary })] }));
  children.push(sectionHeader("Technical Skills"));
  for (const [cat, items] of data.skills) children.push(skillRow(cat, items));
  if (cfg.resume.currentlyLearning) children.push(new Paragraph({ spacing: { before: 30, after: 30 }, children: [new TextRun({ text: cfg.resume.currentlyLearning, italics: true, size: 20, font: "Arial" })] }));
  children.push(sectionHeader("Professional Experience"));
  for (const co of data.experience) { children.push(orgLine(co.org, co.loc, co.dates)); for (const role of co.roles) { children.push(roleLine(role.title, role.dates)); for (const b of role.bullets) children.push(bullet(b)); } }
  children.push(sectionHeader("Projects"));
  for (const p of data.projects) { children.push(projectLine(p.name, p.linkText, p.linkUrl, p.dates)); for (const b of p.bullets) children.push(bullet(b)); }
  children.push(sectionHeader("Education"));
  for (const [school, rest, dates] of data.education) children.push(orgLine(school, rest, dates));
  const doc = new Document({
    numbering: { config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 200 } }, run: { size: 20, font: "Arial" } } }] }] },
    styles: { default: { document: { run: { font: "Arial", size: 20 } } } },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } }, children }],
  });
  const outPath = path.join(outDir, `DRAFT-Kris-Swodeck-Resume-${cfg.label}.docx`);
  return Packer.toBuffer(doc).then(buf => { fs.writeFileSync(outPath, buf); return outPath; });
}

// ---- cover-letter helpers (verbatim from build_cover_letters.js) ----
function cline(text, { size = 22, bold = false, after = 40 } = {}) { return new Paragraph({ spacing: { after }, children: [new TextRun({ text, size, bold, font: "Calibri" })] }); }
function cbody(text) { return new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text, size: 22, font: "Calibri" })] }); }
function plainRun(text) { return new TextRun({ text, size: 20, font: "Calibri" }); }
function clink(text, url) { return new ExternalHyperlink({ link: url, children: [new TextRun({ text, size: 20, font: "Calibri", color: "000000" })] }); }

// Hard style gate (from build_cover_letters.js). Throws -> that letter is skipped, not shipped broken.
function validateLetter(label, cover) {
  const paras = cover.paragraphs || [];
  const bodyText = paras.join(" ");
  const problems = [];
  if (paras.length !== 5) problems.push(`has ${paras.length} body paragraphs (must be 5)`);
  if (/to be candid/i.test(bodyText)) problems.push('uses banned phrase "To be candid"');
  if (paras.some(p => p.includes("—"))) problems.push("has an em dash in body prose");
  if (!/not a question mark/i.test(bodyText)) problems.push('missing closing line "...not a question mark"');
  if (problems.length) throw new Error(`[${label}] cover-letter style: ` + problems.join("; "));
}

function buildCoverLetter(cfg, outDir) {
  validateLetter(cfg.label, cfg.cover);
  const c = MASTER.contact;
  const children = [
    cline("Kris Swodeck", { size: 32, bold: true, after: 40 }),
    cline("Software Engineer / Front-End Web Developer", { after: 40 }),
    new Paragraph({ spacing: { after: 40 }, children: [plainRun(c.location + " | "), clink(c.phone, c.phoneUrl), plainRun(" | "), clink(c.email, c.emailUrl)] }),
    new Paragraph({ spacing: { after: 240 }, children: [clink(c.linkedin, c.linkedinUrl), plainRun(" | "), clink(c.github, c.githubUrl), plainRun(" | "), clink(c.site, c.siteUrl)] }),
    cline(cfg.date, { after: 240 }),
    cline(cfg.company, { after: 40 }),
    cline(cfg.cover.re, { after: 240 }),
    cbody("Dear Hiring Manager,"),
    ...cfg.cover.paragraphs.map(cbody),
    cline("Sincerely,", { after: 40 }),
    cline("Kris Swodeck", { after: 0 }),
  ];
  const doc = new Document({ styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1440, bottom: 1080, left: 1440 } } }, children }] });
  const outPath = path.join(outDir, `DRAFT-Kris-Swodeck-Cover-Letter-${cfg.label}.docx`);
  return Packer.toBuffer(doc).then(buf => { fs.writeFileSync(outPath, buf); return outPath; });
}

async function main() {
  const [, , configPath, outDir] = process.argv;
  if (!configPath || !outDir) { console.error("usage: node materials/build-cli.js <config.json> <outDir>"); process.exit(1); }
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  fs.mkdirSync(outDir, { recursive: true });
  const out = {};
  out.resume = await buildResume(cfg, outDir);
  out.cover = await buildCoverLetter(cfg, outDir);
  console.log(JSON.stringify(out)); // paths, for the caller to upload
}
main().catch(e => { console.error("BUILD ERROR: " + e.message); process.exit(1); });
