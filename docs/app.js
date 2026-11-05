/* ============================================================
   Restaurante QR — SPA con 6 perfiles:
   cliente, mesero, cocinero, cajero, encargado, dueño
   ============================================================ */

const S = {
  token: localStorage.getItem('qr_token') || null,
  user: null,
  table: null,
  tab: null,
  cart: [],
  orderType: null,        // 'sitio' | 'llevar'
  customerName: '',
  menu: [],
  modalOpen: false,
  poll: null,
  renderSeq: 0,
  lastHtml: null,
};

/* ---------------- Moneda: € (principal) + Bs. con tasa BCV ---------------- */
let RATE = null; // { tasa, fechaValor, fechaValorLegible, regla } desde /api/rates/euro
const eurFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const vesFmt = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const money = n => eurFmt.format(Number(n) || 0); // solo € (atributos, opciones, tooltips)
const bs = n => (RATE && RATE.tasa
  ? 'Bs. ' + vesFmt.format((Number(n) || 0) * RATE.tasa)
  : 'Bs. —');
// Bloque de precio: euros arriba (grande) y bolívares abajo (letra pequeña)
const price = n => `<span class="dual"><span class="price-eur">${money(n)}</span><span class="price-ves">${bs(n)}</span></span>`;

function rateBar() {
  if (!RATE || !RATE.tasa) return '';
  const tasa = new Intl.NumberFormat('es-VE', { maximumFractionDigits: 2 }).format(RATE.tasa);
  return `<div class="rate-bar" title="Tasa del euro del Banco Central de Venezuela (BCV) aplicable hoy">
    💱 1 € = Bs. ${tasa} · Tasa BCV${RATE.fechaValorLegible ? ' · fecha valor: ' + RATE.fechaValorLegible : ''}${RATE.regla ? ' · ' + RATE.regla : ''}</div>`;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS_LABEL = {
  nuevo: 'Nuevo', preparando: 'En preparación', listo: 'Listo',
  servido: 'Entregado', por_pagar: 'Por pagar', pagado: 'Pagado', cancelado: 'Cancelado',
};
const ROLE_LABEL = { cliente: 'Cliente', mesero: 'Mesero', cocinero: 'Cocinero', cajero: 'Cajero', encargado: 'Encargado', dueno: 'Dueño' };

// "Mesa 4" o "Para llevar · Ana", según el tipo de pedido
const destino = o => (o.orderType === 'llevar'
  ? `🛍️ Para llevar${o.customerName ? ' · ' + esc(o.customerName) : ''}`
  : `🪑 Mesa ${o.tableNumber}`);

function ago(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  return `hace ${Math.floor(m / 60)} h`;
}

/* ---------------- API (Google Apps Script) ---------------- */
const API_BASE = window.CHILOKOS_API || '';

async function api(path, { method = 'GET', body } = {}) {
  const [pathname, search] = String(path).split('?');
  const qs = new URLSearchParams(search || '');
  qs.set('path', '/api' + pathname);
  qs.set('_method', method);                        // todas viajan como POST (sin preflight CORS)
  if (S.token) qs.set('token', S.token);

  const res = await fetch(API_BASE + '?' + qs.toString(), {
    method: 'POST',                                  // simple request: sin preflight CORS
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  const status = data && data.__status;
  if (!res.ok || status >= 400) {
    if (status === 401 && S.token) clearSession();
    throw new Error((data && data.error) || ('Error ' + (status || res.status)));
  }
  return data;
}

/* ---------------- QR (generado en el navegador) ---------------- */
function makeQrSvg(text) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag(5, 4).replace(/fill="black"/g, 'fill="#0f172a"');
  } catch (e) {
    return '';
  }
}

function saveSession(token, user, table = null) {
  S.token = token; S.user = user; S.table = table;
  localStorage.setItem('qr_token', token);
}

function clearSession() {
  S.token = null; S.user = null; S.table = null; S.cart = [];
  S.orderType = null; S.customerName = '';
  localStorage.removeItem('qr_token');
}

/* ---------------- UI helpers ---------------- */
function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3400);
}

function openModal(html, wide = false) {
  S.modalOpen = true;
  let root = document.getElementById('modal-root');
  if (!root) { root = document.createElement('div'); root.id = 'modal-root'; document.body.appendChild(root); }
  root.innerHTML = `<div class="modal-backdrop" data-action="modal-backdrop">
    <div class="modal ${wide ? 'wide' : ''} card">${html}</div></div>`;
}
function closeModal() {
  S.modalOpen = false;
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
}
const chip = st => `<span class="chip ${st}">${STATUS_LABEL[st] || st}</span>`;

/* ---------------- Router ---------------- */
function parseHash() {
  const h = (location.hash || '#/').replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  if (parts[0] === 'mesa' && parts[1]) return { name: 'mesa', id: decodeURIComponent(parts[1]) };
  if (parts[0] === 'carta') return { name: 'carta' };
  if (parts[0] === 'login') return { name: 'login' };
  return { name: 'app' };
}

async function route() {
  const r = parseHash();
  stopPoll();

  if (r.name === 'mesa') {
    // Escaneo del QR: entrar como cliente de esa mesa
    // Si hay token guardado pero aún no se valida (p. ej. tras recargar), consultar /me
    if (S.token && !S.user) {
      try {
        const me = await api('/me');
        S.user = me.user; S.table = me.table;
      } catch (e) {
        clearSession();               // token vencido: se crea sesión de invitado
      }
    }
    if (!S.token || (S.user && S.user.role === 'cliente' && S.user.tableId !== r.id)) {
      try {
        const data = await api('/guest', { method: 'POST', body: { tableId: r.id } });
        saveSession(data.token, data.user, data.table);
        S.tab = 'menu';
      } catch (e) {
        toast(e.message, 'err');
        location.hash = '#/login';
        return;
      }
    } else if (S.user && S.user.role !== 'cliente') {
      // Un miembro del personal abrió un QR: va a su panel
      toast('Estás logueado como ' + (ROLE_LABEL[S.user.role] || S.user.role) + '. Abriendo tu panel.');
      location.hash = '#/app';
      return;
    } else if (S.user && S.user.role === 'cliente' && S.user.tableId === r.id) {
      if (!S.tab) S.tab = 'menu';
    }
    startPoll();
    return render();
  }

  if (r.name === 'carta') {
    // Carta pública: ver el menú y pedir para llevar, sin mesa ni cuenta
    if (S.token && !S.user) {
      try { const me = await api('/me'); S.user = me.user; S.table = me.table; }
      catch (e) { clearSession(); }
    }
    if (S.user && S.user.role !== 'cliente') {
      toast('Estás logueado como ' + (ROLE_LABEL[S.user.role] || S.user.role) + '. Abriendo tu panel.');
      location.hash = '#/app';
      return;
    }
    if (!S.token) {
      try {
        const data = await api('/guest', { method: 'POST', body: {} });
        saveSession(data.token, data.user, null);
      } catch (e) {
        toast(e.message, 'err');
        location.hash = '#/login';
        return;
      }
    }
    S.orderType = S.orderType || (S.table ? 'sitio' : 'llevar');
    if (!S.tab || S.tab === 'mesa') S.tab = 'menu';
    if (!S.tab) S.tab = 'menu';
    startPoll();
    return render();
  }

  if (r.name === 'login') { clearSession(); return renderLogin(); }

  // #/app
  if (!S.token) { location.hash = '#/login'; return; }
  try {
    const me = await api('/me');
    S.user = me.user; S.table = me.table;
    if (!S.tab) S.tab = defaultTab(me.user.role);
    startPoll();
    render();
  } catch (e) {
    location.hash = '#/login';
  }
}

