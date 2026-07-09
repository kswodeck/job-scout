// Upload draft materials to a Google Drive folder from CI — zero-dependency.
//
// CI has no interactive Google login, so this authenticates as a Google service
// account: sign a short-lived JWT with the SA private key (Node crypto, RS256),
// exchange it for an access token, then multipart-upload the file. The SA's JSON
// key lives in the GOOGLE_SERVICE_ACCOUNT_JSON secret; the target Drive folder must
// be shared with the SA's client_email as Editor.
const crypto = require("crypto");

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Mint an OAuth access token for the service account.
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claim}`;
  const signature = b64url(crypto.createSign("RSA-SHA256").update(signingInput).sign(sa.private_key));
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`token exchange failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data.access_token;
}

// Multipart-upload one file into a Drive folder. Returns the created file's id + link.
async function uploadFile(token, folderId, filePath, name, mimeType) {
  const fs = require("fs");
  const bytes = fs.readFileSync(filePath);
  const boundary = "jobscout" + b64url(crypto.randomBytes(12));
  const meta = JSON.stringify({ name, parents: [folderId] });
  const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const post = `\r\n--${boundary}--`;
  const body = Buffer.concat([Buffer.from(pre, "utf8"), bytes, Buffer.from(post, "utf8")]);

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` },
    body,
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json();
  if (!res.ok || !data.id) throw new Error(`upload failed: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return { id: data.id, link: data.webViewLink };
}

// Parse the SA secret. Returns null (feature no-ops) if unset/invalid.
function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    if (!sa.client_email || !sa.private_key) return null;
    return sa;
  } catch { return null; }
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

module.exports = { getAccessToken, uploadFile, loadServiceAccount, DOCX_MIME };
