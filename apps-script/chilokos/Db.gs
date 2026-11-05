/**
 * Base de datos en Google Apps Script (sin permisos de Google).
 *
 * Usa PropertiesService (almacenamiento propio del script) troceado en
 * bloques de 8 KB, con CacheService para lecturas rápidas. No usa Drive ni
 * UrlFetchApp, por lo que el web app queda accesible para cualquiera sin
 * pasar por la pantalla de autorización de Google.
 */

var DB_VERSION = 2;
var DB_PREFIX = 'CHILOKOS_DB_';
var DB_CHUNKS_KEY = 'CHILOKOS_DB_CHUNKS';
var DB_CACHE_KEY = 'chilokos_db_cache_v2';
var DB_CACHE_MAX = 95000;    // límite seguro de CacheService (~100 KB por clave)
var DB_CHUNK_SIZE = 8000;    // límite por propiedad del script (~9 KB)
var DB_MAX_BYTES = 430000;   // límite total de PropertiesService (~500 KB)

var _dbCache = null;
var _dirty = false;

var ROLE_RANK = { cliente: 1, mesero: 2, cocinero: 2, cajero: 3, encargado: 4, dueno: 5 };

// Carta de Chilokos: [categoria, nombre, precio (EUR), emoji, descripcion]
var MENUS = [
  ['Tacos', 'Taco al pastor', 3.9, '🌮', 'Cerdo adobado, piña, cilantro y cebolla'],
  ['Tacos', 'Taco de birria', 4.2, '🥩', 'Birria de res deshebrada con consomé para mojar'],
  ['Tacos', 'Taco de suadero', 4.0, '🥩', 'Suadero dorado con salsa verde y cebolla'],
  ['Tacos', 'Taco de pollo', 3.7, '🍗', 'Pollo a la plancha, pico de gallo y limón'],
  ['Tacos', 'Taco de costilla', 4.5, '🍖', 'Costilla de cerdo en salsa roja tatemada'],
  ['Flautas', 'Flautas de pollo (3 pz)', 6.5, '🌯', 'Tortilla frita, pollo, crema, queso fresco y salsa'],
  ['Flautas', 'Flautas de birria (3 pz)', 7.2, '🌯', 'Rellenas de birria, bañadas en consomé'],
  ['Flautas', 'Flautas de papa (3 pz)', 5.5, '🥔', 'Papa con queso, lechuga y crema (sin carne)'],
  ['Burritos', 'Burrito de birria', 8.5, '🌯', 'Birria, arroz, frijoles, queso y consomé aparte'],
  ['Burritos', 'Burrito de pollo', 7.5, '🌯', 'Pollo, arroz, frijoles y pico de gallo'],
  ['Burritos', 'Burrito vegetariano', 6.9, '🥬', 'Frijoles, arroz, elote, queso y guacamole'],
  ['Birria', 'Ramen de birria', 9.9, '🍜', 'Caldo de birria, fideos ramen, cebolla, cilantro y limón'],
  ['Birria', 'Quesabirria', 5.5, '🧀', 'Tortilla dorada con queso fundido y birria'],
  ['Birria', 'Consomé de birria', 4.5, '🍲', 'Caldo concentrado con cebolla, cilantro y limón'],
  ['Birria', 'Birria en su jugo (350 g)', 11.9, '🥘', 'Res cocida lento con tortillas y salsa'],
  ['Enchiladas', 'Enchiladas rojas (3 pz)', 7.9, '🌶️', 'Rellenas de pollo, salsa roja, crema y queso'],
  ['Enchiladas', 'Enchiladas verdes (3 pz)', 7.9, '🍅', 'Salsa verde de tomatillo, pollo y queso fresco'],
  ['Enchiladas', 'Enchiladas de mole (3 pz)', 8.2, '🍫', 'Mole poblano, ajonjolí y cebolla'],
  ['Antojitos', 'Elote en vaso', 4.0, '🌽', 'Granos de elote, mayonesa, queso y chile piquín'],
  ['Antojitos', 'Nachos con queso', 5.5, '🧀', 'Totopos con cheddar fundido y jalapeños'],
  ['Antojitos', 'Guacamole con totopos', 4.8, '🥑', 'Aguacate fresco, cilantro y limón'],
  ['Antojitos', 'Gomitas enchiladas', 3.5, '🍬', 'Gomitas de tamarindo con chile (bolsita)'],
  ['Bebidas', 'Agua de horchata', 3.0, '🥛', 'Horchata de arroz con canela y vainilla'],
  ['Bebidas', 'Agua de jamaica', 3.0, '🌺', 'Jamaica fría con un toque de azúcar'],
  ['Bebidas', 'Limonada de la casa', 3.2, '🍋', 'Limonada fresca con hierbabuena'],
  ['Bebidas', 'Refresco 355 ml', 2.2, '🥤', 'Coca-Cola, Sprite o Fanta'],
  ['Bebidas', 'Café de olla', 2.8, '☕', 'Café con canela y piloncillo'],
  ['Postres', 'Churros con cajeta', 4.5, '🥨', 'Churros calientitos con cajeta'],
  ['Postres', 'Flan casero', 4.5, '🍮', 'Flan de caramelo con nata'],
];

