/**
 * Tasa del euro del BCV (misma logica que src/rate.js del servidor Node).
 */

var URL_BCV = 'https://www.bcv.org.ve/estadisticas/tipo-de-cambio-de-referencia-0';
var CARACAS_OFFSET = -4 * 60 * 60 * 1000;
var RATE_TTL_MS = 15 * 60 * 1000;

var _lastRateAttempt = 0;

function parseBcvPage(html) {
  var eur = html.match(/id="euro"[\s\S]{0,700}?strong-tb">\s*([0-9.,]+)/);
  if (!eur) return null;
  var raw = eur[1];
  var tasa;
  if (raw.indexOf(',') !== -1) tasa = Number(raw.replace(/\./g, '').replace(',', '.'));
  else tasa = Number(raw);
  if (!isFinite(tasa) || tasa <= 0) return null;

  var fecha = html.match(/Fecha Valor[\s\S]{0,300}?content="(\d{4}-\d{2}-\d{2})/);
  return { tasa: tasa, fechaValor: fecha ? fecha[1] : null };
}

function rateTs(x) { return x instanceof Date ? x.getTime() : Number(x); }
function caracas(now) { return new Date(rateTs(now) + CARACAS_OFFSET); }

function isMonday(fechaValor) {
  if (!fechaValor) return false;
  var d = new Date(fechaValor + 'T12:00:00Z');
  return d.getUTCDay() === 1;
}

function lastFriday17(now) {
  var s = caracas(now);
  var day = s.getUTCDay();
  var daysSinceFri = (day - 5 + 7) % 7;
  var startOfDay = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  var f17 = startOfDay - daysSinceFri * 86400000 + 17 * 3600000;
  if (rateTs(s) < f17) f17 -= 7 * 86400000;
  return f17 - CARACAS_OFFSET;
}

function selectRate(pubs, now) {
  var nowTs = rateTs(now);
  var avail = (pubs || [])
    .filter(function (p) { return p && p.tasa > 0 && p.firstSeen <= nowTs; })
    .sort(function (a, b) { return a.firstSeen - b.firstSeen; });
  if (!avail.length) return null;

  var latest = avail[avail.length - 1];
  var day = caracas(now).getUTCDay();

  if (day >= 2 && day <= 4) {
    return mergeRate(latest, 'vigente (martes a jueves)');
  }

  var pf = lastFriday17(now);
  var since = avail.filter(function (p) { return p.firstSeen >= pf; });
  var reverso = since.slice().reverse();
  var monday = null;
  for (var i = 0; i < reverso.length; i++) {
    if (isMonday(reverso[i].fechaValor)) { monday = reverso[i]; break; }
  }
  var chosen = monday || since[since.length - 1] || latest;
  var regla = monday
    ? 'tasa del lunes (publicada el viernes >= 5:00 p. m.)'
    : 'ultima tasa publicada por el BCV';
  return mergeRate(chosen, regla);
}

function mergeRate(base, regla) {
  var out = {};
  for (var k in base) out[k] = base[k];
  out.regla = regla;
  return out;
}

function refreshIfStale(force) {
  var now = Date.now();
  if (!force && now - _lastRateAttempt < RATE_TTL_MS) return false;
  _lastRateAttempt = now;

  var db = db();
  db.eur = db.eur || { pubs: [] };
  try {
    var res = UrlFetchApp.fetch(URL_BCV, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) throw new Error('HTTP ' + code);
    var parsed = parseBcvPage(res.getContentText());
    if (!parsed) throw new Error('No se pudo leer la tasa en la pagina del BCV');

    var pubs = db.eur.pubs;
    var ya = null;
    for (var i = 0; i < pubs.length; i++) {
      if (pubs[i].fechaValor === parsed.fechaValor && pubs[i].tasa === parsed.tasa) { ya = pubs[i]; break; }
    }
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

function getAppliedRate() {
  var db = db();
  db.eur = db.eur || { pubs: [] };
  var applied = selectRate(db.eur.pubs, Date.now());
  if (!applied) {
    refreshIfStale(true);
    applied = selectRate(db.eur.pubs, Date.now());
  } else {
    try { refreshIfStale(false); } catch (e) { /* noop */ }
  }
  return applied;
}
