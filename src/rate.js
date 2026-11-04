/* ============================================================
   Tasa del euro del BCV (Banco Central de Venezuela)

   Regla de negocio pedida:
   - viernes, sábado, domingo y lunes → se usa "la tasa del día
     lunes", que el BCV publica los viernes después de las 5:00 p.m.
   - martes, miércoles y jueves → se usa la tasa vigente que
     publique el BCV en esos días.

   La página del BCV trae el valor del euro (div#euro) y la
   "Fecha Valor" de la publicación (p. ej. 2026-10-19 = lunes).
   Guardamos cada publicación observada con su primera detección
   para poder aplicar la regla aunque el servidor se apague.
   ============================================================ */

const URL_BCV = 'https://www.bcv.org.ve/estadisticas/tipo-de-cambio-de-referencia-0';
const CARACAS_OFFSET = -4 * 60 * 60 * 1000; // Venezuela = UTC-4 fijo (sin DST)
const TTL_MS = 15 * 60 * 1000;              // reintentar consulta cada 15 min

/* ---------- Parseo de la página del BCV ---------- */
function parseBcvPage(html) {
  const eur = html.match(/id="euro"[\s\S]{0,700}?strong-tb">\s*([0-9.,]+)/);
  if (!eur) return null;
  const raw = eur[1];
  // Formato BCV: "991,16445734" (coma decimal) o "1.234,56"
  let tasa;
  if (raw.includes(',')) tasa = Number(raw.replace(/\./g, '').replace(',', '.'));
  else tasa = Number(raw);
  if (!isFinite(tasa) || tasa <= 0) return null;

  const fecha = html.match(/Fecha Valor[\s\S]{0,300}?content="(\d{4}-\d{2}-\d{2})/);
  return { tasa, fechaValor: fecha ? fecha[1] : null };
}

/* ---------- Utilidades de hora (Caracas) ---------- */
const ts = x => (x instanceof Date ? x.getTime() : Number(x)); // acepta Date o timestamp
function caracas(now) { return new Date(ts(now) + CARACAS_OFFSET); }

function isMonday(fechaValor) {
  if (!fechaValor) return false;
  const d = new Date(fechaValor + 'T12:00:00Z');
  return d.getUTCDay() === 1;
}

// Instante real del último viernes 5:00 p.m. (hora de Caracas) <= now
function lastFriday17(now) {
  const s = caracas(now);
  const day = s.getUTCDay();                       // 0=dom … 6=sáb
  const daysSinceFri = (day - 5 + 7) % 7;          // vie=0, sáb=1, dom=2, lun=3, mar=4, mié=5, jue=6
  const startOfDay = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  let f17 = startOfDay - daysSinceFri * 86400000 + 17 * 3600000;
  if (ts(s) < f17) f17 -= 7 * 86400000;            // viernes antes de las 5 p.m. → usar el viernes previo
  return f17 - CARACAS_OFFSET;
}

/* ---------- Selección de la tasa aplicable ---------- */
function selectRate(pubs, now) {
  const nowTs = ts(now);
  const avail = (pubs || [])
    .filter(p => p && p.tasa > 0 && p.firstSeen <= nowTs)
    .sort((a, b) => a.firstSeen - b.firstSeen);
  if (!avail.length) return null;

  const latest = avail[avail.length - 1];
  const day = caracas(now).getUTCDay();

  // martes(2), miércoles(3), jueves(4) → tasa vigente
  if (day >= 2 && day <= 4) {
    return { ...latest, regla: 'vigente (martes a jueves)' };
  }

  // viernes(5), sábado(6), domingo(0), lunes(1) → "tasa del lunes"
  const pf = lastFriday17(now);
  const since = avail.filter(p => p.firstSeen >= pf);
  const reverso = [...since].reverse();
  const monday = reverso.find(p => isMonday(p.fechaValor));
  const chosen = monday || since[since.length - 1] || latest;
  const regla = monday
    ? 'tasa del lunes (publicada el viernes ≥ 5:00 p. m.)'
    : 'última tasa publicada por el BCV';
  return { ...chosen, regla };
}

/* ---------- Servicio: consulta y caché ---------- */
let lastAttempt = 0;

async function refreshIfStale(db, save, force = false) {
  const now = Date.now();
  if (!force && now - lastAttempt < TTL_MS) return false;
  lastAttempt = now;
  db.eur = db.eur || { pubs: [] };
  try {
    const res = await fetch(URL_BCV, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const parsed = parseBcvPage(await res.text());
    if (!parsed) throw new Error('No se pudo leer la tasa en la página del BCV');
    const pubs = db.eur.pubs;
    const ya = pubs.find(p => p.fechaValor === parsed.fechaValor && p.tasa === parsed.tasa);
    if (ya) {
      ya.lastSeen = now;
    } else {
      pubs.push({ tasa: parsed.tasa, fechaValor: parsed.fechaValor, firstSeen: now, lastSeen: now });
      if (pubs.length > 60) pubs.splice(0, pubs.length - 60);
    }
    db.eur.lastOk = now;
    db.eur.lastError = null;
    save();
    return true;
  } catch (e) {
    db.eur.lastError = String((e && e.message) || e);
    save();
    return false;
  }
}

// Devuelve la tasa aplicable según el día; usa caché y refresca en segundo plano
async function getApplied(db, save) {
  db.eur = db.eur || { pubs: [] };
  let applied = selectRate(db.eur.pubs, Date.now());
  if (!applied) {
    await refreshIfStale(db, save, true);          // primera vez: esperar la consulta
    applied = selectRate(db.eur.pubs, Date.now());
  } else {
    refreshIfStale(db, save).catch(() => {});       // el resto: refresco sin bloquear
  }
  return applied;
}

module.exports = { parseBcvPage, selectRate, lastFriday17, refreshIfStale, getApplied, URL_BCV };
