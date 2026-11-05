/**
 * Endpoints de Chilokos (porte fiel de server.js).
 *
 * Apps Script evalúa los archivos en orden alfabético: este archivo (Api.gs)
 * corre antes que Codigo.gs, así que la lista de rutas se inicializa aquí.
 */
var ROUTES = ROUTES || [];

var D = function () { return db(); };

/* ---------------- Autenticacion ---------------- */
function auth(req, res, next) {
  var header = req.headers['authorization'] || '';
  var token = header.indexOf('Bearer ') === 0 ? header.slice(7) : (req.query.token || '');
  var session = token && D().sessions[token];
  if (!session) return res.status(401).json({ error: 'Sesión no válida' });
  if (Date.now() - (session.createdAt || 0) > SESSION_TTL) {
    delete D().sessions[token];
    save();
    return res.status(401).json({ error: 'Sesión vencida' });
  }
  if (session.guest) {
    if (session.guest.tableId) {
      var table = D().tables.filter(function (t) { return t.id === session.guest.tableId; })[0];
      if (!table) return res.status(401).json({ error: 'Tu mesa ya no existe' });
    }
    req.user = session.guest;
    req.token = token;
    return next();
  }
  var user = D().users.filter(function (u) { return u.id === session.userId && u.active; })[0];
  if (!user) return res.status(401).json({ error: 'Usuario inactivo o inexistente' });
  req.user = { id: user.id, name: user.name, role: user.role, username: user.username };
  req.token = token;
  next();
}

function ensureAuth(req, res, cb) {
  if (req.user) return cb();
  auth(req, res, cb);
}

function requireRole() {
  var roles = Array.prototype.slice.call(arguments);
  return function (req, res, next) {
    ensureAuth(req, res, function () {
      if (roles.indexOf(req.user.role) === -1) {
        return res.status(403).json({ error: 'No tienes permisos para esta acción' });
      }
      next();
    });
  };
}

function minRank(rank) {
  return function (req, res, next) {
    ensureAuth(req, res, function () {
      if (ROLE_RANK[req.user.role] < rank) {
        return res.status(403).json({ error: 'No tienes permisos para esta acción' });
      }
      next();
    });
  };
}

function soloReportes(req, res, next) {
  if (['encargado', 'dueno'].indexOf(req.user.role) === -1) {
    return res.status(403).json({ error: 'No tienes permisos para ver reportes' });
  }
  next();
}

function createSession(user, guest) {
  var token = uid('') + uid('');
  D().sessions[token] = guest
    ? { userId: user.id, guest: user, createdAt: Date.now() }
    : { userId: user.id, createdAt: Date.now() };
  save();
  return token;
}

/* ---------------- Auth ---------------- */
apiRoute_('POST', '/api/login', [function (req, res) {
  var body = req.body || {};
  var user = D().users.filter(function (u) {
    return u.username === body.username && u.password === body.password && u.active;
  })[0];
  if (!user) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  var token = createSession(user, false);
  res.json({ token: token, user: { id: user.id, name: user.name, role: user.role, username: user.username } });
}]);

apiRoute_('POST', '/api/guest', [function (req, res) {
  var tableId = (req.body || {}).tableId;

  if (!tableId) {
    var userLlevar = {
      id: uid('guest_llevar_'),
      name: 'Cliente Para Llevar',
      role: 'cliente',
      tableId: null,
      guest: true,
      orderType: 'llevar',
    };
    var tokenLlevar = createSession(userLlevar, true);
    return res.json({
      token: tokenLlevar,
      user: { id: userLlevar.id, name: userLlevar.name, role: userLlevar.role, orderType: 'llevar' },
      table: null,
    });
  }

  var table = D().tables.filter(function (t) { return t.id === tableId; })[0];
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
  var user = {
    id: 'guest_' + table.id,
    name: 'Cliente Mesa ' + table.number,
    role: 'cliente',
    tableId: table.id,
    guest: true,
    orderType: 'sitio',
  };
  var token = createSession(user, true);
  res.json({ token: token, user: { id: user.id, name: user.name, role: user.role, orderType: 'sitio' }, table: table });
}]);

apiRoute_('POST', '/api/logout', [auth, function (req, res) {
  delete D().sessions[req.token];
  save();
  res.json({ ok: true });
}]);

apiRoute_('GET', '/api/me', [auth, function (req, res) {
  var table = null;
  if (req.user.tableId) {
    table = D().tables.filter(function (t) { return t.id === req.user.tableId; })[0] || null;
  }
  res.json({ user: req.user, table: table, role: req.user.role });
}]);

