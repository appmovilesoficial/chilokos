/**
 * Chilokos · Base de datos en Google Sheets
 *
 * Carga el contenido de data/db.json (ya exportado en Datos.js) en este Sheet.
 * Ejecuta `cargarChilokos` desde el menú "🌮 Chilokos" del Sheet o desde el editor
 * de Apps Script. Vuelve a ejecutarlo cada vez que regeneres Datos.js con
 * `node scripts/gen-sheet-datos.js` y `clasp push`.
 */

var MARCA = '#e03b2f';
var MAIZ = '#f4a300';
var TINTA = '#3a1f16';
var CREMA = '#fdf6e9';

var ESTADOS = {
  nuevo: 'Nuevo',
  preparando: 'En preparación',
  listo: 'Listo',
  servido: 'Servido',
  por_pagar: 'Por pagar',
  pagado: 'Pagado',
  cancelado: 'Cancelado'
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🌮 Chilokos')
    .addItem('Cargar base de datos', 'cargarChilokos')
    .addToUi();
}

function cargarChilokos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tasa = DATOS.tasa ? DATOS.tasa.valor : 0;
  var zona = ss.getSpreadsheetTimeZone() || 'America/Caracas';

  hojaResumen_(ss, tasa, zona);
  hojaMenu_(ss, tasa);
  hojaUsuarios_(ss);
  hojaMesas_(ss);
  hojaPedidos_(ss, tasa, zona);
  hojaDetalle_(ss, tasa, zona);
  hojaLlamados_(ss, zona);
  hojaTasas_(ss);

  ss.setActiveSheet(ss.getSheetByName('Resumen'));
  SpreadsheetApp.getActive().toast(
    'Base de datos cargada: ' + DATOS.menu.length + ' platillos · ' +
    DATOS.orders.length + ' pedidos · ' + DATOS.users.length + ' usuarios',
    '🌮 Chilokos', 8
  );
  return 'ok';
}

// ---------- Hojas ----------

function hojaResumen_(ss, tasa, zona) {
  var sh = hoja_(ss, 'Resumen');
  var pedidos = DATOS.orders || [];
  var pagados = pedidos.filter(function (o) { return o.status === 'pagado'; });
  var abiertos = pedidos.filter(function (o) { return o.status !== 'pagado' && o.status !== 'cancelado'; });
  var ventas = pagados.reduce(function (a, o) { return a + totalDe_(o); }, 0);
  var paraLlevar = pedidos.filter(function (o) { return o.orderType === 'llevar'; }).length;

  var filas = [
    ['Restaurante', DATOS.marca],
    ['Carta', (DATOS.menu || []).length + ' platillos · ' + categorias_().length + ' categorías'],
    ['Categorías', categorias_().join(' · ')],
    ['Usuarios del panel', (DATOS.users || []).length],
    ['Mesas', (DATOS.tables || []).length],
    ['Pedidos totales', pedidos.length],
    ['Pedidos abiertos', abiertos.length],
    ['Pedidos pagados', pagados.length],
    ['Ventas cobradas (€)', ventas],
    ['Ventas cobradas (Bs.)', ventas * tasa],
    ['Ticket promedio (€)', pagados.length ? ventas / pagados.length : 0],
    ['Pedidos para llevar', paraLlevar],
    ['Pedidos en mesa', pedidos.length - paraLlevar],
    ['Tasa BCV (Bs. por €)', tasa],
    ['Fecha valor de la tasa', DATOS.tasa ? DATOS.tasa.fechaValor : '—'],
    ['Versión del archivo de datos', DATOS.version || '—'],
    ['Exportado desde db.json', fechaHora_(DATOS.exportadoEl, zona)],
    ['Zona horaria del Sheet', zona]
  ];

  sh.clear();
  sh.getRange(1, 1, 1, 2).setValues([['🌮 Chilokos · resumen', '']])
    .setBackground(MARCA).setFontColor('#ffffff').setFontWeight('bold').setFontSize(13);
  sh.getRange(2, 1, filas.length, 2).setValues(filas);
  sh.getRange(2, 1, filas.length, 1).setFontWeight('bold').setFontColor(TINTA);
  sh.getRange(2, 2, filas.length, 1).setFontColor('#5b4636');
  sh.getRange(2, 1, filas.length, 2).setVerticalAlignment('middle');
  // Importes: según la etiqueta, para no depender de la fila exacta
  filas.forEach(function (f, i) {
    if (/\(Bs\.\)|\(Bs\. por/.test(f[0])) sh.getRange(i + 2, 2).setNumberFormat('#,##0.0000 "Bs."');
    else if (/\(€\)/.test(f[0])) sh.getRange(i + 2, 2).setNumberFormat('#,##0.00 "€"');
  });
  sh.setColumnWidth(1, 230);
  sh.setColumnWidth(2, 520);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, 2).merge();
}

