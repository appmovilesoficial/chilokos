const express = require('express');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { db, save, uid, ROLE_RANK } = require('./src/db');
const rate = require('./src/rate');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_TTL = 24 * 60 * 60 * 1000;   // 24 h: las sesiones y llamados viejos se descartan

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const D = () => db();

// ---------- Autenticación ----------
function auth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || '');
  const session = token && D().sessions[token];
  if (!session) return res.status(401).json({ error: 'Sesión no válida' });
  if (Date.now() - (session.createdAt || 0) > SESSION_TTL) {
    delete D().sessions[token];
    save();
    return res.status(401).json({ error: 'Sesión vencida' });
  }
  if (session.guest) {
    // Cliente invitado: en mesa (QR) o para llevar (carta pública, sin mesa)
    if (session.guest.tableId) {
      const table = D().tables.find(t => t.id === session.guest.tableId);
      if (!table) return res.status(401).json({ error: 'Tu mesa ya no existe' });
    }
    req.user = session.guest;
    req.token = token;
    return next();
  }
  const user = D().users.find(u => u.id === session.userId && u.active);
  if (!user) return res.status(401).json({ error: 'Usuario inactivo o inexistente' });
  req.user = { id: user.id, name: user.name, role: user.role, username: user.username };
  req.token = token;
  next();
}

// Garantiza sesión antes de validar permisos (puede usarse solo o tras auth)
function ensureAuth(req, res, cb) {
  if (req.user) return cb();
  auth(req, res, cb);
}

function requireRole(...roles) {
  return (req, res, next) => ensureAuth(req, res, () => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tienes permisos para esta acción' });
    }
    next();
  });
}

function minRank(rank) {
  return (req, res, next) => ensureAuth(req, res, () => {
    if (ROLE_RANK[req.user.role] < rank) {
      return res.status(403).json({ error: 'No tienes permisos para esta acción' });
    }
    next();
  });
}

function createSession(user, guest = false) {
  const token = crypto.randomBytes(24).toString('hex');
  D().sessions[token] = guest
    ? { userId: user.id, guest: user, createdAt: Date.now() }
    : { userId: user.id, createdAt: Date.now() };
  save();
  return token;
}

// ---------- Auth ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = D().users.find(u => u.username === username && u.password === password && u.active);
  if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  const token = createSession(user);
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, username: user.username } });
});

// Cliente invitado: entra escaneando el QR de su mesa o desde la carta pública (para llevar)
app.post('/api/guest', (req, res) => {
  const { tableId } = req.body || {};

  // Sin mesa: pedido para llevar desde la carta pública
  if (!tableId) {
    const user = {
      id: uid('guest_llevar_'),
      name: 'Cliente Para Llevar',
      role: 'cliente',
      tableId: null,
      guest: true,
      orderType: 'llevar',
    };
    const token = createSession(user, true);
    return res.json({ token, user: { id: user.id, name: user.name, role: user.role, orderType: 'llevar' }, table: null });
  }

  const table = D().tables.find(t => t.id === tableId);
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
  const user = {
    id: 'guest_' + table.id,
    name: 'Cliente Mesa ' + table.number,
    role: 'cliente',
    tableId: table.id,
    guest: true,
    orderType: 'sitio',
  };
  const token = createSession(user, true);
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, orderType: 'sitio' }, table });
});

app.post('/api/logout', auth, (req, res) => {
  delete D().sessions[req.token];
  save();
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  let table = null;
  if (req.user.tableId) table = D().tables.find(t => t.id === req.user.tableId) || null;
  res.json({ user: req.user, table, role: req.user.role });
});

// ---------- Menú ----------
app.get('/api/menu', auth, (req, res) => {
  let items = D().menu;
  if (req.user.role === 'cliente') items = items.filter(m => m.available);
  res.json(items);
});

app.post('/api/menu', minRank(4), (req, res) => {
  const { name, price, category, emoji, description } = req.body || {};
  if (!name || price == null) return res.status(400).json({ error: 'Nombre y precio son obligatorios' });
  const item = {
    id: uid('m_'), name, price: Number(price), category: category || 'Sin categoría',
    emoji: emoji || '🍽️', description: description || '', available: true,
  };
  D().menu.push(item);
  save();
  res.status(201).json(item);
});