/* ---------------- Menu ---------------- */
apiRoute_('GET', '/api/menu', [auth, function (req, res) {
  var items = D().menu;
  if (req.user.role === 'cliente') {
    items = items.filter(function (m) { return m.available; });
  }
  res.json(items);
}]);

apiRoute_('POST', '/api/menu', [minRank(4), function (req, res) {
  var b = req.body || {};
  if (!b.name || b.price == null) return res.status(400).json({ error: 'Nombre y precio son obligatorios' });
  var item = {
    id: uid('m_'), name: b.name, price: Number(b.price),
    category: b.category || 'Sin categoría',
    emoji: b.emoji || '🍽️', description: b.description || '', available: true,
  };
  D().menu.push(item);
  save();
  res.status(201).json(item);
}]);

apiRoute_('PATCH', '/api/menu/:id', [minRank(4), function (req, res) {
  var item = D().menu.filter(function (m) { return m.id === req.params.id; })[0];
  if (!item) return res.status(404).json({ error: 'Platillo no encontrado' });
  var fields = ['name', 'price', 'category', 'emoji', 'description', 'available'];
  fields.forEach(function (f) {
    if (req.body[f] !== undefined) item[f] = f === 'price' ? Number(req.body[f]) : req.body[f];
  });
  save();
  res.json(item);
}]);

apiRoute_('DELETE', '/api/menu/:id', [auth, requireRole('dueno'), function (req, res) {
  var db = D();
  var idx = -1;
  for (var i = 0; i < db.menu.length; i++) if (db.menu[i].id === req.params.id) { idx = i; break; }
  if (idx === -1) return res.status(404).json({ error: 'Platillo no encontrado' });
  db.menu.splice(idx, 1);
  save();
  res.json({ ok: true });
}]);

/* ---------------- Mesas ---------------- */
apiRoute_('GET', '/api/tables', [auth, function (req, res) {
  var pendientes = {};
  D().orders.forEach(function (o) {
    if (o.status === 'pagado' || o.status === 'cancelado') return;
    var acc = pendientes[o.tableId] || { activeOrders: 0, pending: 0 };
    acc.activeOrders += 1;
    acc.pending += totalOf(o);
    pendientes[o.tableId] = acc;
  });
  res.json(D().tables.map(function (t) {
    var extra = pendientes[t.id] || { activeOrders: 0, pending: 0 };
    var out = {};
    for (var k in t) out[k] = t[k];
    out.activeOrders = extra.activeOrders;
    out.pending = extra.pending;
    return out;
  }));
}]);

apiRoute_('POST', '/api/tables', [minRank(4), function (req, res) {
  var b = req.body || {};
  if (!b.number) return res.status(400).json({ error: 'Número de mesa requerido' });
  var dup = D().tables.some(function (t) { return t.number === Number(b.number); });
  if (dup) return res.status(400).json({ error: 'Ya existe una mesa con ese número' });
  var table = {
    id: 'mesa-' + b.number + '-' + uid(3),
    number: Number(b.number),
    seats: Number(b.seats) || 4,
    status: 'libre',
  };
  D().tables.push(table);
  save();
  res.status(201).json(table);
}]);

apiRoute_('PATCH', '/api/tables/:id', [minRank(4), function (req, res) {
  var table = D().tables.filter(function (t) { return t.id === req.params.id; })[0];
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
  if (req.body.number != null) table.number = Number(req.body.number);
  if (req.body.seats != null) table.seats = Number(req.body.seats);
  if (req.body.status != null) table.status = req.body.status;
  save();
  res.json(table);
}]);

apiRoute_('DELETE', '/api/tables/:id', [auth, requireRole('dueno'), function (req, res) {
  var db = D();
  var idx = -1;
  for (var i = 0; i < db.tables.length; i++) if (db.tables[i].id === req.params.id) { idx = i; break; }
  if (idx === -1) return res.status(404).json({ error: 'Mesa no encontrada' });
  var table = db.tables[idx];
  var hasOrders = db.orders.some(function (o) {
    return o.tableId === table.id && ['pagado', 'cancelado'].indexOf(o.status) === -1;
  });
  if (hasOrders) return res.status(400).json({ error: 'La mesa tiene pedidos activos' });
  db.tables.splice(idx, 1);
  save();
  res.json({ ok: true });
}]);

apiRoute_('GET', '/api/tables/:id/qr', [auth, minRank(4), function (req, res) {
  var table = D().tables.filter(function (t) { return t.id === req.params.id; })[0];
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
  var url = SITE_URL + '/#/mesa/' + table.id;
  res.json({ table: table.number, url: url });
}]);