function hojaMenu_(ss, tasa) {
  var enc = ['ID', 'Categoría', 'Platillo', 'Descripción', 'Emoji', 'Precio €', 'Precio Bs.', 'Disponible'];
  var filas = (DATOS.menu || []).map(function (m) {
    return [m.id, m.category || '', m.name || '', m.description || '', m.emoji || '',
      Number(m.price) || 0, (Number(m.price) || 0) * tasa, m.available ? 'Sí' : 'No'];
  });
  var sh = tabla_(ss, 'Menu', enc, filas);
  formatosMoneda_(sh, filas.length, [6], '#,##0.00 "€"');
  formatosMoneda_(sh, filas.length, [7], '#,##0.00 "Bs."');
  sh.setColumnWidth(3, 210);
  sh.setColumnWidth(4, 330);
}

function hojaUsuarios_(ss) {
  var enc = ['ID', 'Usuario', 'Nombre', 'Rol', 'Activo', 'Contraseña'];
  var filas = (DATOS.users || []).map(function (u) {
    return [u.id, u.username, u.name || '', u.role, u.active ? 'Sí' : 'No', u.password || ''];
  });
  var sh = tabla_(ss, 'Usuarios', enc, filas);
  sh.setColumnWidth(3, 200);
  sh.getRange(2, 6, Math.max(filas.length, 1), 1).setBackground('#fff3cd');
}

function hojaMesas_(ss) {
  var enc = ['ID', 'Mesa', 'Puestos', 'Estado', 'Pedidos abiertos'];
  var filas = (DATOS.tables || []).map(function (t) {
    return [t.id, 'Mesa ' + (t.number || ''), Number(t.seats) || 0, t.status || '', Number(t.abiertos) || 0];
  });
  tabla_(ss, 'Mesas', enc, filas);
}

function hojaPedidos_(ss, tasa, zona) {
  var enc = ['Pedido', 'Fecha', 'Hora', 'Tipo', 'Destino', 'Estado', 'Ítems', 'Total €', 'Total Bs.', 'Notas', 'Atendido por'];
  var filas = (DATOS.orders || []).slice().sort(function (a, b) { return (a.id || 0) - (b.id || 0); })
    .map(function (o) {
      var total = totalDe_(o);
      return [
        o.id,
        fecha_(o.createdAt, zona),
        hora_(o.createdAt, zona),
        o.orderType === 'llevar' ? 'Para llevar' : 'Comer aquí',
        destino_(o),
        ESTADOS[o.status] || o.status,
        (o.items || []).reduce(function (a, i) { return a + (Number(i.qty) || 0); }, 0),
        total,
        total * tasa,
        o.notes || '',
        o.paidBy || o.createdBy || ''
      ];
    });
  var sh = tabla_(ss, 'Pedidos', enc, filas);
  formatosMoneda_(sh, filas.length, [8], '#,##0.00 "€"');
  formatosMoneda_(sh, filas.length, [9], '#,##0.00 "Bs."');
  sh.setColumnWidth(5, 200);
  sh.setColumnWidth(10, 260);
}

function hojaDetalle_(ss, tasa, zona) {
  var enc = ['Pedido', 'Fecha', 'Platillo', 'Cantidad', 'Precio unit. €', 'Subtotal €', 'Subtotal Bs.', 'Notas del ítem'];
  var filas = [];
  (DATOS.orders || []).slice().sort(function (a, b) { return (a.id || 0) - (b.id || 0); })
    .forEach(function (o) {
      (o.items || []).forEach(function (i) {
        var sub = (Number(i.price) || 0) * (Number(i.qty) || 0);
        filas.push([o.id, fecha_(o.createdAt, zona), (i.emoji ? i.emoji + ' ' : '') + (i.name || ''),
          Number(i.qty) || 0, Number(i.price) || 0, sub, sub * tasa, i.notes || '']);
      });
    });
  var sh = tabla_(ss, 'Detalle de pedidos', enc, filas);
  formatosMoneda_(sh, filas.length, [5, 6], '#,##0.00 "€"');
  formatosMoneda_(sh, filas.length, [7], '#,##0.00 "Bs."');
  sh.setColumnWidth(3, 230);
}

