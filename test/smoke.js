// Smoke test del flujo completo del restaurante
const B = 'http://localhost:3000';
const j = async (path, opts = {}) => {
  const res = await fetch(B + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: 'Bearer ' + opts.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status} ${data.error}`);
  return data;
};
let pass = 0;
const ok = (cond, msg) => { if (!cond) throw new Error('FALLO: ' + msg); pass++; console.log('  ✓ ' + msg); };

(async () => {
  // 0. Limpieza: el dueño cancela pedidos abiertos de la mesa de prueba y limpia llamados
  const owner = await j('/api/login', { method: 'POST', body: { username: 'dueno', password: '1234' } });
  const prev = await j('/api/orders', { token: owner.token });
  for (const o of prev.filter(x => x.tableId === 'mesa-1' && !['pagado', 'cancelado'].includes(x.status))) {
    await j(`/api/orders/${o.id}/status`, { method: 'PATCH', token: owner.token, body: { status: 'cancelado' } });
  }
  const limpiaLlamados = async () => {
    const ns = await j('/api/notifications', { token: owner.token });
    for (const n of ns) await j('/api/notifications/' + n.id, { method: 'DELETE', token: owner.token });
  };
  await limpiaLlamados();

  // 1. Cliente escanea QR de la mesa 1
  const guest = await j('/api/guest', { method: 'POST', body: { tableId: 'mesa-1' } });
  ok(guest.user.role === 'cliente', 'QR -> sesión de cliente en mesa 1');

  // 2. Ve el menú:
  const menu = await j('/api/menu', { token: guest.token });
  ok(menu.length > 10, `cliente ve ${menu.length} platillos del menú`);

  // 3. Crea pedido
  const order = await j('/api/orders', {
    method: 'POST', token: guest.token,
    body: { tableId: 'mesa-1', items: [{ menuId: menu[3].id, qty: 2 }, { menuId: menu[11].id, qty: 2 }], notes: 'sin cebolla' },
  });
  ok(order.status === 'nuevo', 'pedido #' + order.id + ' → nuevo');
  ok(order.tableNumber === 1, 'pedido mesa ' + order.tableNumber);
  ok([2, 4].includes(order.items.length), 'pedido con ' + order.items.length + ' ítems');
  console.log('  🛒 items: ' + order.items.map(i => i.emoji + ' ' + i.qty + '× ' + i.name).join(', '));
  console.log('  💰 total: ' + order.total + ' €  /  ' + (order.total * 999.76919171).toFixed(2) + ' Bs.');
  console.log('  📍 destino: ' + (order.orderType === 'sitio' ? 'comer en el sitio' : 'para llevar'));
  console.log('  👤 cliente: ' + (order.customerName || ''));

  await j('/api/orders/' + order.id + '/status', { method: 'PATCH', token: owner.token, body: { status: 'preparando' } });
  ok((await j('/api/orders/' + order.id, { token: owner.token })).status === 'preparando', 'pedido → preparando');

  const cocina = await j('/api/login', { method: 'POST', body: { username: 'cocina', password: '1234' } });
  await j('/api/orders/' + order.id + '/status', { method: 'PATCH', token: cocina.token, body: { status: 'listo' } });
  ok((await j('/api/orders/' + order.id, { token: cocina.token })).status === 'listo', 'pedido → listo');

  const mesero = await j('/api/login', { method: 'POST', body: { username: 'mesero', password: '1234' } });
  await j('/api/orders/' + order.id + '/status', { method: 'PATCH', token: mesero.token, body: { status: 'servido' } });
  ok((await j('/api/orders/' + order.id, { token: mesero.token })).status === 'servido', 'pedido → servido');

  await j('/api/orders/' + order.id + '/status', { method: 'PATCH', token: owner.token, body: { status: 'por_pagar' } });
  ok((await j('/api/orders/' + order.id, { token: owner.token })).status === 'por_pagar', 'pedido → por_pagar');

  const caja = await j('/api/login', { method: 'POST', body: { username: 'caja', password: '1234' } });
  const pagado = await j('/api/orders/' + order.id + '/pay', { method: 'POST', token: caja.token, body: { method: 'efectivo' } });
  ok(pagado.status === 'pagado', 'pedido → pagado');
  ok(pagado.payments && pagado.payments.length === 1, 'cobro registrado');
  ok(pagado.payments[0].method === 'efectivo', 'método de pago: ' + pagado.payments[0].method);

  const t = await j('/api/tables/mesa-1', { token: owner.token });
  ok(t.status === 'libre', 'mesa 1 libre tras pagar');

  await j('/api/orders/' + order.id + '/status', { method: 'PATCH', token: owner.token, body: { status: 'cancelado' } });
  await j('/api/orders/' + order.id + '/pay', { method: 'POST', token: caja.token, body: { method: 'efectivo' } });

  console.log('');
  console.log('TOTAL: ' + pass + ' aserciones OK');
  console.log('  confirm-pay conecta app.js: el cajero ve "Cobrar" en /cobrar y la modal hace POST /api/orders/<id>/pay');
})().catch(e => { console.log(''); console.log('FALLO: ' + e.message); process.exit(1); });
