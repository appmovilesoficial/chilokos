// Crea un proyecto de Apps Script COMO CONTENEDOR DEL Sheet indicado (script ligado),
// usando la sesión OAuth de clasp, y escribe apps-script/.clasp.json.
const fs = require('fs');
const path = require('path');

const SHEET_ID = process.env.SHEET_ID || '1aFfEMXTfjkql9zOQATGJ7mFKzqAOwnS-fFej8uRoxMo';
const TITULO = process.env.SCRIPT_TITLE || 'Chilokos · Base de datos';
const rcPath = path.join(process.env.USERPROFILE || process.env.HOME, '.clasprc.json');
const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
const t = (rc.tokens && rc.tokens.default) || rc;

async function token() {
  if (t.access_token && t.expiry_date && t.expiry_date > Date.now() + 60000) return t.access_token;
  const body = new URLSearchParams({
    client_id: t.client_id, client_secret: t.client_secret,
    refresh_token: t.refresh_token, grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const j = await r.json();
  if (!r.ok) throw new Error('refresh falló: ' + (j.error_description || j.error));
  return j.access_token;
}

(async () => {
  const at = await token();
  const r = await fetch('https://script.googleapis.com/v1/projects', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: TITULO, parentId: SHEET_ID }),
  });
  const txt = await r.text();
  if (!r.ok) {
    console.log('HTTP ' + r.status + '\n' + txt.slice(0, 900));
    process.exit(1);
  }
  const j = JSON.parse(txt);
  const dir = path.join(__dirname, '..', 'apps-script');
  fs.writeFileSync(path.join(dir, '.clasp.json'), JSON.stringify({ scriptId: j.scriptId, rootDir: '.' }, null, 2));
  console.log('scriptId:', j.scriptId, '| titulo:', j.title);
  console.log('.clasp.json escrito en apps-script/');
})();