/* ---------------- Pedidos ---------------- */
function totalOf(order) {
  return order.items.reduce(function (s, i) { return s + i.price * i.qty; }, 0);
}

function visibleOrders(user, orders) {
  switch (user.role) {
    case 'cliente':
      if (user.tableId) return orders.filter(function (o) { return o.tableId === user.tableId; });
      return orders.filter(function (o) { return o.createdById === user.id; });
    case 'cocinero':
      return orders.filter(function (o) { return ['nuevo', 'preparando', 'listo'].indexOf(o.status) !== -1; });
    case 'cajero':
      return orders.filter(function (o) { return ['servido', 'por_pagar', 'pagado'].indexOf(o.status) !== -1; });
    case 'mesero':
      return orders;
    default:
      return orders;
  }
}

apiRoute_('GET', '/api/orders', [auth, function (req, res) {
  var orders = D().orders.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
  res.json(visibleOrders(req.user, orders).map(function (o) {
    var out = {};
    for (var k in o) out[k] = o[k];
    out.total = totalOf(o);
    return out;
  }));
}]);

apiRoute_('POST', '/api/orders', [auth, function (req, res) {
  var b = req.body || {};
  var db = D();

  if (['cliente', 'mesero', 'encargado', 'dueno'].indexOf(req.user.role) === -1) {
    return res.status(403).json({ error: 'No tienes permisos para crear pedidos' });
  }
  if (!Array.isArray(b.items) || !b.items.length) return res.status(400).json({ error: 'El pedido está vacío' });

  var table = b.tableId ? db.tables.filter(function (t) { return t.id === b.tableId; })[0] : null;
  if (b.tableId && !table) return res.status(400).json({ error: 'Mesa inválida' });

  if (req.user.role === 'cliente' && (req.user.tableId || null) !== (b.tableId || null)) {
    return res.status(403).json({ error: 'Solo puedes pedir para tu mesa' });
  }

  var orderType = (!table || b.orderType === 'llevar') ? 'llevar' : 'sitio';
  var nombre = String(b.customerName || '').trim().slice(0, 40);

  var orderItems = [];
  for (var i = 0; i < b.items.length; i++) {
    var it = b.items[i];
    var m = db.menu.filter(function (x) { return x.id === it.menuId && x.available; })[0];
    if (!m) return res.status(400).json({ error: 'Un platillo del pedido ya no está disponible' });
    orderItems.push({
      menuId: m.id, name: m.name, emoji: m.emoji, price: m.price,
      qty: Math.max(1, Math.min(99, Number(it.qty) || 1)),
      notes: String(it.notes || '').slice(0, 200),
    });
  }

  var order = {
    id: db.counters.order++,
    tableId: table ? table.id : null,
    tableNumber: table ? table.number : null,
    orderType: orderType,
    customerName: orderType === 'llevar' ? (nombre || req.user.name) : null,
    items: orderItems,
    notes: String(b.notes || '').slice(0, 300),
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

  var out = {};
  for (var k in order) out[k] = order[k];
  out.total = totalOf(order);
  res.status(201).json(out);
}]);

apiRoute_('POST', '/api/orders/:id/items', [minRank(2), function (req, res) {
  var order = D().orders.filter(function (o) { return o.id === Number(req.params.id); })[0];
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (['pagado', 'cancelado'].indexOf(order.status) !== -1) {
    return res.status(400).json({ error: 'El pedido ya fue cerrado' });
  }
  var b = req.body || {};
  var m = D().menu.filter(function (x) { return x.id === b.menuId && x.available; })[0];
  if (!m) return res.status(404).json({ error: 'Platillo no disponible' });

  var existing = order.items.filter(function (i) { return i.menuId === m.id && !i.notes; })[0];
  if (existing) {
    existing.qty += Math.max(1, Number(b.qty) || 1);
  } else {
    order.items.push({
      menuId: m.id, name: m.name, emoji: m.emoji, price: m.price,
      qty: Math.max(1, Number(b.qty) || 1), notes: '',
    });
  }
  order.history.push({ status: order.status, at: Date.now(), by: req.user.name + ' (agregó platillos)' });
  save();

  var out = {};
  for (var k in order) out[k] = order[k];
  out.total = totalOf(order);
  res.json(out);
}]);

var TRANSITIONS = {
  nuevo: { preparando: ['cocinero', 'encargado', 'dueno'], cancelado: ['encargado', 'dueno', 'mesero'] },
  preparando: { listo: ['cocinero', 'encargado', 'dueno'], cancelado: ['encargado', 'dueno'] },
  listo: { servido: ['mesero', 'encargado', 'dueno'], cancelado: ['encargado', 'dueno'] },
  servido: { por_pagar: ['mesero', 'cliente', 'encargado', 'dueno'], cancelado: ['encargado', 'dueno'] },
  por_pagar: { pagado: ['cajero', 'encargado', 'dueno'], cancelado: ['encargado', 'dueno'] },
  pagado: {},
  cancelado: {},
};

apiRoute_('PATCH', '/api/orders/:id/status', [auth, function (req, res) {
  var order = D().orders.filter(function (o) { return o.id === Number(req.params.id); })[0];
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  var next = (req.body || {}).status;
  var allowed = TRANSITIONS[order.status] || {};
  var roles = allowed[next];
  if (!roles) return res.status(400).json({ error: 'Transición no válida: ' + order.status + ' → ' + next });
  if (roles.indexOf(req.user.role) === -1) {
    return res.status(403).json({ error: 'Tu perfil (' + req.user.role + ') no puede realizar esa acción' });
  }
  order.status = next;
  order.history.push({ status: next, at: Date.now(), by: req.user.name });

  if (next === 'pagado' || next === 'cancelado') {
    var table = D().tables.filter(function (t) { return t.id === order.tableId; })[0];
    var otherOpen = D().orders.some(function (o) {
      return o.tableId === order.tableId && o.id !== order.id && ['pagado', 'cancelado'].indexOf(o.status) === -1;
    });
    if (table && !otherOpen) table.status = 'libre';
  }
  save();

  var out = {};
  for (var k in order) out[k] = order[k];
  out.total = totalOf(order);
  res.json(out);
}]);

apiRoute_('POST', '/api/orders/:id/pay', [auth, requireRole('cajero', 'encargado', 'dueno'), function (req, res) {
  var order = D().orders.filter(function (o) { return o.id === Number(req.params.id); })[0];
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.status === 'pagado') return res.status(400).json({ error: 'El pedido ya está pagado' });
  if (order.status === 'cancelado') return res.status(400).json({ error: 'El pedido está cancelado' });

  var b = req.body || {};
  var total = totalOf(order);
  var paid = {
    method: ['efectivo', 'tarjeta', 'transferencia', 'qr'].indexOf(b.method) !== -1 ? b.method : 'efectivo',
    amount: total,
    received: b.amount != null ? Number(b.amount) : total,
    at: Date.now(),
    by: req.user.name,
  };
  order.payments.push(paid);
  order.status = 'pagado';
  order.history.push({ status: 'pagado', at: Date.now(), by: req.user.name });

  var table = D().tables.filter(function (t) { return t.id === order.tableId; })[0];
  var otherOpen = D().orders.some(function (o) {
    return o.tableId === order.tableId && o.id !== order.id && ['pagado', 'cancelado'].indexOf(o.status) === -1;
  });
  if (table && !otherOpen) table.status = 'libre';
  save();

  var out = {};
  for (var k in order) out[k] = order[k];
  out.total = total;
  res.json(out);
}]);

