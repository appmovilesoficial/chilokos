/**
 * Chilokos - API en la nube (Google Apps Script)
 *
 * Este proyecto reemplaza al servidor Node (server.js) cuando la app se
 * publica en GitHub Pages. Guarda la base de datos en un archivo JSON de
 * Google Drive del dueño y expone los mismos endpoints que server.js.
 */

// URL publica del frontend (GitHub Pages). Se usa para los codigos QR.
var SITE_URL = 'https://appmovilesoficial.github.io/chilokos';

var SESSION_TTL = 24 * 60 * 60 * 1000;

/* ---------------- Router minimo (estilo Express) ---------------- */
var ROUTES = [];

function apiRoute_(method, path, handlers) {
  ROUTES.push({ method: method, path: path, handlers: handlers });
}

function matchPath_(pattern, actual) {
  var p = pattern.split('/');
  var a = actual.split('/');
  if (p.length !== a.length) return null;
  var params = {};
  for (var i = 0; i < p.length; i++) {
    if (p[i].charAt(0) === ':') {
      params[p[i].slice(1)] = decodeURIComponent(a[i] || '');
    } else if (p[i] !== a[i]) {
      return null;
    }
  }
  return params;
}

function makeRes_() {
  var res = { statusCode: 200, sent: false, body: null };
  res.status = function (code) { res.statusCode = code; return res; };
  res.json = function (obj) { res.body = obj; res.sent = true; return res; };
  return res;
}

function runChain_(chain, req, res) {
  var i = 0;
  function next() {
    if (res.sent) return;
    while (i < chain.length) {
      var h = chain[i++];
      var advanced = false;
      h(req, res, function () { advanced = true; next(); });
      if (res.sent || advanced) return;
    }
  }
  next();
}

/* ---------------- Entrada HTTP ---------------- */
function doGet(e) { return handleRequest_(e); }
function doPost(e) { return handleRequest_(e); }

function handleRequest_(e) {
  var result;
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(25000);
    if (!locked) {
      result = { __status: 503, error: 'El servicio esta ocupado, intenta de nuevo' };
    } else {
      result = process_(e);
      if (isDirty_()) commitDb_();
    }
  } catch (err) {
    result = { __status: 500, error: String((err && err.message) || err) };
  } finally {
    if (locked) lock.releaseLock();
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function process_(e) {
  var params = (e && e.parameter) || {};
  var method = String(params._method || (e && e.postData ? 'POST' : 'GET')).toUpperCase();
  var path = params.path || '/api';
  var body = {};
  if (e && e.postData && e.postData.contents) {
    try { body = JSON.parse(e.postData.contents); } catch (x) { body = {}; }
  }

  var route = null;
  var routeParams = null;
  for (var i = 0; i < ROUTES.length; i++) {
    if (ROUTES[i].method !== method) continue;
    var m = matchPath_(ROUTES[i].path, path);
    if (m) { route = ROUTES[i]; routeParams = m; break; }
  }
  if (!route) return { __status: 404, error: 'Ruta no encontrada: ' + method + ' ' + path };

  var req = {
    method: method,
    path: path,
    params: routeParams,
    query: params,
    body: body,
    headers: { authorization: params.token ? 'Bearer ' + params.token : '' },
    protocol: 'https',
    get: function () { return 'script.google.com'; },
  };

  pruneIfNeeded_();

  var res = makeRes_();
  runChain_(route.handlers, req, res);

  if (!res.sent) return { __status: 204 };
  var out = res.body;
  if (res.statusCode !== 200) {
    if (out && typeof out === 'object' && !Array.isArray(out)) {
      out.__status = res.statusCode;
    } else {
      out = { __status: res.statusCode, data: out };
    }
  }
  return out;
}

/* ---------------- Registro de rutas ---------------- */
function registerRoutes_() {
  // La definicion completa esta en Api.gs
}
