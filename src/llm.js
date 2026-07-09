// LLM stage, two interchangeable transports (config: llm.transport):
//   "claude-cli"  -> spawns `claude -p` headless; auth = CLAUDE_CODE_OAUTH_TOKEN
//                    (from `claude setup-token`) or a local `claude` login.
//                    Uses your Claude Pro/Max SUBSCRIPTION — no API dollars.
//   "api"         -> direct Anthropic API; auth = ANTHROPIC_API_KEY (pay-as-you-go).
// Both stages are BATCHED (several jobs per call) to keep subscription-prompt
// counts and API cost low.
const { spawn } = require("child_process");
const { sleep } = require("./util");
const { SCREEN_SYSTEM, SCORE_SYSTEM, screenBatchUser, scoreBatchUser } = require("./rubric");

// $/M-token [input, output] estimates for the digest cost line (API transport only).
const PRICES = { "claude-haiku-4-5-20251001": [1, 5], "claude-sonnet-4-6": [3, 15] };
const usage = {};       // api transport: model -> {in, out}
let cliPrompts = 0;     // cli transport: subscription prompts used

// ---------- transport: claude CLI (subscription) ----------
function callCli(model, fullPrompt) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", fullPrompt, "--model", model, "--output-format", "text"], {
      stdio: ["ignore", "pipe", "pipe"], // close stdin: avoids the CLI's stdin wait
      timeout: 300000,
    });
    let out = "", err = "";
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("error", reject);
    child.on("close", code => {
      cliPrompts++;
      if (code === 0) resolve(out);
      else reject(new Error(`claude CLI exit ${code}: ${(err || out).slice(0, 300)}`));
    });
  });
}

// ---------- transport: direct API ----------
async function callApi(model, system, user, maxTokens) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(3000 * attempt * attempt);
    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
        signal: AbortSignal.timeout(180000),
      });
    } catch (e) { lastErr = e; continue; }
    if (res.status === 429 || res.status === 529 || res.status >= 500) { lastErr = new Error(`HTTP ${res.status}`); continue; }
    const data = await res.json();
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    const u = (usage[model] ??= { in: 0, out: 0 });
    u.in += data.usage?.input_tokens || 0;
    u.out += data.usage?.output_tokens || 0;
    return (data.content || []).map(b => b.text || "").join("");
  }
  throw new Error(`Anthropic API retries exhausted: ${lastErr?.message}`);
}

async function callLLM(cfg, tier, system, user, maxTokens) {
  if (cfg.llm.transport === "claude-cli") {
    // One retry on transient CLI failure.
    for (let attempt = 0; ; attempt++) {
      try { return await callCli(cfg.llm.cli_models[tier], system + "\n\n" + user); }
      catch (e) { if (attempt) throw e; await sleep(5000); }
    }
  }
  return callApi(cfg.llm.api_models[tier], system, user, maxTokens);
}

function parseJsonArrayLoose(text) {
  const t = String(text).replace(/```(?:json)?/gi, "").trim();
  const a = t.indexOf("["), b = t.lastIndexOf("]");
  if (a === -1 || b === -1) throw new Error("no JSON array in response");
  const arr = JSON.parse(t.slice(a, b + 1));
  if (!Array.isArray(arr)) throw new Error("response is not an array");
  return arr;
}

// Screen a chunk. Returns array of booleans aligned to jobs; on total failure,
// fails OPEN (all pass) — the scorer is the real gate and caps bound the cost.
async function screenBatch(jobs, cfg) {
  try {
    const out = await callLLM(cfg, "screen", SCREEN_SYSTEM, screenBatchUser(jobs), 1200);
    const arr = parseJsonArrayLoose(out);
    const byI = new Map(arr.map(x => [Number(x.i), !!x.pass]));
    return jobs.map((_, k) => byI.has(k + 1) ? byI.get(k + 1) : true);
  } catch (e) {
    console.log(`  screen batch failed (${e.message}) — passing ${jobs.length} through`);
    return jobs.map(() => true);
  }
}

// Score a chunk. Returns array aligned to jobs: scorecard object or null (null =
// couldn't score; caller defers the job to a future run).
async function scoreBatch(jobs, cfg) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await callLLM(cfg, "score", SCORE_SYSTEM, scoreBatchUser(jobs), 4000);
      const arr = parseJsonArrayLoose(out);
      const byI = new Map(arr.map(x => [Number(x.i), x]));
      return jobs.map((_, k) => {
        const j = byI.get(k + 1);
        if (!j || typeof j.score !== "number" || !j.verdict) return null;
        j.score = Math.max(0, Math.min(100, Math.round(j.score)));
        for (const f of ["strengths", "red_flags", "deductions", "tailoring_tips", "ats_keywords"])
          if (!Array.isArray(j[f])) j[f] = [];
        delete j.i;
        return j;
      });
    } catch (e) {
      if (attempt) {
        console.log(`  score batch failed twice (${e.message}) — deferring ${jobs.length} jobs`);
        return jobs.map(() => null);
      }
      await sleep(4000);
    }
  }
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function costSummary(cfg) {
  if (cfg.llm.transport === "claude-cli") {
    return { total: 0, subscription: true, detail: `${cliPrompts} subscription prompts (Claude Code)` };
  }
  let total = 0;
  const parts = [];
  for (const [model, u] of Object.entries(usage)) {
    const [pi, po] = PRICES[model] || [3, 15];
    total += (u.in / 1e6) * pi + (u.out / 1e6) * po;
    parts.push(`${model}: ${u.in}in/${u.out}out`);
  }
  return { total, subscription: false, detail: parts.join(", ") };
}

module.exports = { screenBatch, scoreBatch, chunk, costSummary };
