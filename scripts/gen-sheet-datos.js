// Genera apps-script/Datos.js a partir de data/db.json (respaldo / carga al Google Sheet).
// Uso: node scripts/gen-sheet-datos.js
const fs = require('fs');
const path = require('path');

const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
const pubs = (db.eur && db.eur.pubs) || [];
const ultima = pubs.length ? pubs[pubs.length - 1] : null;

const datos = {
  marca: 'Chilokos',
  version: db.version || null,
  exportadoEl: new Date().toISOString(),
  tasa: ultima ? { valor: ultima.tasa, fechaValor: ultima.fechaValor } : null,
  tasas: pubs.map(p => ({ tasa: p.tasa, fechaValor: p.fechaValor })),
  users: db.users || [],
  menu: db.menu || [],
  tables: (db.tables || []).map(t => {
    const abiertos = (db.orders || []).filter(o => o.tableId === t.id && o.status !== 'pagado' && o.status !== 'cancelado').length;
    return { ...t, abiertos };
  }),
  orders: (db.orders || []).map(o => ({
    id: o.id,
    tableId: o.tableId || null,
    tableNumber: o.tableNumber || null,
    orderType: o.orderType || (o.tableId ? 'sitio' : 'llevar'),
    customerName: o.customerName || null,
    items: o.items || [],
    notes: o.notes || '',
    status: o.status,
    createdBy: o.createdBy || '',
    createdAt: o.createdAt,
    paidBy: o.paidBy || '',
    paidAt: o.paidAt || null,
  })),
  notifications: db.notifications || [],
  counters: db.counters || {},
};

const out = path.join(__dirname, '..', 'apps-script', 'Datos.js');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, '// Generado desde data/db.json — no editar a mano.\nvar DATOS = ' + JSON.stringify(datos) + ';\n');
console.log('OK ->', out);
console.log('usuarios:', datos.users.length, '| platillos:', datos.menu.length, '| mesas:', datos.tables.length,
  '| pedidos:', datos.orders.length, '| tasa:', datos.tasa ? datos.tasa.valor + ' (' + datos.tasa.fechaValor + ')' : 'sin tasa');