const TABS = {
  cliente: [['menu', '🍽️ Mi menú'], ['pedido', '📋 Mi pedido'], ['mesa', '🔔 Mi mesa']],
  mesero: [['mesas', '🪑 Mesas'], ['pedidos', '🧾 Pedidos'], ['llamados', '🔔 Llamados']],
  cocinero: [['cocina', '👨‍🍳 Cocina']],
  cajero: [['cobrar', '💰 Por cobrar'], ['cobrados', '✅ Cobrados']],
  encargado: [['resumen', '📊 Resumen'], ['pedidos', '🧾 Pedidos'], ['menu', '📖 Menú'], ['mesas', '🪑 Mesas y QR'], ['llamados', '🔔 Llamados']],
  dueno: [['dashboard', '📊 Dashboard'], ['reportes', '📈 Reportes'], ['pedidos', '🧾 Pedidos'], ['menu', '📖 Menú'], ['mesas', '🪑 Mesas y QR'], ['personal', '👥 Personal']],
};
const defaultTab = role => (TABS[role] || TABS.cliente)[0][0];

/* ---------------- Render principal ---------------- */
async function render() {
  const seq = ++S.renderSeq;
  const r = parseHash();

  if (!S.user) return renderLogin();

  // Cliente (mesa escaneada)
  if (S.user.role === 'cliente') {
    if (!S.tab) S.tab = 'menu';
    const html = await buildCliente(seq);
    if (seq !== S.renderSeq) return;
    return paint(html);
  }

  // Personal
  if (!S.tab || !TABS[S.user.role].some(t => t[0] === S.tab)) S.tab = defaultTab(S.user.role);
  const html = await buildStaff(seq);
  if (seq !== S.renderSeq) return;
  paint(html);
}

function paint(html) {
  if (html === S.lastHtml) return;   // mismo contenido: no repintamos (conserva scroll, foco y evita parpadeo)
  S.lastHtml = html;
  document.getElementById('app').innerHTML = html;
  // Los QR se cargan/pintan después del render de la vista "Mesas y QR"
  if (html.includes('id="qr-grid"')) setTimeout(loadQrCards, 50);
}

function topbar() {
  const notifBadge = S.notifCount ? ` <span class="badge" style="background:var(--red);color:#fff">${S.notifCount}</span>` : '';
  const lugar = S.table
    ? `<span class="chip sitio">🪑 Mesa ${S.table.number}</span>`
    : (S.user.role === 'cliente' ? '<span class="chip llevar">🛍️ Para llevar</span>' : '');
  return `<div class="topbar">
    <div class="brand"><span class="logo">🌮</span>
      <span class="brand-text"><strong>Chilokos</strong><small>tacos · birria · flautas</small></span>
    </div>
    <div class="who">
      ${lugar}
      <span>${esc(S.user.name)}</span>
      <span class="badge ${S.user.role}">${ROLE_LABEL[S.user.role]}</span>
      ${notifBadge}
      <button class="btn small secondary" data-action="logout">Salir</button>
    </div>
  </div>${rateBar()}`;
}

function navBar() {
  const tabs = TABS[S.user.role] || [];
  return `<div class="nav">${tabs.map(([id, label]) =>
    `<button class="${S.tab === id ? 'active' : ''}" data-action="tab" data-tab="${id}">${label}</button>`).join('')}</div>`;
}

/* ============================================================
   CLIENTE (entra escaneando el QR de su mesa)
   ============================================================ */
/* ---------------- Carrito: se actualiza en local, sin volver a pedir datos ---------------- */
function cartTotals() {
  let qty = 0, total = 0;
  for (const i of S.cart) {
    qty += i.qty;
    const m = S.menu.find(x => x.id === i.menuId);
    if (m) total += m.price * i.qty;
  }
  return { qty, total };
}

const cartFab = () => {
  const { qty, total } = cartTotals();
  return qty
    ? `<button class="btn cart-fab" data-action="open-cart">🛒 ${qty} platillo(s) · ${price(total)} — Ver pedido</button>`
    : '';
};

function syncCart() {
  document.querySelectorAll('[data-qty]').forEach(el => {
    const line = S.cart.find(i => i.menuId === el.dataset.qty);
    el.textContent = line ? line.qty : 0;
  });
  const slot = document.getElementById('cart-fab-slot');
  if (slot) slot.innerHTML = cartFab();
  if (S.modalOpen) rebuildCartModal();
}

async function buildCliente(seq) {
  // Solo se piden los datos que la pestaña necesita, y en paralelo
  const [menu, orders] = await Promise.all([
    api('/menu'),
    S.tab === 'pedido' ? api('/orders') : Promise.resolve([]),
  ]);
  if (seq !== S.renderSeq) return '';
  S.menu = menu;

  if (!S.table && S.tab === 'mesa') S.tab = 'menu';
  const tabs = S.table ? TABS.cliente : TABS.cliente.filter(([id]) => id !== 'mesa');
  const body =
    S.tab === 'pedido' ? clientePedido(orders)
    : S.tab === 'mesa' ? clienteMesa()
    : clienteMenu(menu);

  return `<div class="shell">
    ${topbar()}
    <div class="nav">${tabs.map(([id, label]) =>
      `<button class="${S.tab === id ? 'active' : ''}" data-action="tab" data-tab="${id}">${label}</button>`).join('')}</div>
    ${body}
    <div id="cart-fab-slot">${cartFab()}</div>
  </div>`;
}