function hojaLlamados_(ss, zona) {
  var enc = ['Fecha', 'Hora', 'Mesa', 'Llamado', 'Atendido'];
  var tipos = { mesero: 'Llamar al mesero', cuenta: 'Pedir la cuenta', llamar: 'Llamar al mesero' };
  var filas = (DATOS.notifications || []).map(function (n) {
    return [fecha_(n.createdAt, zona), hora_(n.createdAt, zona),
      n.tableNumber ? 'Mesa ' + n.tableNumber : (n.tableId || ''),
      tipos[n.type] || n.type || '',
      n.status === 'atendido' || n.done ? 'Sí' : 'No'];
  });
  tabla_(ss, 'Llamados', enc, filas);
}

function hojaTasas_(ss) {
  var enc = ['Fecha valor', 'Bs. por €', 'Tasa usada en el Sheet']; 
  var filas = (DATOS.tasas || []).map(function (t) {
    var actual = DATOS.tasa && DATOS.tasa.fechaValor === t.fechaValor;
    return [t.fechaValor, Number(t.tasa) || 0, actual ? 'Sí (la más reciente)' : ''];
  });
  var sh = tabla_(ss, 'Tasas BCV', enc, filas);
  formatosMoneda_(sh, filas.length, [2], '#,##0.0000 "Bs."');
}

// ---------- Utilidades ----------

function hoja_(ss, nombre) {
  var sh = ss.getSheetByName(nombre);
  if (!sh) sh = ss.insertSheet(nombre);
  return sh;
}

function tabla_(ss, nombre, encabezados, filas) {
  var sh = hoja_(ss, nombre);
  sh.clear();
  var rango = sh.getRange(1, 1, 1, encabezados.length);
  rango.setValues([encabezados]).setBackground(MARCA).setFontColor('#ffffff')
    .setFontWeight('bold').setHorizontalAlignment('left');
  if (filas.length) {
    sh.getRange(2, 1, filas.length, encabezados.length).setValues(filas);
    sh.getRange(2, 1, filas.length, encabezados.length)
      .setVerticalAlignment('top')
      .setBorder(true, true, true, true, true, true, MAIZ, SpreadsheetApp.BorderStyle.SOLID);
    // Filas alternas color crema
    for (var i = 0; i < filas.length; i++) {
      if (i % 2 === 0) {
        sh.getRange(i + 2, 1, 1, encabezados.length).setBackground(CREMA);
      }
    }
  }
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, encabezados.length);
  // Evita columnas gigantes por descripciones largas
  for (var c = 1; c <= encabezados.length; c++) {
    if (sh.getColumnWidth(c) > 340) sh.setColumnWidth(c, 340);
  }
  return sh;
}

function formatosMoneda_(sh, filas, columnas, formato) {
  if (!filas) return;
  columnas.forEach(function (c) {
    sh.getRange(2, c, filas, 1).setNumberFormat(formato);
  });
}

function totalDe_(o) {
  if (o.total != null) return Number(o.total) || 0;
  return (o.items || []).reduce(function (a, i) {
    return a + (Number(i.price) || 0) * (Number(i.qty) || 0);
  }, 0);
}

function destino_(o) {
  if (o.orderType === 'llevar') return 'Para llevar' + (o.customerName ? ' · ' + o.customerName : '');
  return o.tableNumber ? 'Mesa ' + o.tableNumber : 'Sin mesa';
}

function categorias_() {
  var vistos = {};
  var lista = [];
  (DATOS.menu || []).forEach(function (m) {
    var c = m.category || 'Otros';
    if (!vistos[c]) { vistos[c] = true; lista.push(c); }
  });
  return lista;
}

function fecha_(ms, zona) {
  if (!ms) return '';
  return Utilities.formatDate(new Date(Number(ms)), zona, 'dd/MM/yyyy');
}

function hora_(ms, zona) {
  if (!ms) return '';
  return Utilities.formatDate(new Date(Number(ms)), zona, 'HH:mm');
}

function fechaHora_(iso, zona) {
  if (!iso) return '';
  return Utilities.formatDate(new Date(iso), zona, 'dd/MM/yyyy HH:mm');
}