function uid(prefix) {
  prefix = prefix || '';
  return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function carta() {
  return MENUS.map(function (m) {
    return {
      id: uid('m_'), category: m[0], name: m[1], price: m[2],
      emoji: m[3], description: m[4], available: true,
    };
  });
}

function seed() {
  var now = Date.now();
  var users = [
    { id: uid('u_'), username: 'dueno', password: '1234', name: 'Dueño Chilokos', role: 'dueno', active: true },
    { id: uid('u_'), username: 'encargado', password: '1234', name: 'Ana Encargada', role: 'encargado', active: true },
    { id: uid('u_'), username: 'mesero', password: '1234', name: 'Carlos Mesero', role: 'mesero', active: true },
    { id: uid('u_'), username: 'cocina', password: '1234', name: 'Chef Roberto', role: 'cocinero', active: true },
    { id: uid('u_'), username: 'caja', password: '1234', name: 'Lucía Cajero', role: 'cajero', active: true },
  ];

  var tables = [];
  for (var i = 1; i <= 10; i++) {
    tables.push({ id: 'mesa-' + i, number: i, seats: i <= 6 ? 4 : 6, status: 'libre' });
  }

  return {
    version: DB_VERSION,
    users: users,
    menu: carta(),
    tables: tables,
    orders: [],
    notifications: [],
    sessions: {},
    counters: { order: 1 },
    createdAt: now,
  };
}

/* ---------------- Lectura / escritura troceada ---------------- */
function readDbRaw_() {
  var cache = CacheService.getScriptCache();
  try {
    var cached = cache.get(DB_CACHE_KEY);
    if (cached) return cached;
  } catch (e) { /* cache opcional */ }

  var props = PropertiesService.getScriptProperties().getProperties();
  var total = Number(props[DB_CHUNKS_KEY] || 0);
  if (!total) return null;
  var partes = [];
  for (var i = 0; i < total; i++) {
    var trozo = props[DB_PREFIX + i];
    if (trozo == null) return null;
    partes.push(trozo);
  }
  return partes.join('');
}

function writeDbRaw_(json) {
  var propsService = PropertiesService.getScriptProperties();
  var prevTotal = Number(propsService.getProperty(DB_CHUNKS_KEY) || 0);
  var trozos = [];
  for (var i = 0; i < json.length; i += DB_CHUNK_SIZE) {
    trozos.push(json.slice(i, i + DB_CHUNK_SIZE));
  }
  var valores = {};
  for (var j = 0; j < trozos.length; j++) {
    valores[DB_PREFIX + j] = trozos[j];
  }
  valores[DB_CHUNKS_KEY] = String(trozos.length);
  propsService.setProperties(valores, false);
  if (prevTotal > trozos.length) {
    var sobrantes = [];
    for (var k = trozos.length; k < prevTotal; k++) sobrantes.push(DB_PREFIX + k);
    propsService.deleteProperties(sobrantes);
  }
  try {
    if (json.length < DB_CACHE_MAX) {
      CacheService.getScriptCache().put(DB_CACHE_KEY, json, 21600);
    } else {
      CacheService.getScriptCache().remove(DB_CACHE_KEY);
    }
  } catch (e) { /* la cache es opcional */ }
}

function loadDb_() {
  if (_dbCache) return _dbCache;

  var db = null;
  var raw = readDbRaw_();
  if (raw) {
    try { db = JSON.parse(raw); } catch (e) { db = null; }
  }
  if (!db) {
    db = seed();
    _dirty = true;
  }

  db.notifications = db.notifications || [];
  db.sessions = db.sessions || {};
  db.counters = db.counters || { order: 1 };
  if (!db.version || db.version < DB_VERSION) {
    db.menu = carta();
    db.version = DB_VERSION;
    _dirty = true;
  }
  if (!db.users || !db.users.length) {
    db = seed();
    _dirty = true;
  }

  _dbCache = db;
  return db;
}

function db() { return loadDb_(); }

function save() { _dirty = true; }

function isDirty_() { return _dirty; }

/**
 * Si la base crece demasiado, elimina los pedidos cerrados más antiguos.
 * Devuelve true si hubo recorte.
 */
function shrinkDb_(db) {
  var cerrados = db.orders
    .filter(function (o) { return o.status === 'pagado' || o.status === 'cancelado'; })
    .sort(function (a, b) { return a.createdAt - b.createdAt; });

  var recortado = false;
  while (cerrados.length && JSON.stringify(db).length > DB_MAX_BYTES) {
    var viejo = cerrados.shift();
    var idx = db.orders.indexOf(viejo);
    if (idx !== -1) { db.orders.splice(idx, 1); recortado = true; }
  }
  return recortado;
}

function commitDb_() {
  var db = _dbCache || loadDb_();
  var json = JSON.stringify(db);

  if (json.length > DB_MAX_BYTES) {
    shrinkDb_(db);
    json = JSON.stringify(db);
  }

  try {
    writeDbRaw_(json);
  } catch (e) {
    // Cuota llena: recorta pedidos viejos y reintenta una vez.
    shrinkDb_(db);
    json = JSON.stringify(db);
    try {
      writeDbRaw_(json);
    } catch (e2) {
      return; // se reintenta en la próxima petición
    }
  }
  _dirty = false;
}

/* ---------------- Higiene de datos ---------------- */
function pruneIfNeeded_() {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty('LAST_PRUNE') || 0);
  var now = Date.now();
  if (now - last < 60 * 60 * 1000) return;

  var db = loadDb_();
  var cambiado = false;
  for (var token in db.sessions) {
    if (now - (db.sessions[token].createdAt || 0) > SESSION_TTL) {
      delete db.sessions[token];
      cambiado = true;
    }
  }
  var vigentes = db.notifications.filter(function (n) { return now - n.createdAt <= SESSION_TTL; });
  if (vigentes.length !== db.notifications.length) {
    db.notifications = vigentes;
    cambiado = true;
  }
  if (cambiado) _dirty = true;
  props.setProperty('LAST_PRUNE', String(now));
}
