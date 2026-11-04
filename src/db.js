// Persistencia en archivo JSON (sin dependencias nativas)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const DB_VERSION = 2;            // 2 = carta de Chilokos

// Carta de Chilokos: [categoría, nombre, precio (EUR), emoji, descripción]
const MENUS = [
  // --- Tacos ---
  ['Tacos', 'Taco al pastor', 3.9, '🌮', 'Cerdo adobado, piña, cilantro y cebolla'],
  ['Tacos', 'Taco de birria', 4.2, '🥩', 'Birria de res deshebrada con consomé para mojar'],
  ['Tacos', 'Taco de suadero', 4.0, '🥩', 'Suadero dorado con salsa verde y cebolla'],
  ['Tacos', 'Taco de pollo', 3.7, '🍗', 'Pollo a la plancha, pico de gallo y limón'],
  ['Tacos', 'Taco de costilla', 4.5, '🍖', 'Costilla de cerdo en salsa roja tatemada'],
  // --- Flautas ---
  ['Flautas', 'Flautas de pollo (3 pz)', 6.5, '🌯', 'Tortilla frita, pollo, crema, queso fresco y salsa'],
  ['Flautas', 'Flautas de birria (3 pz)', 7.2, '🌯', 'Rellenas de birria, bañadas en consomé'],
  ['Flautas', 'Flautas de papa (3 pz)', 5.5, '🥔', 'Papa con queso, lechuga y crema (sin carne)'],
  // --- Burritos ---
  ['Burritos', 'Burrito de birria', 8.5, '🌯', 'Birria, arroz, frijoles, queso y consomé aparte'],
  ['Burritos', 'Burrito de pollo', 7.5, '🌯', 'Pollo, arroz, frijoles y pico de gallo'],
  ['Burritos', 'Burrito vegetariano', 6.9, '🥬', 'Frijoles, arroz, elote, queso y guacamole'],
  // --- Birria ---
  ['Birria', 'Ramen de birria', 9.9, '🍜', 'Caldo de birria, fideos ramen, cebolla, cilantro y limón'],
  ['Birria', 'Quesabirria', 5.5, '🧀', 'Tortilla dorada con queso fundido y birria'],
  ['Birria', 'Consomé de birria', 4.5, '🍲', 'Caldo concentrado con cebolla, cilantro y limón'],
  ['Birria', 'Birria en su jugo (350 g)', 11.9, '🥘', 'Res cocida lento con tortillas y salsa'],
  // --- Enchiladas ---
  ['Enchiladas', 'Enchiladas rojas (3 pz)', 7.9, '🌶️', 'Rellenas de pollo, salsa roja, crema y queso'],
  ['Enchiladas', 'Enchiladas verdes (3 pz)', 7.9, '🍅', 'Salsa verde de tomatillo, pollo y queso fresco'],
  ['Enchiladas', 'Enchiladas de mole (3 pz)', 8.2, '🍫', 'Mole poblano, ajonjolí y cebolla'],
  // --- Antojitos ---
  ['Antojitos', 'Elote en vaso', 4.0, '🌽', 'Granos de elote, mayonesa, queso y chile piquín'],
  ['Antojitos', 'Nachos con queso', 5.5, '🧀', 'Totopos con cheddar fundido y jalapeños'],
  ['Antojitos', 'Guacamole con totopos', 4.8, '🥑', 'Aguacate fresco, cilantro y limón'],
  ['Antojitos', 'Gomitas enchiladas', 3.5, '🍬', 'Gomitas de tamarindo con chile (bolsita)'],
  // --- Bebidas ---
  ['Bebidas', 'Agua de horchata', 3.0, '🥛', 'Horchata de arroz con canela y vainilla'],
  ['Bebidas', 'Agua de jamaica', 3.0, '🌺', 'Jamaica fría con un toque de azúcar'],
  ['Bebidas', 'Limonada de la casa', 3.2, '🍋', 'Limonada fresca con hierbabuena'],
  ['Bebidas', 'Refresco 355 ml', 2.2, '🥤', 'Coca-Cola, Sprite o Fanta'],
  ['Bebidas', 'Café de olla', 2.8, '☕', 'Café con canela y piloncillo'],
  // --- Postres ---
  ['Postres', 'Churros con cajeta', 4.5, '🥨', 'Churros calientitos con cajeta'],
  ['Postres', 'Flan casero', 4.5, '🍮', 'Flan de caramelo con nata'],
];

const ROLE_RANK = { cliente: 1, mesero: 2, cocinero: 2, cajero: 3, encargado: 4, dueno: 5 };

function uid(prefix = '') {
  return prefix + crypto.randomBytes(6).toString('hex');
}

function carta() {
  return MENUS.map(([category, name, price, emoji, description]) => ({
    id: uid('m_'), category, name, price, emoji, description, available: true,
  }));
}

function seed() {
  const now = Date.now();
  const users = [
    { id: uid('u_'), username: 'dueno', password: '1234', name: 'Dueño Chilokos', role: 'dueno', active: true },
    { id: uid('u_'), username: 'encargado', password: '1234', name: 'Ana Encargada', role: 'encargado', active: true },
    { id: uid('u_'), username: 'mesero', password: '1234', name: 'Carlos Mesero', role: 'mesero', active: true },
    { id: uid('u_'), username: 'cocina', password: '1234', name: 'Chef Roberto', role: 'cocinero', active: true },
    { id: uid('u_'), username: 'caja', password: '1234', name: 'Lucía Cajero', role: 'cajero', active: true },
  ];

  const menu = carta();

  const tables = [];
  for (let i = 1; i <= 10; i++) {
    tables.push({ id: 'mesa-' + i, number: i, seats: i <= 6 ? 4 : 6, status: 'libre' });
  }

  return {
    version: DB_VERSION,
    users, menu, tables,
    orders: [],
    notifications: [],
    sessions: {},
    counters: { order: 1 },
    eur: { pubs: [] },   // historial de tasas del euro (BCV)
    createdAt: now,
  };
}

let db;
let migrado = false;
if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    // migrations ligeras
    db.notifications = db.notifications || [];
    db.sessions = db.sessions || {};
    db.counters = db.counters || { order: 1 };
    db.eur = db.eur || { pubs: [] };
    // Carta vieja (demo de hamburguesas/pizzas) → carta de Chilokos.
    // Los pedidos guardan nombre y precio propios, así que el historial no se rompe.
    if (!db.version || db.version < DB_VERSION) {
      db.menu = carta();
      db.version = DB_VERSION;
      migrado = true;
    }
  } catch (e) {
    console.error('No se pudo leer db.json, se recrea:', e.message);
    db = seed();
  }
} else {
  db = seed();
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error('Error guardando db.json:', e.message);
    }
  }, 150);
}

if (migrado) save();

function resetIfEmpty() {
  if (!db.users || !db.users.length) {
    db = seed();
    save();
  }
}

module.exports = { db: () => db, save, uid, ROLE_RANK, seed };
