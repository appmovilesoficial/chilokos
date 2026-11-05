/**
 * Base de datos en Google Drive (un archivo JSON del dueño del script).
 * Los datos se leen de CacheService cuando es posible para responder rapido.
 */

var DB_VERSION = 2;
var DB_FILE_NAME = 'chilokos-db.json';
var DB_PROP_ID = 'CHILOKOS_DB_FILE_ID';
var DB_CACHE_KEY = 'chilokos_db_cache_v1';
var DB_CACHE_MAX = 95000;   // limite seguro de CacheService (~100 KB por clave)

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
    eur: { pubs: [] },
    createdAt: now,
  };
}

/* ---------------- Archivo en Drive ---------------- */
function dbFile_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(DB_PROP_ID);
  if (id) {
    try { return DriveApp.getFileById(id); } catch (e) { /* se recrea abajo */ }
  }
  var found = DriveApp.getFilesByName(DB_FILE_NAME);
  if (found.hasNext()) {
    var f = found.next();
    props.setProperty(DB_PROP_ID, f.getId());
    return f;
  }
  var nuevo = seed();
  var file = DriveApp.createFile(DB_FILE_NAME, JSON.stringify(nuevo), MimeType.PLAIN_TEXT);
  props.setProperty(DB_PROP_ID, file.getId());
  return file;
}

function loadDb_() {
  if (_dbCache) return _dbCache;

  var cache = CacheService.getScriptCache();
  var raw = cache.get(DB_CACHE_KEY);
  var db = null;

  if (raw) {
    try { db = JSON.parse(raw); } catch (e) { db = null; }
  }
  if (!db) {
    var file = dbFile_();
    var txt = file.getBlob().getDataAsString();
    try { db = JSON.parse(txt); } catch (e) { db = null; }
  }

  if (!db) {
    db = seed();
    _dirty = true;
  }

  db.notifications = db.notifications || [];
  db.sessions = db.sessions || {};
  db.counters = db.counters || { order: 1 };
  db.eur = db.eur || { pubs: [] };
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

function commitDb_() {
  var db = _dbCache || loadDb_();
  var json = JSON.stringify(db);
  try {
    dbFile_().setContent(json);
  } catch (e) {
    // si falla la escritura, se intenta en la proxima peticion
    return;
  }
  try {
    if (json.length < DB_CACHE_MAX) {
      CacheService.getScriptCache().put(DB_CACHE_KEY, json, 21600);
    } else {
      CacheService.getScriptCache().remove(DB_CACHE_KEY);
    }
  } catch (e) { /* la cache es opcional */ }
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