app.patch('/api/menu/:id', minRank(4), (req, res) => {
  const item = D().menu.find(m => m.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Platillo no encontrado' });
  const fields = ['name', 'price', 'category', 'emoji', 'description', 'available'];
  fields.forEach(f => { if (req.body[f] !== undefined) item[f] = f === 'price' ? Number(req.body[f]) : req.body[f]; });
  save();
  res.json(item);
});

app.delete('/api/menu/:id', auth, requireRole('dueno'), (req, res) => {
  const db = D();
  const idx = db.menu.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Platillo no encontrado' });
  db.menu.splice(idx, 1);
  save();
  res.json({ ok: true });
});

// ---------- Mesas ----------
app.get('/api/tables', auth, (req, res) => {
  // Una sola pasada por las órdenes (antes: una pasada completa por cada mesa)
  const pendientes = new Map();
  for (const o of D().orders) {
    if (o.status === 'pagado' || o.status === 'cancelado') continue;
    const acc = pendientes.get(o.tableId) || { activeOrders: 0, pending: 0 };
    acc.activeOrders += 1;
    acc.pending += totalOf(o);
    pendientes.set(o.tableId, acc);
  }
  res.json(D().tables.map(t => ({
    ...t,
    activeOrders: 0, pending: 0,
    ...(pendientes.get(t.id) || {}),
  })));
});

app.post('/api/tables', minRank(4), (req, res) => {
  const { number, seats } = req.body || {};
  if (!number) return res.status(400).json({ error: 'Número de mesa requerido' });
  if (D().tables.some(t => t.number === Number(number))) {
    return res.status(400).json({ error: 'Ya existe una mesa con ese número' });
  }
  const table = { id: 'mesa-' + number + '-' + uid(3), number: Number(number), seats: Number(seats) || 4, status: 'libre' };
  D().tables.push(table);
  save();
  res.status(201).json(table);
});

app.patch('/api/tables/:id', minRank(4), (req, res) => {
  const table = D().tables.find(t => t.id === req.params.id);
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
  if (req.body.number != null) table.number = Number(req.body.number);
  if (req.body.seats != null) table.seats = Number(req.body.seats);
  if (req.body.status != null) table.status = req.body.status;
  save();
  res.json(table);
});

app.delete('/api/tables/:id', auth, requireRole('dueno'), (req, res) => {
  const db = D();
  const idx = db.tables.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Mesa no encontrada' });
  const table = db.tables[idx];
  const hasOrders = db.orders.some(o => o.tableId === table.id && !['pagado', 'cancelado'].includes(o.status));
  if (hasOrders) return res.status(400).json({ error: 'La mesa tiene pedidos activos' });
  db.tables.splice(idx, 1);
  save();
  res.json({ ok: true });
});

// QR emitido por el aplicativo (solo administradores)
app.get('/api/tables/:id/qr', auth, minRank(4), async (req, res) => {
  const table = D().tables.find(t => t.id === req.params.id);
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
  const base = `${req.protocol}://${req.get('host')}`;
  const url = `${base}/#/mesa/${table.id}`;
  try {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 2, color: { dark: '#0f172a', light: '#ffffff' } });
    res.json({ table: table.number, url, svg });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo generar el QR' });
  }
});

// ---------- Pedidos ----------
function totalOf(order) {   // declarada antes de usarse en /api/tables por hoisting
  return order.items.reduce((s, i) => s + i.price * i.qty, 0);
}

function visibleOrders(user, orders) {
  switch (user.role) {
    case 'cliente': {
      // En mesa ve lo de su mesa; para llevar ve solo sus propios pedidos
      if (user.tableId) return orders.filter(o => o.tableId === user.tableId);
      return orders.filter(o => o.createdById === user.id);
    }
    case 'cocinero':
      return orders.filter(o => ['nuevo', 'preparando', 'listo'].includes(o.status));
    case 'cajero':
      return orders.filter(o => ['servido', 'por_pagar', 'pagado'].includes(o.status));
    case 'mesero':
      return orders;
    default:
      return orders;
  }
}

app.get('/api/orders', auth, (req, res) => {
  const orders = [...D().orders].sort((a, b) => b.createdAt - a.createdAt);
  res.json(visibleOrders(req.user, orders).map(o => ({ ...o, total: totalOf(o) })));
});

