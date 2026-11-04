// Pruebas de la lógica de tasa BCV (parseo + regla viernes/sáb/dom/lun)
const { parseBcvPage, selectRate, lastFriday17 } = require('../src/rate');

let pass = 0;
const ok = (cond, msg) => { if (!cond) throw new Error('FALLO: ' + msg); pass++; console.log('  ✔ ' + msg); };
const throws = (fn, msg) => { try { fn(); } catch (e) { pass++; console.log('  ✔ ' + msg); return; } throw new Error('FALLO: ' + msg); };

// instante real de una fecha/hora de Caracas (UTC-4)
const CG = (y, m, d, h = 12, min = 0) => Date.UTC(y, m - 1, d, h, min) + 4 * 3600000;

// ---------- 1. Parseo de la página del BCV ----------
const html = `
<div id="euro" class="col-sm-12"><div class="field-content"><div class="row recuadrotsmc">
  <div class="col-sm-6"><img src="/euro.png"><span> EUR </span></div>
  <div class="col-sm-6 centrado textp"><strong class="strong-tb"> 991,16445734</strong></div>
</div></div></div>
Fecha Valor: <span class="date-display-single" content="2026-10-19T00:00:00-04:00">Lunes, 19 Octubre 2026</span>`;

const p = parseBcvPage(html);
ok(p && Math.abs(p.tasa - 991.16445734) < 1e-9, `parsea la tasa del euro: ${p && p.tasa}`);
ok(p.fechaValor === '2026-10-19', 'parsea la Fecha Valor (lunes 19/10/2026)');
ok(parseBcvPage('<html>sin tasas</html>') === null, 'si no hay tasa devuelve null');
ok(parseBcvPage('<div id="euro"><strong class="strong-tb">1.234,56</strong>').tasa === 1234.56, 'admite formato 1.234,56');

// ---------- 2. Regla de selección por día ----------
// Publicación A: viernes 9 oct 17:05 → Fecha Valor lunes 12 oct
// Publicación B: viernes 16 oct 17:10 → Fecha Valor lunes 19 oct
const pubs = [
  { tasa: 950.5, fechaValor: '2026-10-12', firstSeen: CG(2026, 10, 9, 17, 5) },
  { tasa: 991.16445734, fechaValor: '2026-10-19', firstSeen: CG(2026, 10, 16, 17, 10) },
];

// Viernes DESPUÉS de las 5 p.m. → ya rige la tasa nueva (la del lunes)
let r = selectRate(pubs, CG(2026, 10, 16, 18, 0));
ok(r.tasa === 991.16445734, 'vie 16 oct 6:00 p.m. → usa la tasa recién publicada (del lunes 19)');
ok(/lunes/.test(r.regla), '… con la regla "tasa del lunes"');

// Viernes ANTES de las 5 p.m. → aún rige la tasa anterior
r = selectRate(pubs, CG(2026, 10, 16, 10, 0));
ok(r.tasa === 950.5, 'vie 16 oct 10:00 a.m. → usa la tasa anterior (aún no se publica la nueva)');

// Sábado, domingo y lunes → la tasa del lunes publicada el viernes
r = selectRate(pubs, CG(2026, 10, 17, 9, 0));
ok(r.tasa === 991.16445734, 'sábado 17 oct → tasa del lunes (viernes 17:10)');
r = selectRate(pubs, CG(2026, 10, 18, 15, 0));
ok(r.tasa === 991.16445734, 'domingo 18 oct → tasa del lunes');
r = selectRate(pubs, CG(2026, 10, 19, 8, 0));
ok(r.tasa === 991.16445734, 'lunes 19 oct → tasa del lunes');

// Martes a jueves → la tasa vigente publicada en la semana
const pubSemana = { tasa: 1002.75, fechaValor: '2026-10-21', firstSeen: CG(2026, 10, 20, 9, 30) };
r = selectRate([...pubs, pubSemana], CG(2026, 10, 21, 12, 0));
ok(r.tasa === 1002.75, 'miércoles 21 oct → tasa vigente publicada en la semana');
r = selectRate([...pubs, pubSemana], CG(2026, 10, 22, 23, 0));
ok(r.tasa === 1002.75, 'jueves 22 oct → tasa vigente');
r = selectRate([...pubs, pubSemana], CG(2026, 10, 20, 7, 0));
ok(r.tasa === 991.16445734, 'martes 20 oct temprano (antes de publicar) → última tasa conocida');

// Sin datos en el futuro ni historial
ok(selectRate(pubs, CG(2026, 10, 10, 8, 0)).tasa === 950.5, 'antes de toda publicación futura usa la primera conocida');
ok(selectRate([], Date.now()) === null, 'sin historial devuelve null');
ok(selectRate(pubs, CG(2026, 10, 10, 8, 0)) !== null, 'historial con fechas futuras se filtra correctamente');

// ---------- 3. Último viernes 5 p.m. ----------
const f = lastFriday17(CG(2026, 10, 18, 10, 0)); // domingo
ok(f === CG(2026, 10, 16, 17, 0), 'domingo → último viernes 5 p.m. = 16/oct 17:00');
const f2 = lastFriday17(CG(2026, 10, 16, 16, 59)); // viernes antes de las 5
ok(f2 === CG(2026, 10, 9, 17, 0), 'viernes 4:59 p.m. → se toma el viernes anterior');
const f3 = lastFriday17(CG(2026, 10, 16, 17, 1)); // viernes después de las 5
ok(f3 === CG(2026, 10, 16, 17, 0), 'viernes 5:01 p.m. → se toma el viernes de hoy');

console.log(`\n✅ Toda la lógica de la tasa BCV pasa (${pass} aserciones)`);