/* ---------------- Notificaciones ---------------- */
apiRoute_('GET', '/api/notifications', [auth, function (req, res) {
  var list = D().notifications;
  if (['mesero', 'encargado', 'dueno'].indexOf(req.user.role) !== -1) return res.json(list);
  if (req.user.role === 'cliente') {
    return res.json(list.filter(function (n) { return n.tableId === req.user.tableId; }));
  }
  res.json([]);
}]);

apiRoute_('POST', '/api/notifications', [auth, function (req, res) {
  var b = req.body || {};
  if (req.user.role === 'cliente' && !req.user.tableId) {
    return res.status(400).json({ error: 'Los pedidos para llevar no usan llamados: pasa por caja' });
  }
  if (req.user.role === 'cliente' && req.user.tableId !== b.tableId) {
    return res.status(403).json({ error: 'Mesa no válida' });
  }
  if (['cliente', 'mesero', 'encargado', 'dueno'].indexOf(req.user.role) === -1) {
    return res.status(403).json({ error: 'No permitido' });
  }
  var table = D().tables.filter(function (t) { return t.id === b.tableId; })[0];
  if (!table) return res.status(404).json({ error: 'Mesa no encontrada' });
  var notif = {
    id: uid('n_'), tableId: b.tableId, tableNumber: table.number,
    type: ['waiter', 'bill'].indexOf(b.type) !== -1 ? b.type : 'waiter',
    by: req.user.name, createdAt: Date.now(),
  };
  D().notifications.push(notif);
  save();
  res.status(201).json(notif);
}]);