app.post('/api/orders', auth, (req, res) => {
  const { tableId, items, notes, orderType: tipoPedido, customerName } = req.body || {};
  const db = D();

  if (!['cliente', 'mesero', 'encargado', 'dueno'].includes(req.user.role)) {
    return res.status(403).json({ error: 'No tienes permisos para crear pedidos' });
  }
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'El pedido está vacío' });

  const table = tableId ? db.tables.find(t => t.id === tableId) : null;
  if (tableId && !table) return res.status(400).json({ error: 'Mesa inválida' });

  // Un cliente solo puede pedir para su propia mesa, o para llevar si no tiene mesa
  if (req.user.role === 'cliente' && (req.user.tableId || null) !== (tableId || null)) {
    return res.status(403).json({ error: 'Solo puedes pedir para tu mesa' });
  }

  // Comer en el sitio exige mesa; sin mesa el pedido es "para llevar"
  const orderType = (!table || tipoPedido === 'llevar') ? 'llevar' : 'sitio';
  const nombre = String(customerName || '').trim().slice(0, 40);

  const orderItems = [];
  for (const it of items) {
    const m = db.menu.find(x => x.id === it.menuId && x.available);
    if (!m) return res.status(400).json({ error: 'Un platillo del pedido ya no está disponible' });
    orderItems.push({
      menuId: m.id, name: m.name, emoji: m.emoji,
      price: m.price, qty: Math.max(1, Math.min(99, Number(it.qty) || 1)),
      notes: (it.notes || '').toString().slice(0, 200),
    });
  }

  const order = {
    id: db.counters.order++,
    tableId: table ? table.id : null,
    tableNumber: table ? table.number : null,
    orderType,
    customerName: orderType === 'llevar' ? (nombre || req.user.name) : null,
    items: orderItems,
    notes: (notes || '').toString().slice(0, 300),
    status: 'nuevo',
    createdBy: req.user.name,
    createdById: req.user.id,
    createdAt: Date.now(),
    history: [{ status: 'nuevo', at: Date.now(), by: req.user.name }],
    payments: [],
  };
  db.orders.push(order);
  if (table) table.status = 'ocupada';
  save();
  res.status(201).json({ ...order, total: totalOf(order) });
});

// Mesero/agregado de items a un pedido abierto
app.post('/api/orders/:id/items', minRank(2), (req, res) => {
  const order = D().orders.find(o => o.id === Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (['pagado', 'cancelado'].includes(order.status)) {
    return res.status(400).json({ error: 'El pedido ya fue cerrado' });
  }
  const { menuId, qty } = req.body || {};
  const m = D().menu.find(x => x.id === menuId && x.available);
  if (!m) return res.status(404).json({ error: 'Platillo no disponible' });
  const existing = order.items.find(i => i.menuId === m.id && !i.notes);
  if (existing) existing.qty += Math.max(1, Number(qty) || 1);
  else order.items.push({ menuId: m.id, name: m.name, emoji: m.emoji, price: m.price, qty: Math.max(1, Number(qty) || 1), notes: '' });
  order.history.push({ status: order.status, at: Date.now(), by: req.user.name + ' (agregó platillos)' });
  save();
  res.json({ ...order, total: totalOf(order) });
});

const TRANSITIONS = {
  nuevo: { preparando: ['cocinero', 'encargado', 'dueno'], cancelado: ['encargado', 'dueno', 'mesero'] },
  preparando: { listo: ['cocinero', 'encargado', 'dueno'], cancelado: ['encargado', 'dueno'] },
  listo: { servido: ['mesero', 'encargado', 'dueno'], cancelado: ['encargado', 'dueno'] },
  servido: { por_pagar: ['mesero', 'cliente', 'encargado', 'dueno'], cancelado: ['encargado', 'dueno'] },
  por_pagar: { pagado: ['cajero', 'encargado', 'dueno'], cancelado: ['encargado', 'dueno'] },
  pagado: {},
  cancelado: {},
};

app.patch('/api/orders/:id/status', auth, (req, res) => {
  const order = D().orders.find(o => o.id === Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  const next = (req.body || {}).status;
  const allowed = TRANSITIONS[order.status] || {};
  const roles = allowed[next];
  if (!roles) return res.status(400).json({ error: `Transición no válida: ${order.status} → ${next}` });
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: `Tu perfil (${req.user.role}) no puede realizar esa acción` });
  }
  order.status = next;
  order.history.push({ status: next, at: Date.now(), by: req.user.name });
  if (next === 'pagado') {
    const table = D().tables.find(t => t.id === order.tableId);
    const otherOpen = D().orders.some(o => o.tableId === order.tableId && o.id !== order.id && !['pagado', 'cancelado'].includes(o.status));
    if (table && !otherOpen) table.status = 'libre';
  }
  if (next === 'cancelado') {
    const table = D().tables.find(t => t.id === order.tableId);
    const otherOpen = D().orders.some(o => o.tableId === order.tableId && o.id !== order.id && !['pagado', 'cancelado'].includes(o.status));
    if (table && !otherOpen) table.status = 'libre';
  }
  save();
  res.json({ ...order, total: totalOf(order) });
});