let catActiva = 'Todos';
function clienteMenu(menu) {
  const cats = ['Todos', ...new Set(menu.map(m => m.category))];
  const items = catActiva === 'Todos' ? menu : menu.filter(m => m.category === catActiva);
  return `
    <div class="cat-tabs">${cats.map(c =>
      `<button class="${c === catActiva ? 'active' : ''}" data-action="cat" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div class="grid cols-2">
      ${items.map(m => {
        const inCart = S.cart.find(i => i.menuId === m.id);
        return `<div class="card dish">
          <div class="emoji">${m.emoji}</div>
          <div class="info">
            <div class="name">${esc(m.name)}</div>
            <div class="desc">${esc(m.description)}</div>
            <div class="dish-add">
              <div class="qty-ctrl">
                <button data-action="cart-dec" data-id="${m.id}">−</button>
                <span data-qty="${m.id}">${inCart ? inCart.qty : 0}</span>
                <button data-action="cart-inc" data-id="${m.id}">+</button>
              </div>
              <span class="price">${price(m.price)}</span>
            </div>
          </div>
        </div>`;
      }).join('') || `<div class="empty"><span class="big">🍽️</span>No hay platillos en esta categoría</div>`}
    </div>`;
}

function clientePedido(orders) {
  const activos = orders.filter(o => !['pagado', 'cancelado'].includes(o.status));
  const historial = orders.filter(o => ['pagado', 'cancelado'].includes(o.status));
  if (!orders.length) {
    return `<div class="empty"><span class="big">🧾</span>Aún no has hecho un pedido.<br/>
      <br/><button class="btn" data-action="tab" data-tab="menu">Ver el menú</button></div>`;
  }
  const card = o => `<div class="card" style="margin-bottom:12px">
    <div class="row">
      <strong>Pedido #${o.id}</strong> ${chip(o.status)}
      ${o.orderType === 'llevar' ? '<span class="chip llevar">🛍️ Para llevar</span>' : '<span class="chip sitio">🍽️ En el sitio</span>'}
      <span class="spacer"></span>
      <span class="muted">${ago(o.createdAt)}</span>
    </div>
    <div style="margin-top:10px">
      ${o.items.map(i => `<div class="cart-line"><span>${i.emoji} ${i.qty}× ${esc(i.name)}</span><span>${price(i.price * i.qty)}</span></div>`).join('')}
    </div>
    <div class="cart-total"><span>Total</span><span>${price(o.total)}</span></div>
    <div class="row" style="margin-top:12px">
      ${o.status === 'listo' ? `<span class="muted">Tu pedido está listo, pronto lo tendremos contigo 🙌</span>` : ''}
      ${o.status === 'servido' ? `<button class="btn green small" data-action="ask-bill">🧾 Pedir la cuenta</button>` : ''}
      ${o.status === 'por_pagar' ? `<span class="muted">Esperando al cajero…</span>` : ''}
      ${o.status === 'preparando' ? `<span class="muted">En cocina 👨‍🍳</span>` : ''}
      ${o.status === 'nuevo' ? `<span class="muted">Esperando confirmación de cocina…</span>` : ''}
    </div>
  </div>`;
  return `
    <div class="section-title">Pedidos activos</div>
    ${activos.map(card).join('') || '<div class="empty">Sin pedidos activos</div>'}
    ${historial.length ? `<div class="section-title">Historial</div>${historial.map(card).join('')}` : ''}`;
}

function clienteMesa() {
  return `<div class="grid cols-2">
    <div class="card" style="text-align:center">
      <div style="font-size:46px">🪑</div>
      <h3>Mesa ${S.table ? S.table.number : '—'}</h3>
      <p class="muted">${S.table ? S.table.seats + ' asientos' : ''}</p>
    </div>
    <div class="card">
      <h3>¿Necesitas algo?</h3>
      <p class="muted" style="margin-bottom:12px">Usa estos botones y el personal recibirá tu solicitud al instante.</p>
      <div class="grid" style="gap:10px">
        <button class="btn block" data-action="call-waiter">🔔 Llamar al mesero</button>
        <button class="btn green block" data-action="ask-bill">🧾 Pedir la cuenta</button>
        <button class="btn secondary block" data-action="tab" data-tab="pedido">📋 Ver mis pedidos</button>
      </div>
    </div>
  </div>`;
}

// 'sitio' si está en una mesa; 'llevar' si entró por la carta pública
function orderTypeActual() {
  return S.orderType || (S.table ? 'sitio' : 'llevar');
}

// Repinta el modal conservando el nombre y las notas ya escritas
function rebuildCartModal() {
  const notes = document.getElementById('order-notes');
  const name = document.getElementById('order-name');
  const vals = { notes: notes ? notes.value : '', name: name ? name.value : '' };
  const focusId = document.activeElement ? document.activeElement.id : '';
  cartModal();
  const n = document.getElementById('order-notes');
  const nm = document.getElementById('order-name');
  if (n) n.value = vals.notes;
  if (nm && vals.name) nm.value = vals.name;
  if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus();
}

function cartModal() {
  const lines = S.cart.map(i => {
    const m = S.menu.find(x => x.id === i.menuId);
    if (!m) return '';
    return `<div class="cart-line">
      <span>${m.emoji} ${esc(m.name)}</span>
      <span class="qty-ctrl">
        <button data-action="cart-dec" data-id="${m.id}">−</button>
        <span>${i.qty}</span>
        <button data-action="cart-inc" data-id="${m.id}">+</button>
      </span>
      <strong>${price(m.price * i.qty)}</strong>
    </div>`;
  }).join('');
  const total = S.cart.reduce((s, i) => {
    const m = S.menu.find(x => x.id === i.menuId);
    return s + (m ? m.price * i.qty : 0);
  }, 0);
  const tipo = orderTypeActual();
  openModal(`
    <h2>🛒 Tu pedido${S.table ? ' — Mesa ' + S.table.number : ''}</h2>
    ${lines || '<div class="empty">Tu carrito está vacío</div>'}
    <div class="field" style="margin-top:14px">
      <label>¿Cómo lo quieres?</label>
      <div class="seg">
        <button class="seg-opt ${tipo === 'sitio' ? 'active' : ''}" data-action="order-type" data-type="sitio"
          ${S.table ? '' : 'disabled title="Escanea el QR de tu mesa para comer en el sitio"'}>🍽️ Comer aquí</button>
        <button class="seg-opt ${tipo === 'llevar' ? 'active' : ''}" data-action="order-type" data-type="llevar">🛍️ Para llevar</button>
      </div>
      ${S.table ? '' : '<div class="muted" style="margin-top:6px;font-size:12px">Los pedidos para llevar se recogen y se pagan en caja.</div>'}
    </div>
    ${tipo === 'llevar' && !S.table ? `
    <div class="field">
      <label>¿A nombre de quién?</label>
      <input id="order-name" maxlength="40" placeholder="Tu nombre" value="${esc(S.customerName || '')}"/>
    </div>` : ''}
    <div class="field">
      <label>Notas para cocina (opcional)</label>
      <input id="order-notes" placeholder="Ej: sin cebolla, salsa aparte…" maxlength="300"/>
    </div>
    <div class="cart-total"><span>Total</span><span>${price(total)}</span></div>
    <div class="actions">
      <button class="btn secondary" data-action="close-modal">Seguir pidiendo</button>
      <button class="btn green" data-action="send-order" ${S.cart.length ? '' : 'disabled'}>✅ Enviar pedido</button>
    </div>`);
}

/* ============================================================
   STAFF (mesero, cocinero, cajero, encargado, dueño)
   ============================================================ */
async function buildStaff(seq) {
  const role = S.user.role;
  const isStaff = ['mesero', 'encargado', 'dueno'].includes(role);
  const isAdmin = ['encargado', 'dueno'].includes(role);
  const tab = S.tab;

  // Cada pestaña pide solo lo que muestra, y todo en paralelo
  // (antes: hasta 5 peticiones encadenadas en cada refresco de 6 s)
  const needTables = isStaff && tab === 'mesas';
  const needNotifs = isStaff;
  const needMenu = isAdmin && tab === 'menu';
  const needSummary = (role === 'encargado' && tab === 'resumen')
    || (role === 'dueno' && ['dashboard', 'reportes'].includes(tab));

  const [tables, orders, notifs, menu, summary] = await Promise.all([
    needTables ? api('/tables') : null,
    api('/orders'),
    needNotifs ? api('/notifications') : null,
    needMenu ? api('/menu') : null,
    needSummary ? api('/reports/summary') : null,
  ]);
  if (seq !== S.renderSeq) return '';

  const data = { orders };
  if (tables) data.tables = tables;
  if (menu) data.menu = menu;
  if (summary) data.summary = summary;
  if (notifs) data.notifs = notifs;
  S.notifCount = notifs ? notifs.length : 0;

  let body = '';
  switch (role) {
    case 'mesero': body = meseroView(S.tab, data); break;
    case 'cocinero': body = cocineroView(data); break;
    case 'cajero': body = cajeroView(S.tab, data); break;
    case 'encargado': body = encargadoView(S.tab, data); break;
    case 'dueno': body = await duenoView(S.tab, data); break;
  }
  return `<div class="shell">${topbar()}${role === 'cocinero' ? '' : navBar()}${body}</div>`;
}

/* ---------------- MESERO ---------------- */
function meseroView(tab, data) {
  if (tab === 'mesas') return mesasGrid(data.tables, data.orders);
  if (tab === 'llamados') return llamadosView(data.notifs);
  return pedidosView(data.orders, true);
}

function mesasGrid(tables, orders) {
  return `<div class="section-title">Mesas <span class="muted">${tables.filter(t => t.status === 'ocupada').length} ocupadas de ${tables.length}</span></div>
  <div class="grid cols-4">
    ${tables.map(t => {
      const pend = orders.filter(o => o.tableId === t.id && !['pagado', 'cancelado'].includes(o.status));
      const total = pend.reduce((s, o) => s + o.total, 0);
      return `<div class="card table-card" data-action="open-table" data-id="${t.id}" style="cursor:pointer">
        <div class="num">${t.number}</div>
        <div class="seats">🪑 ${t.seats} asientos</div>
        <span class="chip ${t.status}">${t.status}</span>
        ${total ? `<div class="pend">${price(total)} pendiente</div>` : ''}
        ${pend.length ? `<div class="muted">${pend.length} pedido(s) activo(s)</div>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

function tableModal(tableId, tables, orders) {
  const t = tables.find(x => x.id === tableId);
  if (!t) return;
  const act = orders.filter(o => o.tableId === tableId && !['pagado', 'cancelado'].includes(o.status));
  const total = act.reduce((s, o) => s + o.total, 0);
  openModal(`
    <h2>🪑 Mesa ${t.number} ${chip(t.status)}</h2>
    <p class="muted">Asientos: ${t.seats} · Pendiente: <strong style="color:var(--accent-2)">${price(total)}</strong></p>
    <div style="margin-top:12px">
      ${act.map(o => `<div class="ticket">
        <div class="head"><span>Pedido #${o.id} · ${esc(o.createdBy)}</span>${chip(o.status)}</div>
        <ul>${o.items.map(i => `<li><span class="q">${i.qty}×</span> ${i.emoji} ${esc(i.name)}</li>`).join('')}</ul>
        <div class="actions">
          ${o.status === 'listo' ? `<button class="btn green small" data-action="set-status" data-id="${o.id}" data-status="servido">✅ Entregar</button>` : ''}
          ${!['pagado', 'cancelado'].includes(o.status) ? `<button class="btn blue small" data-action="add-items" data-id="${o.id}">➕ Agregar platillos</button>` : ''}
        </div>
      </div>`).join('') || '<div class="empty">Sin pedidos activos en esta mesa</div>'}
    </div>
    <div class="actions">
      <button class="btn secondary" data-action="close-modal">Cerrar</button>
    </div>`, true);
}

/* ---------------- PEDIDOS (lista común) ---------------- */
function pedidosView(orders, withServe) {
  if (!orders.length) return `<div class="empty"><span class="big">🧾</span>No hay pedidos por ahora</div>`;
  return `<div class="section-title">Pedidos</div>
  <div class="grid cols-2">
    ${orders.map(o => `<div class="card">
      <div class="row">
        <strong>#${o.id} · ${destino(o)}</strong> ${chip(o.status)}
        <span class="spacer"></span><span class="muted">${ago(o.createdAt)}</span>
      </div>
      <div class="muted" style="margin-top:4px">Por ${esc(o.createdBy)}</div>
      <div style="margin-top:10px">
        ${o.items.map(i => `<div class="cart-line"><span>${i.emoji} ${i.qty}× ${esc(i.name)}</span><span>${price(i.price * i.qty)}</span></div>`).join('')}
      </div>
      ${o.notes ? `<div class="notes" style="color:var(--cyan);font-size:13px;margin-top:6px">📝 ${esc(o.notes)}</div>` : ''}
      <div class="cart-total"><span>Total</span><span>${price(o.total)}</span></div>
      <div class="row" style="margin-top:10px">
        ${withServe && o.status === 'listo' ? `<button class="btn green small" data-action="set-status" data-id="${o.id}" data-status="servido">✅ Marcar entregado</button>` : ''}
        ${withServe && !['pagado', 'cancelado'].includes(o.status) ? `<button class="btn blue small" data-action="add-items" data-id="${o.id}">➕ Agregar</button>` : ''}
        ${S.user.role !== 'mesero' && !['pagado', 'cancelado'].includes(o.status) ? `<button class="btn red small" data-action="cancel-order" data-id="${o.id}">✖ Cancelar</button>` : ''}
      </div>
    </div>`).join('')}
  </div>`;
}

/* ---------------- COCINERO ---------------- */
function cocineroView(data) {
  const cols = [
    ['nuevo', '🆕 Nuevos', 'blue'],
    ['preparando', '🔥 En preparación', 'orange'],
    ['listo', '✅ Listos para entregar', 'green'],
  ];
  const open = data.orders.filter(o => ['nuevo', 'preparando', 'listo'].includes(o.status));
  return `<div class="section-title">👨‍🍳 Panel de cocina <span class="muted">${open.length} pedido(s) en curso</span></div>
  <div class="kanban">
    ${cols.map(([st, title]) => {
      const list = open.filter(o => o.status === st);
      return `<div class="kanban-col">
        <h3>${title} <span class="count">${list.length}</span></h3>
        ${list.map(o => `<div class="ticket">
          <div class="head"><span>#${o.id} · ${destino(o)}</span><span>${ago(o.createdAt)}</span></div>
          <ul>
            ${o.items.map(i => `<li><span class="q">${i.qty}×</span> <span>${i.emoji} ${esc(i.name)}</span></li>
              ${i.notes ? `<div class="notes">↳ ${esc(i.notes)}</div>` : ''}`).join('')}
          </ul>
          ${o.notes ? `<div class="notes">📝 ${esc(o.notes)}</div>` : ''}
          <div class="actions">
            ${st === 'nuevo' ? `<button class="btn blue block small" data-action="set-status" data-id="${o.id}" data-status="preparando">👨‍🍳 Empezar a preparar</button>` : ''}
            ${st === 'preparando' ? `<button class="btn green block small" data-action="set-status" data-id="${o.id}" data-status="listo">🔔 Marcar listo</button>` : ''}
            ${st === 'listo' ? `<span class="muted">Esperando al mesero…</span>` : ''}
          </div>
        </div>`).join('') || '<div class="empty">Vacío</div>'}
      </div>`;
    }).join('')}
  </div>`;
}

/* ---------------- CAJERO ---------------- */
function cajeroView(tab, data) {
  const paid = data.orders.filter(o => o.status === 'pagado');
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const today = paid.filter(o => o.payments.some(p => p.at >= todayStart.getTime()));
  const todayTotal = today.reduce((s, o) => s + o.total, 0);

  if (tab === 'cobrados') {
    return `<div class="section-title">✅ Cobrados hoy <span class="chip pagado">${price(todayTotal)}</span></div>
    ${today.length ? `<div class="card"><table class="data">        <tr><th>#</th><th>Mesa</th><th>Método</th><th>Hora</th><th>Total</th></tr>
      ${today.map(o => `<tr>
        <td>${o.id}</td><td>${o.orderType === 'llevar' ? 'Llevar' : o.tableNumber}</td>
        <td>${o.payments.map(p => p.method).join(', ')}</td>
        <td>${new Date(o.payments[o.payments.length - 1].at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</td>
        <td><strong>${price(o.total)}</strong></td>
      </tr>`).join('')}
    </table></div>` : '<div class="empty"><span class="big">💰</span>Aún no hay cobros hoy</div>'}`;
  }

  const porCobrar = data.orders.filter(o => ['servido', 'por_pagar'].includes(o.status));
  return `<div class="section-title">💰 Por cobrar <span class="muted">${porCobrar.length} pedido(s)</span></div>
  ${porCobrar.length ? `<div class="grid cols-2">
    ${porCobrar.map(o => `<div class="card">
      <div class="row"><strong>#${o.id} · ${destino(o)}</strong> ${chip(o.status)}
        <span class="spacer"></span><span class="muted">${ago(o.createdAt)}</span></div>
      <div style="margin-top:8px">
        ${o.items.map(i => `<div class="cart-line"><span>${i.qty}× ${esc(i.name)}</span><span>${price(i.price * i.qty)}</span></div>`).join('')}
      </div>
      <div class="cart-total"><span>Total</span><span>${price(o.total)}</span></div>
      <button class="btn green block" style="margin-top:12px" data-action="pay-order" data-id="${o.id}">💵 Cobrar ${price(o.total)}</button>
    </div>`).join('')}
  </div>` : `<div class="empty"><span class="big">✅</span>No hay pedidos pendientes de cobro</div>`}

  <div class="section-title">Resumen del día</div>
  <div class="grid cols-3">
    <div class="card stat"><div class="value">${price(todayTotal)}</div><div class="label">Ventas de hoy</div></div>
    <div class="card stat"><div class="value">${today.length}</div><div class="label">Pedidos cobrados</div></div>
    <div class="card stat"><div class="value">${paid.length}</div><div class="label">Histórico cobrado</div></div>
  </div>`;
}

function payModal(orderId) {
  const o = S._ordersCache && S._ordersCache.find(x => x.id === Number(orderId));
  if (!o) return;
  openModal(`
    <h2>💵 Cobrar pedido #${o.id} — ${destino(o)}</h2>
    <div class="cart-line"><span>Subtotal (platillos)</span><strong>${price(o.total)}</strong></div>
    <div class="cart-total"><span>Total a pagar</span><span>${price(o.total)}</span></div>
    <div class="field" style="margin-top:16px">
      <label>Método de pago</label>
      <select id="pay-method">
        <option value="efectivo">Efectivo</option>
        <option value="tarjeta">Tarjeta</option>
        <option value="transferencia">Transferencia</option>
        <option value="qr">Pago con QR / móvil</option>
      </select>
    </div>
    <div class="field" id="cash-field">
      <label>Recibido (efectivo)</label>
      <input id="pay-amount" type="number" min="0" step="0.01" value="${o.total.toFixed(2)}"/>
      <div class="muted" id="change-line" style="margin-top:6px"></div>
    </div>
    <div class="actions">
      <button class="btn secondary" data-action="close-modal">Cancelar</button>
      <button class="btn green" data-action="confirm-pay" data-id="${o.id}">✅ Confirmar pago</button>
    </div>`);
  const amt = document.getElementById('pay-amount');
  const upd = () => {
    const v = Number(amt.value || 0);
    document.getElementById('change-line').innerHTML =
      v >= o.total ? `Cambio: ${price(v - o.total)}` : `Faltan ${price(o.total - v)}`;
  };
  amt.addEventListener('input', upd); upd();
  document.getElementById('pay-method').addEventListener('change', e => {
    document.getElementById('cash-field').style.display = e.target.value === 'efectivo' ? '' : 'none';
  });
}

/* ---------------- ENCARGADO ---------------- */
function encargadoView(tab, data) {
  if (tab === 'resumen') return resumenView(data.summary, false);
  if (tab === 'pedidos') return pedidosView(data.orders, false);
  if (tab === 'menu') return menuAdminView(data.menu, false);
  if (tab === 'mesas') return mesasQrView(data.tables, data.orders);
  if (tab === 'llamados') return llamadosView(data.notifs);
  return '';
}

function resumenView(s, full) {
  return `<div class="grid cols-4">
    <div class="card stat"><div class="value">${s.openOrders}</div><div class="label">Pedidos activos</div></div>
    <div class="card stat"><div class="value">${s.tablesBusy}/${s.tablesTotal}</div><div class="label">Mesas ocupadas</div></div>
    <div class="card stat"><div class="value">${price(s.salesToday)}</div><div class="label">Ventas de hoy</div></div>
    <div class="card stat"><div class="value">${s.staff}</div><div class="label">Personal activo</div></div>
  </div>
  <div class="section-title">Estado del restaurante</div>
  <div class="grid cols-3">
    <div class="card"><h3>🧾 Pedidos</h3><p class="muted">Hoy: ${s.ordersToday} · Histórico: ${s.ordersTotal}</p></div>
    <div class="card"><h3>📖 Menú</h3><p class="muted">${s.menuItems} platillos disponibles</p></div>
    <div class="card"><h3>💳 Ticket promedio</h3><p class="muted">${price(s.avgTicket)} por pedido de hoy</p></div>
  </div>`;
}

/* ---------------- DUEÑO ---------------- */
async function duenoView(tab, data) {
  if (tab === 'dashboard') {
    data.summary = data.summary || await api('/reports/summary');
    return resumenView(data.summary, true) + `
      <div class="section-title">🏆 Top platillos</div>
      <div class="card"><table class="data">
        <tr><th>Platillo</th><th>Vendidos</th><th>Ingresos</th></tr>
        ${data.summary.topProducts.map(p => `<tr><td>${esc(p.name)}</td><td>${p.qty}</td><td>${price(p.revenue)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Sin ventas aún</td></tr>'}
      </table></div>`;
  }
  if (tab === 'reportes') {
    const r = data.summary || await api('/reports/summary');
    const maxH = Math.max(...r.byHour, 1);
    return `<div class="grid cols-4">
      <div class="card stat"><div class="value">${price(r.salesToday)}</div><div class="label">Ventas hoy</div></div>
      <div class="card stat"><div class="value">${price(r.salesAll)}</div><div class="label">Ventas históricas</div></div>
      <div class="card stat"><div class="value">${r.ordersToday}</div><div class="label">Pedidos hoy</div></div>
      <div class="card stat"><div class="value">${price(r.avgTicket)}</div><div class="label">Ticket promedio</div></div>
    </div>
    <div class="section-title">Ventas por método de pago</div>
    <div class="card"><table class="data">
      <tr><th>Método</th><th>Total</th></tr>
      ${Object.entries(r.byMethod).map(([m, v]) => `<tr><td>${esc(m)}</td><td>${price(v)}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">Sin datos</td></tr>'}
    </table></div>
    <div class="section-title">Ventas por hora (hoy)</div>
    <div class="card">
      <div style="display:flex;align-items:flex-end;gap:4px;height:140px">
        ${r.byHour.map((v, h) => `<div title="${h}:00 — ${money(v)}" style="flex:1;height:${Math.max(3, (v / maxH) * 100)}%;background:${v ? 'var(--accent)' : 'var(--bg-3)'};border-radius:4px 4px 0 0"></div>`).join('')}
      </div>
      <div class="muted" style="display:flex;justify-content:space-between;margin-top:6px"><span>0h</span><span>12h</span><span>23h</span></div>
    </div>
    <div class="section-title">🏆 Top 5 platillos</div>
    <div class="card"><table class="data">
      <tr><th>Platillo</th><th>Vendidos</th><th>Ingresos</th></tr>
      ${r.topProducts.map(p => `<tr><td>${esc(p.name)}</td><td>${p.qty}</td><td>${price(p.revenue)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Sin ventas aún</td></tr>'}
    </table></div>`;
  }
  if (tab === 'pedidos') return pedidosView(data.orders, false);
  if (tab === 'menu') return menuAdminView(data.menu, true);
  if (tab === 'mesas') return mesasQrView(data.tables, data.orders);
  if (tab === 'personal') return personalView(await api('/users'));
  return '';
}

/* ---------------- MENÚ (admin) ---------------- */
function menuAdminView(menu, canDelete) {
  const cats = [...new Set(menu.map(m => m.category))];
  return `<div class="section-title">📖 Menú
    <button class="btn small" data-action="menu-new">➕ Nuevo platillo</button></div>
  ${cats.map(c => `<div class="section-title" style="font-size:16px">${esc(c)}</div>
    <div class="card"><table class="data">
      <tr><th></th><th>Platillo</th><th>Precio</th><th>Disponible</th><th></th></tr>
      ${menu.filter(m => m.category === c).map(m => `<tr>
        <td style="font-size:22px">${m.emoji}</td>
        <td><strong>${esc(m.name)}</strong><div class="muted">${esc(m.description)}</div></td>
        <td>${price(m.price)}</td>
        <td><span class="chip ${m.available ? 'pagado' : 'cancelado'}">${m.available ? 'Sí' : 'No'}</span></td>
        <td class="row" style="justify-content:flex-end">
          <button class="btn small secondary" data-action="menu-edit" data-id="${m.id}">✏️</button>
          <button class="btn small ${m.available ? 'red' : 'green'}" data-action="menu-toggle" data-id="${m.id}">${m.available ? 'Ocultar' : 'Activar'}</button>
          ${canDelete ? `<button class="btn small ghost" data-action="menu-delete" data-id="${m.id}">🗑️</button>` : ''}
        </td>
      </tr>`).join('')}
    </table></div>`).join('') || '<div class="empty">Menú vacío</div>'}`;
}

function menuModal(item) {
  const m = item || { name: '', price: '', category: '', emoji: '🍽️', description: '' };
  openModal(`
    <h2>${item ? '✏️ Editar platillo' : '➕ Nuevo platillo'}</h2>
    <div class="field"><label>Nombre *</label><input id="m-name" value="${esc(m.name)}" maxlength="80"/></div>
    <div class="row">
      <div class="field" style="flex:1"><label>Precio *</label><input id="m-price" type="number" min="0" step="0.01" value="${m.price}"/></div>
      <div class="field" style="width:90px"><label>Emoji</label><input id="m-emoji" value="${esc(m.emoji)}" maxlength="4"/></div>
    </div>
    <div class="field"><label>Categoría</label><input id="m-cat" value="${esc(m.category)}" list="cats" maxlength="40"/>
      <datalist id="cats"><option>Entradas</option><option>Platos fuertes</option><option>Bebidas</option><option>Postres</option></datalist></div>
    <div class="field"><label>Descripción</label><input id="m-desc" value="${esc(m.description)}" maxlength="120"/></div>
    <div class="actions">
      <button class="btn secondary" data-action="close-modal">Cancelar</button>
      <button class="btn" data-action="menu-save" data-id="${item ? item.id : ''}">💾 Guardar</button>
    </div>`);
}

/* ---------------- MESAS Y QR ---------------- */
function mesasQrView(tables, orders) {
  const canQr = ['encargado', 'dueno'].includes(S.user.role);
  return `<div class="section-title">🪑 Mesas
    <button class="btn small" data-action="table-new">➕ Nueva mesa</button></div>
  <div class="grid cols-4" style="margin-bottom:24px">
    ${tables.map(t => {
      const act = orders.filter(o => o.tableId === t.id && !['pagado', 'cancelado'].includes(o.status));
      return `<div class="card table-card">
        <div class="num">${t.number}</div>
        <div class="seats">🪑 ${t.seats} asientos</div>
        <span class="chip ${t.status}">${t.status}</span>
        ${act.length ? `<div class="pend">${price(act.reduce((s, o) => s + o.total, 0))} pendiente</div>` : ''}
        <div class="row" style="justify-content:center;margin-top:10px">
          <button class="btn small secondary" data-action="table-edit" data-id="${t.id}">✏️</button>
          <button class="btn small ghost" data-action="table-delete" data-id="${t.id}">🗑️</button>
        </div>
      </div>`;
    }).join('')}
  </div>
  ${canQr ? `<div class="section-title">📱 Códigos QR por mesa <span class="muted">Escanea desde la mesa para pedir</span></div>
  <div class="grid cols-4" id="qr-grid">
    ${tables.map(t => `<div class="card qr-card" id="qr-${t.id}">
      <h3>Mesa ${t.number}</h3>
      <div class="muted">Generando…</div>
      <div class="actions" style="justify-content:center">
        <button class="btn small secondary" data-action="qr-print" data-id="${t.id}">🖨️ Imprimir</button>
        <button class="btn small ghost" data-action="qr-download" data-id="${t.id}">⬇️ SVG</button>
      </div>
    </div>`).join('')}
  </div>` : ''}`;
}

async function loadQrCards() {
  if (!['encargado', 'dueno'].includes(S.user?.role)) return;
  S.qrCache = S.qrCache || {};
  const cards = [...document.querySelectorAll('[id^="qr-mesa"]')];
  const base = location.origin + location.pathname.replace(/index\.html$/, '');
  for (const el of cards) {
    const id = el.id.replace('qr-', '');
    try {
      if (!S.qrCache[id]) {
        // La URL es determinista: no hace falta pedirla al backend.
        const url = `${base}#/mesa/${encodeURIComponent(id)}`;
        S.qrCache[id] = { url, svg: makeQrSvg(url) };
      }
      const q = S.qrCache[id];
      const holder = el.querySelector('.muted');
      if (holder) holder.outerHTML = `${q.svg}<div class="url">${esc(q.url)}</div>`;
      el.dataset.url = q.url;
      el.dataset.svg = q.svg;
    } catch (e) { /* mesa eliminada */ }
  }
}

function tableModalEdit(table) {
  const t = table || { number: '', seats: 4 };
  openModal(`
    <h2>${table ? '✏️ Editar mesa ' + t.number : '➕ Nueva mesa'}</h2>
    <div class="row">
      <div class="field" style="flex:1"><label>Número *</label><input id="t-number" type="number" min="1" value="${t.number}"/></div>
      <div class="field" style="flex:1"><label>Asientos</label><input id="t-seats" type="number" min="1" value="${t.seats}"/></div>
    </div>
    <div class="actions">
      <button class="btn secondary" data-action="close-modal">Cancelar</button>
      <button class="btn" data-action="table-save" data-id="${table ? table.id : ''}">💾 Guardar</button>
    </div>`);
}

/* ---------------- PERSONAL (dueño) ---------------- */
function personalView(users) {
  const ROLE_OPTIONS = Object.keys(ROLE_LABEL).map(r =>
    `<option value="${r}">${ROLE_LABEL[r]}</option>`).join('');
  return `<div class="section-title">👥 Personal y accesos
    <button class="btn small" data-action="user-new">➕ Nuevo usuario</button></div>
  <div class="card"><table class="data">
    <tr><th>Nombre</th><th>Usuario</th><th>Perfil</th><th>Estado</th><th></th></tr>
    ${users.map(u => `<tr>
      <td><strong>${esc(u.name)}</strong></td>
      <td>${esc(u.username)}</td>
      <td><select data-action="user-role" data-id="${u.id}" style="width:auto;padding:6px 8px">
        ${ROLE_OPTIONS.replace(`value="${u.role}"`, `value="${u.role}" selected`)}
      </select></td>
      <td><span class="chip ${u.active ? 'pagado' : 'cancelado'}">${u.active ? 'Activo' : 'Inactivo'}</span></td>
      <td class="row" style="justify-content:flex-end">
        <button class="btn small ${u.active ? 'red' : 'green'}" data-action="user-toggle" data-id="${u.id}">${u.active ? 'Desactivar' : 'Activar'}</button>
        <button class="btn small ghost" data-action="user-pass" data-id="${u.id}">🔑</button>
      </td>
    </tr>`).join('')}
  </table></div>
  <p class="muted" style="margin-top:10px">Solo el <strong>dueño</strong> puede crear, desactivar y cambiar perfiles. Los perfiles definen qué ve cada persona dentro de la app.</p>`;
}

function userModal() {
  openModal(`
    <h2>➕ Nuevo usuario</h2>
    <div class="field"><label>Nombre completo *</label><input id="u-name" maxlength="60"/></div>
    <div class="field"><label>Usuario de acceso *</label><input id="u-username" maxlength="30"/></div>
    <div class="field"><label>Contraseña *</label><input id="u-pass" type="text" maxlength="30"/></div>
    <div class="field"><label>Perfil</label><select id="u-role">
      ${Object.keys(ROLE_LABEL).map(r => `<option value="${r}">${ROLE_LABEL[r]}</option>`).join('')}
    </select></div>
    <div class="actions">
      <button class="btn secondary" data-action="close-modal">Cancelar</button>
      <button class="btn" data-action="user-save">💾 Crear</button>
    </div>`);
}

/* ---------------- LLAMADOS ---------------- */
function llamadosView(notifs) {
  if (!notifs.length) return `<div class="empty"><span class="big">🔔</span>No hay llamados pendientes</div>`;
  return `<div class="section-title">🔔 Llamados de mesas</div>
  ${notifs.map(n => `<div class="card notif-bar" style="margin-bottom:10px">
    <div class="row">
      <span class="pill-waiter" style="font-size:22px">${n.type === 'bill' ? '🧾' : '🔔'}</span>
      <strong>Mesa ${n.tableNumber}</strong>
      <span class="muted">${n.type === 'bill' ? 'Pide la cuenta' : 'Pide al mesero'} · ${ago(n.createdAt)}</span>
      <span class="spacer"></span>
      <button class="btn small green" data-action="notif-done" data-id="${n.id}">✔ Atendido</button>
    </div>
  </div>`).join('')}`;
}

/* ============================================================
   LOGIN
   ============================================================ */
function renderLogin() {
  const quick = [
    ['dueno', '👑', 'Dueño'], ['encargado', '📋', 'Encargado'], ['mesero', '🧑‍🍳', 'Mesero'],
    ['cocina', '🔥', 'Cocinero'], ['caja', '💰', 'Cajero'],
  ];
  document.getElementById('app').innerHTML = `
  <div class="login-wrap">
    <div class="card login-card">
      <div class="logo-big">🌮</div>
      <h1>Chilokos</h1>
      <p>Tacos, flautas, burritos y ramen de birria.<br/>Escanea el QR de tu mesa o entra con tu perfil de personal.</p>
      <form id="login-form">
        <div class="field"><label>Usuario</label><input id="lg-user" autocomplete="username" value="" placeholder="ej. mesero"/></div>
        <div class="field"><label>Contraseña</label><input id="lg-pass" type="password" autocomplete="current-password" value="" placeholder="••••"/></div>
        <button class="btn block" type="submit">Entrar</button>
      </form>
      <button class="btn secondary block" data-action="go-carta" style="margin-top:10px">🛍️ Ver la carta y pedir para llevar</button>
      <p class="muted" style="margin-top:18px">Accesos de prueba (contraseña <strong>1234</strong>):</p>
      <div class="quick">
        ${quick.map(([u, e, l]) => `<button data-action="quick-login" data-u="${u}"><span class="q-emoji">${e}</span>${l}</button>`).join('')}
      </div>
      <p class="muted" style="margin-top:16px;font-size:12px">📱 Los clientes no inician sesión: escanean el QR de su mesa o piden para llevar desde la carta.</p>
      ${RATE && RATE.tasa ? `<p class="muted" style="margin-top:10px;font-size:12px">💱 1 € = ${bs(1)} · Tasa BCV${RATE.fechaValorLegible ? ' (fecha valor: ' + RATE.fechaValorLegible + ')' : ''}</p>` : ''}
    </div>
  </div>`;
}

/* ============================================================
   ACCIONES (delegación de eventos)
   ============================================================ */
async function act(action, el, ev) {
  const id = el?.dataset?.id;
  switch (action) {
    /* ---- sesión ---- */
    case 'quick-login': {
      const u = el.dataset.u;
      document.getElementById('lg-user').value = u;
      document.getElementById('lg-pass').value = '1234';
      const data = await api('/login', { method: 'POST', body: { username: u, password: '1234' } });
      saveSession(data.token, data.user);
      S.tab = defaultTab(data.user.role);
      location.hash = '#/app';
      toast('Bienvenido, ' + data.user.name);
      break;
    }
    case 'logout': {
      await api('/logout', { method: 'POST' }).catch(() => {});
      clearSession();
      stopPoll();
      location.hash = '';
      renderLogin();
      break;
    }

    /* ---- navegación ---- */
    case 'tab': S.tab = el.dataset.tab; render(); break;
    case 'go-carta': location.hash = '#/carta'; break;
    case 'cat': catActiva = el.dataset.cat; render(); break;
    case 'close-modal': closeModal(); render(); break;
    case 'modal-backdrop': if (ev && el === ev.target) { closeModal(); render(); } break;

    /* ---- carrito cliente ---- */
    case 'cart-inc': {
      const line = S.cart.find(i => i.menuId === id);
      if (line) line.qty++; else S.cart.push({ menuId: id, qty: 1 });
      syncCart();
      break;
    }
    case 'cart-dec': {
      const line = S.cart.find(i => i.menuId === id);
      if (line) { line.qty--; if (line.qty <= 0) S.cart = S.cart.filter(i => i.menuId !== id); }
      syncCart();
      break;
    }
    case 'open-cart': cartModal(); break;
    case 'order-type': {
      const tipo = el.dataset.type;
      if (tipo === 'sitio' && !S.table) return toast('Escanea el QR de tu mesa para comer aquí', 'err');
      S.orderType = tipo;
      rebuildCartModal();
      break;
    }
    case 'send-order': {
      const notes = document.getElementById('order-notes')?.value || '';
      const customerName = (document.getElementById('order-name')?.value || S.customerName || '').trim();
      if (!S.table && !customerName) return toast('Escribe tu nombre para el pedido para llevar', 'err');
      S.customerName = customerName;
      const data = await api('/orders', {
        method: 'POST',
        body: {
          tableId: S.table ? S.table.id : null,
          items: S.cart,
          notes,
          orderType: orderTypeActual(),
          customerName,
        },
      });
      S.cart = [];
      closeModal();
      S.tab = 'pedido';
      toast(`¡Pedido #${data.id} enviado a cocina! 🔥`);
      render();
      break;
    }

    /* ---- cliente: ayuda ---- */
    case 'call-waiter': {
      await api('/notifications', { method: 'POST', body: { tableId: S.table.id, type: 'waiter' } });
      toast('🔔 El mesero fue notificado');
      break;
    }
    case 'ask-bill': {
      const orders = await api('/orders');
      const servidos = orders.filter(o => o.status === 'servido');
      for (const o of servidos) {
        await api(`/orders/${o.id}/status`, { method: 'PATCH', body: { status: 'por_pagar' } });
      }
      await api('/notifications', { method: 'POST', body: { tableId: S.table.id, type: 'bill' } });
      toast('🧾 Solicitud de cuenta enviada al cajero');
      render();
      break;
    }

    /* ---- pedidos (staff) ---- */
    case 'set-status': {
      await api(`/orders/${id}/status`, { method: 'PATCH', body: { status: el.dataset.status } });
      toast('Pedido actualizado ✔');
      if (S.modalOpen) closeModal();
      render();
      break;
    }
    case 'cancel-order': {
      if (!confirm('¿Cancelar este pedido?')) return;
      await api(`/orders/${id}/status`, { method: 'PATCH', body: { status: 'cancelado' } });
      toast('Pedido cancelado');
      render();
      break;
    }
    case 'add-items': addItemsModal(id); break;
    case 'add-items-save': {
      const sel = document.getElementById('ai-menu');
      const qty = Number(document.getElementById('ai-qty').value) || 1;
      await api(`/orders/${id}/items`, { method: 'POST', body: { menuId: sel.value, qty } });
      closeModal();
      toast('Platillos agregados ➕');
      render();
      break;
    }

    /* ---- mesas ---- */
    case 'open-table': {
      const [tables, orders] = await Promise.all([api('/tables'), api('/orders')]);
      tableModal(id, tables, orders);
      break;
    }

    /* ---- pago ---- */
    case 'pay-order': payModal(id); break;
    case 'confirm-pay': {
      const method = document.getElementById('pay-method')?.value || 'efectivo';
      const amount = Number(document.getElementById('pay-amount')?.value || 0);
      await api(`/orders/${id}/pay`, { method: 'POST', body: { method, amount } });
      closeModal();
      toast('Pago confirmado ✓');
      render();
      break;
    }
    case 'table-new': tableModalEdit(null); break;
    case 'table-edit': {
      const tables = await api('/tables');
      tableModalEdit(tables.find(t => t.id === id));
      break;
    }
    case 'table-save': {
      const body = { number: Number(document.getElementById('t-number').value), seats: Number(document.getElementById('t-seats').value) };
      if (id) await api('/tables/' + id, { method: 'PATCH', body });
      else await api('/tables', { method: 'POST', body });
      closeModal();
      toast('Mesa guardada ✔');
      render();
      break;
    }
    case 'table-delete': {
      if (!confirm('¿Eliminar esta mesa?')) return;
      await api('/tables/' + id, { method: 'DELETE' });
      toast('Mesa eliminada');
      render();
      break;
    }

    /* ---- QR ---- */
    case 'qr-print': {
      const card = document.getElementById('qr-' + id);
      if (!card) return;
      const w = window.open('', '_blank');
      w.document.write(`<html><head><title>QR Mesa</title><style>
        body{font-family:sans-serif;text-align:center;padding:30px}
        svg{width:320px;height:320px;border:2px solid #000;padding:10px}
        h1{font-size:26px}p{color:#555}</style></head><body>
        <h1>🍽️ Restaurante QR</h1><h2>Mesa ${card.querySelector('h3').textContent.replace('Mesa ', '')}</h2>
        ${card.dataset.svg}<p>Escanea para ver el menú y pedir desde tu mesa</p>
        <script>window.onload=()=>{window.print()}<\/script></body></html>`);
      w.document.close();
      break;
    }
    case 'qr-download': {
      const card = document.getElementById('qr-' + id);
      if (!card) return;
      const blob = new Blob([card.dataset.svg], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `qr-mesa-${id}.svg`;
      a.click();
      break;
    }

    /* ---- menú admin ---- */
    case 'menu-new': menuModal(null); break;
    case 'menu-edit': {
      const menu = await api('/menu');
      menuModal(menu.find(m => m.id === id));
      break;
    }
    case 'menu-save': {
      const body = {
        name: document.getElementById('m-name').value.trim(),
        price: Number(document.getElementById('m-price').value),
        category: document.getElementById('m-cat').value.trim() || 'Sin categoría',
        emoji: document.getElementById('m-emoji').value.trim() || '🍽️',
        description: document.getElementById('m-desc').value.trim(),
      };
      if (!body.name || !body.price) return toast('Nombre y precio son obligatorios', 'err');
      if (id) await api('/menu/' + id, { method: 'PATCH', body });
      else await api('/menu', { method: 'POST', body });
      closeModal();
      toast('Platillo guardado ✔');
      render();
      break;
    }
    case 'menu-toggle': {
      const menu = await api('/menu');
      const m = menu.find(x => x.id === id);
      await api('/menu/' + id, { method: 'PATCH', body: { available: !m.available } });
      render();
      break;
    }
    case 'menu-delete': {
      if (!confirm('¿Eliminar del menú?')) return;
      await api('/menu/' + id, { method: 'DELETE' });
      toast('Platillo eliminado');
      render();
      break;
    }

    /* ---- cobro ---- */
    case 'pay-order': S._ordersCache = (await api('/orders')); payModal(Number(id)); break;
    case 'confirm-pay': {
      const method = document.getElementById('pay-method').value;
      const amount = Number(document.getElementById('pay-amount').value);
      await api(`/orders/${id}/pay`, { method: 'POST', body: { method, amount } });
      closeModal();
      toast('¡Pago registrado! 💵');
      render();
      break;
    }

    /* ---- personal ---- */
    case 'user-new': userModal(); break;
    case 'user-save': {
      const body = {
        name: document.getElementById('u-name').value.trim(),
        username: document.getElementById('u-username').value.trim(),
        password: document.getElementById('u-pass').value,
        role: document.getElementById('u-role').value,
      };
      if (!body.name || !body.username || !body.password) return toast('Completa todos los campos', 'err');
      await api('/users', { method: 'POST', body });
      closeModal();
      toast('Usuario creado 👥');
      render();
      break;
    }
    case 'user-toggle': {
      const users = await api('/users');
      const u = users.find(x => x.id === id);
      await api('/users/' + id, { method: 'PATCH', body: { active: !u.active } });
      render();
      break;
    }
    case 'user-pass': {
      const p = prompt('Nueva contraseña para el usuario:');
      if (!p) return;
      await api('/users/' + id, { method: 'PATCH', body: { password: p } });
      toast('Contraseña actualizada 🔑');
      break;
    }

    /* ---- llamados ---- */
    case 'notif-done': {
      await api('/notifications/' + id, { method: 'DELETE' });
      render();
      break;
    }
  }
}

async function addItemsModal(orderId) {
  const menu = await api('/menu');
  openModal(`
    <h2>➕ Agregar platillos al pedido #${orderId}</h2>
    <div class="field"><label>Platillo</label>
      <select id="ai-menu">${menu.filter(m => m.available).map(m =>
        `<option value="${m.id}">${m.emoji} ${esc(m.name)} — ${money(m.price)}</option>`).join('')}</select></div>
    <div class="field"><label>Cantidad</label><input id="ai-qty" type="number" min="1" max="99" value="1"/></div>
    <div class="actions">
      <button class="btn secondary" data-action="close-modal">Cancelar</button>
      <button class="btn" data-action="add-items-save" data-id="${orderId}">➕ Agregar</button>
    </div>`);
}

/* ============================================================
   LOGIN FORM + POLLING + INICIO
   ============================================================ */
document.addEventListener('submit', async e => {
  if (e.target.id !== 'login-form') return;
  e.preventDefault();
  const username = document.getElementById('lg-user').value.trim();
  const password = document.getElementById('lg-pass').value;
  try {
    const data = await api('/login', { method: 'POST', body: { username, password } });
    saveSession(data.token, data.user);
    S.tab = defaultTab(data.user.role);
    toast('Bienvenido, ' + data.user.name);
    location.hash = '#/app';
  } catch (err) {
    toast(err.message, 'err');
  }
});

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  act(el.dataset.action, el, e).catch(err => toast(err.message, 'err'));
});

document.addEventListener('change', async e => {
  const el = e.target.closest('[data-action="user-role"]');
  if (!el) return;
  try {
    await api('/users/' + el.dataset.id, { method: 'PATCH', body: { role: el.value } });
    toast('Perfil actualizado ✔');
  } catch (err) { toast(err.message, 'err'); }
});

function startPoll() {
  stopPoll();
  S.poll = setInterval(() => {
    if (document.hidden) return;                   // pestaña en segundo plano: no gastar cuota
    if (S.modalOpen) return;                       // no interrumpir modales
    const tag = document.activeElement?.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return; // no interrumpir escritura
    render().catch(() => {});
  }, 15000);
}
function stopPoll() { if (S.poll) clearInterval(S.poll); S.poll = null; }

window.addEventListener('hashchange', () => route().catch(e => toast(e.message, 'err')));

/* ---------------- Tasa del euro del BCV (consultada desde el navegador) ---------------- */
const RATE_CACHE_KEY = 'chilokos_rate_v1';
const RATE_TTL = 6 * 60 * 60 * 1000;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function fechaLegible(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return `${DIAS[dow]} ${d} de ${MESES[m - 1]} de ${y}`;
}

async function fetchBcvEuro() {
  const [euro, dolar] = await Promise.all([
    fetch('https://ve.dolarapi.com/v1/euros/oficial').then(r => r.json()),
    fetch('https://ve.dolarapi.com/v1/dolares/oficial').then(r => r.json()).catch(() => null),
  ]);
  let tasa = Number(euro && euro.promedio);
  const usd = Number(dolar && dolar.promedio);
  // La API a veces devuelve "1.006" cuando el BCV publica "1.006,03" (miles).
  if (Number.isFinite(tasa) && tasa > 0 && tasa < 50) tasa *= 1000;
  if (!Number.isFinite(tasa) || tasa <= 0) return null;
  // Cordura: el euro debe moverse en un rango razonable frente al dólar.
  if (Number.isFinite(usd) && usd > 100 && (tasa < usd * 0.5 || tasa > usd * 2)) return null;
  const fechaValor = String((euro && euro.fechaActualizacion) || '').slice(0, 10) || null;
  return {
    tasa,
    fechaValor,
    fechaValorLegible: fechaLegible(fechaValor),
    regla: 'tasa oficial del BCV',
    fuente: 'BCV — Banco Central de Venezuela',
    actualizado: Date.now(),
  };
}

async function loadRate(force) {
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem(RATE_CACHE_KEY) || 'null'); } catch (e) { cache = null; }
  if (!force && cache && cache.tasa && Date.now() - (cache.at || 0) < RATE_TTL) {
    RATE = cache;
    return;
  }
  try {
    const r = await fetchBcvEuro();
    if (r) {
      RATE = r;
      localStorage.setItem(RATE_CACHE_KEY, JSON.stringify({ ...r, at: Date.now() }));
      return;
    }
  } catch (e) { /* sin red o API caída: se conserva la última tasa */ }
  if (cache && cache.tasa) RATE = cache;
}

(async function init() {
  await loadRate();                    // tasa del euro del BCV antes de pintar
  await route().catch(e => { console.error(e); renderLogin(); });
  // reconsulta la tasa cada 30 minutos y repinta si no hay modal abierto
  setInterval(async () => {
    await loadRate();
    if (!S.modalOpen && S.user) render().catch(() => {});
  }, 30 * 60 * 1000);
})();