apiRoute_('DELETE', '/api/notifications/:id', [minRank(2), function (req, res) {
  var db = D();
  var idx = -1;
  for (var i = 0; i < db.notifications.length; i++) {
    if (db.notifications[i].id === req.params.id) { idx = i; break; }
  }
  if (idx === -1) return res.status(404).json({ error: 'Notificación no encontrada' });
  db.notifications.splice(idx, 1);
  save();
  res.json({ ok: true });
}]);

/* ---------------- Usuarios ---------------- */
apiRoute_('GET', '/api/users', [minRank(4), function (req, res) {
  res.json(D().users.map(function (u) {
    var out = {};
    for (var k in u) if (k !== 'password') out[k] = u[k];
    return out;
  }));
}]);

apiRoute_('POST', '/api/users', [auth, requireRole('dueno'), function (req, res) {
  var b = req.body || {};
  if (!b.username || !b.password || !b.name || !b.role) return res.status(400).json({ error: 'Faltan datos' });
  if (!ROLE_RANK[b.role]) return res.status(400).json({ error: 'Rol no válido' });
  var dup = D().users.some(function (u) { return u.username === b.username; });
  if (dup) return res.status(400).json({ error: 'Ese usuario ya existe' });
  var user = { id: uid('u_'), username: b.username, password: b.password, name: b.name, role: b.role, active: true };
  D().users.push(user);
  save();
  var safe = {};
  for (var k in user) if (k !== 'password') safe[k] = user[k];
  res.status(201).json(safe);
}]);

apiRoute_('PATCH', '/api/users/:id', [auth, requireRole('dueno'), function (req, res) {
  var user = D().users.filter(function (u) { return u.id === req.params.id; })[0];
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  var b = req.body || {};
  if (b.name != null) user.name = b.name;
  if (b.role != null && ROLE_RANK[b.role]) user.role = b.role;
  if (b.password) user.password = b.password;
  if (b.active != null) user.active = !!b.active;
  save();
  var safe = {};
  for (var k in user) if (k !== 'password') safe[k] = user[k];
  res.json(safe);
}]);

/* ---------------- Reportes ---------------- */
apiRoute_('GET', '/api/reports/summary', [auth, soloReportes, function (req, res) {
  var db = D();
  var paid = db.orders.filter(function (o) { return o.status === 'pagado'; });

  var startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  var today = paid.filter(function (o) {
    return o.payments.some(function (p) { return p.at >= startOfDay.getTime(); });
  });

  var salesToday = today.reduce(function (s, o) { return s + totalOf(o); }, 0);
  var salesAll = paid.reduce(function (s, o) { return s + totalOf(o); }, 0);

  var byMethod = {};
  paid.forEach(function (o) {
    o.payments.forEach(function (p) { byMethod[p.method] = (byMethod[p.method] || 0) + p.amount; });
  });

  var productCount = {};
  paid.forEach(function (o) {
    o.items.forEach(function (i) {
      productCount[i.name] = productCount[i.name] || { name: i.name, qty: 0, revenue: 0 };
      productCount[i.name].qty += i.qty;
      productCount[i.name].revenue += i.qty * i.price;
    });
  });
  var topProducts = Object.keys(productCount)
    .map(function (k) { return productCount[k]; })
    .sort(function (a, b) { return b.qty - a.qty; })
    .slice(0, 5);

  var byHour = [];
  for (var h = 0; h < 24; h++) byHour.push(0);
  today.forEach(function (o) {
    o.payments.forEach(function (p) { byHour[new Date(p.at).getHours()] += p.amount; });
  });

  res.json({
    salesToday: salesToday,
    salesAll: salesAll,
    ordersToday: today.length,
    ordersTotal: paid.length,
    avgTicket: today.length ? salesToday / today.length : 0,
    byMethod: byMethod,
    topProducts: topProducts,
    byHour: byHour,
    openOrders: db.orders.filter(function (o) { return ['pagado', 'cancelado'].indexOf(o.status) === -1; }).length,
    tablesTotal: db.tables.length,
    tablesBusy: db.tables.filter(function (t) { return t.status === 'ocupada'; }).length,
    menuItems: db.menu.filter(function (m) { return m.available; }).length,
    staff: db.users.filter(function (u) { return u.active; }).length,
  });
}]);