// Pago (solo cajero o administración)
app.post('/api/orders/:id/pay', auth, requireRole('cajero', 'encargado', 'dueno'), (req, res) => {
  const order = D().orders.find(o => o.id === Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.status === 'pagado') return res.status(400).json({ error: 'El pedido ya está pagado' });
  if (order.status === 'cancelado') return res.status(400).json({ error: 'El pedido está cancelado' });
  const { method, amount } = req.body || {};
  const total = totalOf(order);
  const paid = {
    method: ['efectivo', 'tarjeta', 'transferencia', 'qr'].includes(method) ? method : 'efectivo',
    amount: total,                                  // venta real
    received: amount != null ? Number(amount) : total, // dinero entregado (para cambio)
    at: Date.now(),
    by: req.user.name,
  };
  order.payments.push(paid);
  order.status = 'pagado';
  order.history.push({ status: 'pagado', at: Date.now(), by: req.user.name });
  const table = D().tables.find(t => t.id === order.tableId);
  const otherOpen = D().orders.some(o => o.tableId === order.tableId && o.id !== order.id && !['pagado', 'cancelado'].includes(o.status));
  if (table && !otherOpen) table.status = 'libre';
  save();
  res.json({ ...order, total });
});

// ---------- Notificaciones (llamar al mesero / pedir cuenta) ----------
app.get('/api/notifications', auth, (req, res) => {
  const list = D().notifications;
  if (['mesero', 'encargado', 'dueno'].includes(req.user.role)) return res.json(list);
  if (req.user.role === 'cliente') return res.json(list.filter(n => n.tableId === req.user.tableId));
  return res.json([]);
});

app.post('/api/notifications', auth, (req, res) => {
  const { tableId, type } = req.body || {};
  if (req.user.role === 'cliente' && !req.user.tableId) {
    return res.status(400).json({ error: 'Los pedidos para llevar no usan llamados: pasa por caja' });
  }
  if (req.user.role === 'cliente' && req.user.tableId !== tableId) {
    return res.status(403).json({ error: 'Mesa no válida' });
  }
  if (!['cliente', 'mesero', 'encargado', 'dueno'].includes(req.user.role)) {
    return res.status(403).json({ error: 'No permitido' });
  }
  const table = D().tables.find(t => t.id === tableId);
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
  const notif = {
    id: uid('n_'), tableId, tableNumber: table.number,
    type: ['waiter', 'bill'].includes(type) ? type : 'waiter',
    by: req.user.name, createdAt: Date.now(),
  };
  D().notifications.push(notif);
  save();
  res.status(201).json(notif);
});

