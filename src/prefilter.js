// Stage 1: free local filter. Errs toward passing — the cheap Haiku screen
// (stage 2) and the Sonnet rubric (stage 3) do the real judging.

const TITLE_POS = /(front[\s-]?end|\bweb\s+(developer|engineer)\b|javascript|typescript|\bvue\b|\bnuxt\b|\breact\b(?!\s*native)|next\.?js|\bui\s+(engineer|developer)\b|software\s+(engineer|developer)|web\s+application)/i;

const TITLE_NEG = /(sdet|\bqa\b|quality\s+(assurance|engineer)|test\s+(engineer|automation)|\.net\b|\bc#|c\+\+|\bgolang\b|\bgo\s+(developer|engineer)\b|full[\s-]?stack|back[\s-]?end|server[\s-]?side|forward[\s-]?deployed|\bandroid\b|\bios\b|mobile\s+(engineer|developer)|react\s+native|flutter|data\s+(engineer|scientist|analyst)|analytics\s+engineer|devops|\bsre\b|site\s+reliability|infrastructure\s+engineer|security\s+engineer|machine\s+learning|\bml\s+engineer|\bembedded\b|firmware|salesforce|servicenow|\bsap\b|drupal|magento|\bphp\b|ruby\s+on\s+rails|\brails\b|django|\bjava\s+(developer|engineer)\b|kotlin|\bswift\b|blockchain|solidity|\bunity\b|unreal|game\s+developer|wordpress\s+developer|dynamics\s+365|\bror\b|\bruby\b|\belixir\b|\brust\b|\bscala\b|\bclojure\b|\bhaskell\b|\berlang\b|\bdatabricks\b|python\s+(developer|engineer))/i;

// Non-IC roles are out; principal/staff/architect are left to the LLM (seniority
// alignment is a scored rubric dimension, not a hard kill).
const NON_IC = /\b(engineering\s+manager|director|head\s+of|vp\b|vice\s+president|chief\b|cto\b)\b/i;

// Seniority targeting: Kris targets Mid/Senior IC. Principal and Staff sit above
// that band; "Founding" engineer roles (earliest-stage, equity-heavy, over-scoped)
// are out. Plain/unmarked titles (e.g. "Software Engineer", "Senior Frontend
// Engineer") are kept.
const SENIORITY_EXCL = /\b(principal|staff|founding)\b/i;

const US_HINTS = /(usa|u\.s\.|united states|us[\s-]?only|us[\s-]?based|north america|americas|worldwide|anywhere|global|dallas|fort worth|dfw|texas|\bremote\b)/i;
const NON_US_ONLY = /(europe|emea|\buk\b|united kingdom|\bcanada\b|latam|apac|\basia\b|india|germany|poland|spain|portugal|france|netherlands|philippines|brazil|mexico|argentina|colombia|australia|nigeria|kenya|pakistan|ukraine|romania|vietnam|indonesia|egypt|south africa|\bcet\b|\beet\b)/i;

const IS_REMOTE = /\bremote\b|work from home|\bwfh\b|distributed|anywhere/i;
// DFW metroplex — within ~45 miles of Arlington, TX (Kris's home base). Ambiguous
// names (Arlington, Allen) require a TX qualifier so Arlington VA / Allen elsewhere
// don't match.
const DFW_AREA = /(dallas|fort worth|ft\.? worth|\bdfw\b|metroplex|arlington,?\s*(tx|texas)|irving|plano|frisco|mckinney|garland|grand prairie|mesquite|carrollton|richardson|lewisville|flower mound|mansfield|euless|bedford|\bhurst\b|grapevine|southlake|coppell|keller|colleyville|cedar hill|desoto|rowlett|the colony|addison|farmers branch|denton|allen,?\s*(tx|texas))/i;
const HYBRID_OR_ONSITE = /hybrid|on-?site|on site|in-?office|in office|in-?person|days?\s*(a|per)?\s*week|\d\s*days?\s*in/i;
// Specific non-DFW locations that make a hybrid/on-site (or non-remote) role a dealbreaker.
const NON_DFW_CITY = /(new[\s-]?york|nyc|manhattan|brooklyn|san francisco|bay area|silicon valley|seattle|boston|cambridge|chicago|atlanta|los angeles|san diego|san jose|austin|houston|san antonio|denver|boulder|miami|orlando|tampa|philadelphia|pittsburgh|washington|arlington,?\s*va|baltimore|portland|salt lake|phoenix|scottsdale|minneapolis|detroit|nashville|charlotte|raleigh|durham|columbus|indianapolis|kansas city|st\.? louis|new orleans|las vegas|sacramento|london|toronto|vancouver|montreal|berlin|amsterdam|bengaluru|bangalore)/i;

// HN comments that scope remote to a non-US region.
const HN_REGION_EXCL = /remote\s*\(?\s*(emea|europe|uk|canada|latam|apac|india|asia)\b|europe[\s-]?only|uk[\s-]?only|canada[\s-]?only|emea[\s-]?only/i;

// Location gate: remote (US) OR within ~45 miles of Arlington, TX. Hybrid/on-site
// counts as in-office, so a hybrid/on-site role tied to anywhere outside DFW is out.
function locationOk(loc) {
  const hay = String(loc || "");
  if (NON_US_ONLY.test(hay) && !US_HINTS.test(hay)) return false;   // non-US only
  if (DFW_AREA.test(hay)) return true;                              // DFW / ~45mi Arlington
  const remote = IS_REMOTE.test(hay), hybrid = HYBRID_OR_ONSITE.test(hay), city = NON_DFW_CITY.test(hay);
  if (city && (hybrid || !remote)) return false;                   // location-tied hybrid/on-site elsewhere
  if (remote) return true;                                         // remote, US-viable
  if (!hay.trim()) return true;                                    // unknown -> let the LLM judge
  if (hybrid) return false;                                        // generic hybrid/on-site, not DFW
  return true;
}

// Conservative annual-salary ceiling check on free-text salary strings.
// Skips hourly/daily/weekly rates; only drops when a clearly-annual max < $80k.
function salaryTextBelowFloor(salary) {
  if (!salary || /hour|\/hr|\bhr\b|day|week/i.test(salary)) return false;
  const nums = [...salary.matchAll(/\$?\s?(\d{2,3})\s?k\b|\$\s?(\d{2,3},\d{3})/gi)]
    .map(m => m[1] ? Number(m[1]) * 1000 : Number(m[2].replace(/,/g, "")));
  if (!nums.length) return false;
  return Math.max(...nums) < 80000;
}

function passes(job, cfg) {
  const title = job.title || "";
  if (!title.trim()) return { pass: false, reason: "no title" };

  if (job.hnMode) {
    // HN: role keywords can live anywhere in the post, and NEG can't apply to the
    // whole text (posts list many roles). Require FE-ish keywords + US-viable remote.
    if (!TITLE_POS.test(job.text)) return { pass: false, reason: "hn: no FE/JS keywords" };
    if (!/remote/i.test(job.text) && !/dallas|fort worth|dfw/i.test(job.text)) return { pass: false, reason: "hn: not remote/DFW" };
    if (HN_REGION_EXCL.test(job.text)) return { pass: false, reason: "hn: remote scoped outside US" };
    if (NON_IC.test(title)) return { pass: false, reason: "non-IC title" };
    // HN title is a best-effort guess, so these apply to the guessed role only.
    if (SENIORITY_EXCL.test(title)) return { pass: false, reason: "seniority: principal/staff/founding" };
    if (/full[\s-]?stack|back[\s-]?end|forward[\s-]?deployed/i.test(title)) return { pass: false, reason: "hn: full-stack/back-end/forward-deployed" };
    // Drop informal posts with no way to apply (no link, no email — just a reply field).
    if (!/https?:\/\//i.test(job.text) && !/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(job.text)) return { pass: false, reason: "hn: no apply link" };
    return { pass: true };
  }

  if (!TITLE_POS.test(title)) return { pass: false, reason: "title: not FE/JS/SWE" };
  if (TITLE_NEG.test(title)) return { pass: false, reason: "title: excluded specialty" };
  if (NON_IC.test(title)) return { pass: false, reason: "non-IC title" };
  if (SENIORITY_EXCL.test(title)) return { pass: false, reason: "seniority: principal/staff/founding" };
  // Location gate (remote-US or DFW/~45mi Arlington; hybrid/on-site elsewhere out).
  // Fold the ATS isRemote flag into the haystack so a remote-flagged board posting
  // isn't dropped for naming an office city.
  const locHay = (job.isRemoteFlag ? "remote " : "") + (job.location || "");
  if (!locationOk(locHay)) return { pass: false, reason: `location: ${job.location || "?"}` };

  if (job.salaryMax > 0 && job.salaryMax >= 30000 && job.salaryMax < 80000)
    return { pass: false, reason: `salary max $${job.salaryMax} below floor` };
  if (salaryTextBelowFloor(job.salary))
    return { pass: false, reason: `salary "${job.salary}" below floor` };

  return { pass: true };
}

function isStarred(job, cfg) {
  const hay = `${job.title}\n${job.text.slice(0, 3000)}`.toLowerCase();
  return (cfg.star_keywords || []).filter(k => hay.includes(k.toLowerCase()));
}

module.exports = { passes, isStarred, TITLE_POS };