app.delete('/api/notifications/:id', minRank(2), (req, res) => {
  const db = D();
  const idx = db.notifications.findIndex(n => n.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Notificación no encontrada' });
  db.notifications.splice(idx, 1);
  save();
  res.json({ ok: true });
});

// ---------- Usuarios ----------
app.get('/api/users', minRank(4), (req, res) => {
  res.json(D().users.map(({ password, ...u }) => u));
});

app.post('/api/users', auth, requireRole('dueno'), (req, res) => {
  const { username, password, name, role } = req.body || {};
  if (!username || !password || !name || !role) return res.status(400).json({ error: 'Faltan datos' });
  if (!ROLE_RANK[role]) return res.status(400).json({ error: 'Rol no válido' });
  if (D().users.some(u => u.username === username)) return res.status(400).json({ error: 'Ese usuario ya existe' });
  const user = { id: uid('u_'), username, password, name, role, active: true };
  D().users.push(user);
  save();
  const { password: pw, ...safe } = user;
  res.status(201).json(safe);
});

app.patch('/api/users/:id', auth, requireRole('dueno'), (req, res) => {
  const user = D().users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const { name, role, password, active } = req.body || {};
  if (name != null) user.name = name;
  if (role != null && ROLE_RANK[role]) user.role = role;
  if (password) user.password = password;
  if (active != null) user.active = !!active;
  save();
  const { password: p, ...safe } = user;
  res.json(safe);
});

// ---------- Reportes ----------
// Solo encargado y dueño ven reportes
function soloReportes(req, res, next) {
  if (!['encargado', 'dueno'].includes(req.user.role)) {
    return res.status(403).json({ error: 'No tienes permisos para ver reportes' });
  }
  next();
}

app.get('/api/reports/summary', auth, soloReportes, (req, res) => {
  const db = D();
  const paid = db.orders.filter(o => o.status === 'pagado');
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const today = paid.filter(o => o.payments.some(p => p.at >= startOfDay.getTime()));
  const salesToday = today.reduce((s, o) => s + totalOf(o), 0);
  const salesAll = paid.reduce((s, o) => s + totalOf(o), 0);

  const byMethod = {};
  paid.forEach(o => o.payments.forEach(p => { byMethod[p.method] = (byMethod[p.method] || 0) + p.amount; }));

  const productCount = {};
  paid.forEach(o => o.items.forEach(i => {
    productCount[i.name] = productCount[i.name] || { name: i.name, qty: 0, revenue: 0 };
    productCount[i.name].qty += i.qty;
    productCount[i.name].revenue += i.qty * i.price;
  }));
  const topProducts = Object.values(productCount).sort((a, b) => b.qty - a.qty).slice(0, 5);

  const byHour = new Array(24).fill(0);
  today.forEach(o => o.payments.forEach(p => { byHour[new Date(p.at).getHours()] += p.amount; }));

  res.json({
    salesToday, salesAll,
    ordersToday: today.length,
    ordersTotal: paid.length,
    avgTicket: today.length ? salesToday / today.length : 0,
    byMethod, topProducts, byHour,
    openOrders: db.orders.filter(o => !['pagado', 'cancelado'].includes(o.status)).length,
    tablesTotal: db.tables.length,
    tablesBusy: db.tables.filter(t => t.status === 'ocupada').length,
    menuItems: db.menu.filter(m => m.available).length,
    staff: db.users.filter(u => u.active).length,
  });
});

// ---------- Tasa del euro del BCV (pública: también la usa el login) ----------
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function legible(fechaValor) {
  if (!fechaValor) return null;
  const [y, m, d] = fechaValor.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return `${DIAS[dow]} ${d} de ${MESES[m - 1]} de ${y}`;
}

app.get('/api/rates/euro', async (req, res) => {
  try {
    const applied = await rate.getApplied(D(), save);
    if (!applied) {
      return res.json({ ok: false, tasa: null, error: D().eur?.lastError || 'Sin tasa disponible aún' });
    }
    res.json({
      ok: true,
      tasa: applied.tasa,
      fechaValor: applied.fechaValor,
      fechaValorLegible: legible(applied.fechaValor),
      regla: applied.regla,
      fuente: 'BCV — Banco Central de Venezuela',
      actualizado: D().eur.lastOk || null,
      error: D().eur.lastError || null,
    });
  } catch (e) {
    res.status(500).json({ ok: false, tasa: null, error: String(e.message || e) });
  }
});

// Higiene de datos: sin esto db.json acumula sesiones y llamados para siempre
function prune() {
  const db = D();
  const now = Date.now();
  let cambiado = false;
  for (const [token, s] of Object.entries(db.sessions)) {
    if (now - (s.createdAt || 0) > SESSION_TTL) { delete db.sessions[token]; cambiado = true; }
  }
  const vigentes = db.notifications.filter(n => now - n.createdAt <= SESSION_TTL);
  if (vigentes.length !== db.notifications.length) { db.notifications = vigentes; cambiado = true; }
  if (cambiado) save();
}

// Arranque
app.listen(PORT, async () => {
  prune();
  console.log(`\n🌮 Chilokos corriendo en http://localhost:${PORT}`);
  console.log(`   Carta para llevar: http://localhost:${PORT}/#/carta`);
  console.log(`   Cliente en mesa:   http://localhost:${PORT}/#/mesa/mesa-1\n`);

  // Tasa del euro del BCV: consulta inicial + refresco periódico (cada 20 min)
  const refresh = () => rate.refreshIfStale(D(), save).then(ok => {
    if (ok) {
      const applied = rate.selectRate(D().eur.pubs, Date.now());
      if (applied) console.log(`   💱 Tasa BCV: 1 € = Bs. ${applied.tasa} (${applied.regla}${applied.fechaValor ? ', fecha valor ' + applied.fechaValor : ''})`);
    } else if (D().eur?.lastError) {
      console.log(`   ⚠️  Tasa BCV no disponible: ${D().eur.lastError}`);
    }
  }).catch(() => {});
  refresh();
  setInterval(refresh, 20 * 60 * 1000);
});
