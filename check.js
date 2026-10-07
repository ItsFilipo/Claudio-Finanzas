// Prueba rápida de la lógica de dinero: node check.js
const assert = require('assert');
const { money, digits, spentByCat, postRecurring, fresh } = require('./app.js');

assert.equal(money(1800), '$1.800');
assert.equal(money(1234567), '$1.234.567');
assert.equal(money(-5000), '−$5.000');
assert.equal(money(0), '$0');
assert.equal(digits('$ 45.000'), 45000);
assert.equal(digits(''), 0);

const s = fresh(new Date(2026, 9, 25), false);
s.movements.push({ amount: 1000, cat: 'comida', date: '2026-10-02' }, { amount: 500, cat: 'comida', date: '2026-09-30' });
assert.deepEqual(spentByCat(s, '2026-10'), { comida: 1000 });

s.recurring.push({ id: 'r', name: 'Arriendo', amount: 900000, cat: 'casa', method: 'm0', day: 31 });
assert.equal(postRecurring(s, new Date(2026, 8, 30)), 0); // antes de octubre 2026 no se anota nada
assert.equal(postRecurring(s, new Date(2026, 10, 29)), 0); // noviembre tiene 30 días: aún no toca
assert.equal(postRecurring(s, new Date(2026, 10, 30)), 1);
assert.equal(s.movements.at(-1).date, '2026-11-30');
assert.equal(postRecurring(s, new Date(2026, 10, 30)), 0); // no se duplica

assert.ok(fresh(new Date(2026, 8, 25), true).movements.every(m => m.date.startsWith('2026-10'))); // antes de empezar: ejemplos en octubre
assert.ok(fresh(new Date(2026, 10, 3), true).movements.every(m => m.date.startsWith('2026-11-0'))); // ejemplos no se salen del mes
console.log('ok');

// Saldos, deudas y exportar
const { closePos, norm, tidyInv, balance, worth, toTable } = require('./app.js');
const w = fresh(new Date(2026, 9, 5), false);
w.methods[1].base = 100000; w.methods[1].baseT = 10;
w.movements.push({ amount: 20000, cat: 'comida', method: 'm1', date: '2026-10-05', t: 5 }); // antes del saldo: no descuenta
w.movements.push({ amount: 30000, cat: 'comida', method: 'm1', date: '2026-10-05', t: 20, note: 'Almuerzo' });
assert.equal(balance(w, w.methods[1]), 70000);
assert.equal(balance(w, w.methods[0]), null);
w.debts.push({ amount: 50000, dir: 'in' }, { amount: 10000, dir: 'out' });
assert.deepEqual(worth(w), { liquid: 70000, inv: 0, owed: 50000, owe: 10000, cards: 0, total: 110000 });
assert.equal(toTable(w).split('\n')[2], '2026-10-05\tComida\t\tAlmuerzo\tNequi\t30000');
console.log('ok saldos');

// Inversiones: $1.000.000 al 9% EA
const { invest, ymd } = require('./app.js');
const cdt = { amount: 1000000, rate: 9, freq: 'm', compound: false, start: '2026-10-01', months: 12 };
const c1 = invest(cdt, new Date(2026, 11, 15));
assert.equal(Math.round(c1.perPay), 7207); // cada mes te pagan ~$7.207
assert.equal(Math.round(c1.gain), 86488); // 12 pagos aparte
assert.equal(c1.value, 1000000); // pagados aparte: el capital no cambia
assert.equal(ymd(c1.end), '2027-10-01');
const c2 = invest({ ...cdt, compound: true }, new Date(2027, 11, 1));
assert.equal(Math.round(c2.gain), 90000); // compuesto 12 meses = 9% exacto
assert.equal(Math.round(c2.value), 1090000); // ya vencido: vale capital + intereses
const c3 = invest({ ...cdt, freq: 'e', months: 6 }, new Date(2026, 10, 1));
assert.equal(Math.round(c3.gain), 44031); // al vencimiento a 6 meses
const w2 = fresh(new Date(2026, 9, 5), false); w2.investments.push(cdt);
assert.equal(worth(w2, new Date(2026, 9, 5)).total, 1000000);
console.log('ok inversiones');

// Ingresos, transferencias y tarjeta de crédito
const { cardDebt, cardAlerts, insights, search, tagsOf, goalPlan } = require('./app.js');
const f = fresh(new Date(2026, 9, 10), false);
const [efe, neq] = f.methods;
efe.base = 100000; efe.baseT = 1; neq.base = 0; neq.baseT = 1;
const nu = { id: 'nu', name: 'Nu', credit: { limit: 2000000, cut: 5, pay: 15 }, base: 0, baseT: 1 };
f.methods.push(nu);
f.incomes.push({ amount: 2000000, method: neq.id, date: '2026-10-01', t: 5 }); // sueldo a Nequi
f.movements.push({ amount: 300000, cat: 'compras', method: 'nu', date: '2026-10-02', t: 6 }); // compra con tarjeta
f.transfers.push({ amount: 100000, from: neq.id, to: 'nu', date: '2026-10-03', t: 7 }); // pago a la tarjeta
f.transfers.push({ amount: 50000, from: neq.id, to: efe.id, date: '2026-10-03', t: 8 }); // sacar efectivo
assert.equal(balance(f, neq), 2000000 - 100000 - 50000);
assert.equal(balance(f, efe), 150000);
assert.equal(balance(f, nu), null); // la tarjeta no es plata líquida
assert.equal(cardDebt(f, nu), 200000);
assert.equal(worth(f, new Date(2026, 9, 10)).total, 1850000 + 150000 - 200000);
assert.equal(cardAlerts(f, new Date(2026, 9, 10)).length, 1); // paga el 15: faltan 5 días
assert.equal(cardAlerts(f, new Date(2026, 9, 5)).length, 0);

// Gasto dividido: solo cuenta tu parte en los sobres, pero sale completo de la cuenta
const g2 = fresh(new Date(2026, 9, 10), false);
g2.methods[0].base = 100000; g2.methods[0].baseT = 1;
g2.movements.push({ amount: 80000, split: 40000, cat: 'comida', method: 'm0', date: '2026-10-09', t: 2 });
assert.equal(spentByCat(g2, '2026-10').comida, 40000);
assert.equal(balance(g2, g2.methods[0]), 20000);

// Resumen del mes: comparación con el mes anterior a la misma fecha
const h = fresh(new Date(2026, 10, 10), false);
h.movements.push({ amount: 1000, cat: 'comida', date: '2026-10-05' }, { amount: 9000, cat: 'comida', date: '2026-10-20' },
  { amount: 3000, cat: 'casa', date: '2026-11-02' }, { amount: 500, cat: 'comida', date: '2026-11-02' });
const ins = insights(h, '2026-11', new Date(2026, 10, 10));
assert.equal(ins.total, 3500); assert.equal(ins.prevTotal, 1000); // octubre hasta el día 10
assert.deepEqual(ins.topCat, ['casa', 3000]); assert.deepEqual(ins.topDay, ['2026-11-02', 3500]);
assert.equal(ins.avg, 350);
assert.equal(insights(h, '2026-10', new Date(2026, 10, 10)).prevTotal, null); // antes de octubre 2026 no hay comparación

// Búsqueda y etiquetas
h.movements.push({ amount: 1, cat: 'otros', note: 'Hotel #Viaje', date: '2026-11-03' });
assert.equal(search(h, '#viaje').length, 1);
assert.deepEqual(tagsOf('Hotel #Viaje y #playa'), ['#viaje', '#playa']);

// Meta con fecha y retención en la fuente
assert.equal(goalPlan({ target: 1200000, saved: 200000, due: '2027-03' }, new Date(2026, 10, 1)).perMonth, 200000); // nov–mar = 5 meses
assert.equal(Math.round(invest({ ...cdt, ret: true }, new Date(2026, 9, 1)).perPay), Math.round(7207.3 * 0.96));
console.log('ok nuevas funciones');

// Ingreso a una cuenta sin saldo: empieza a contar desde $0 y sube el dinero líquido
const { track, trackAll } = require('./app.js');
const z = fresh(new Date(2026, 9, 5), false);
z.movements.push({ amount: 5000, cat: 'comida', method: 'm1', date: '2026-10-02', t: 10 }); // gasto viejo, sin saldo
z.incomes.push({ amount: 300000, method: 'm1', date: '2026-10-05', t: 20 });
assert.equal(balance(z, z.methods[1]), null); // antes del arreglo: no se veía
trackAll(z);
assert.equal(balance(z, z.methods[1]), 300000);
assert.equal(worth(z).liquid, 300000);
console.log('ok ingreso sin saldo');

// Pago mensual el mismo día de cada mes (también en febrero)
const mm = { amount: 5000000, rate: 9, freq: 'm', compound: false, start: '2026-10-01', months: 6 };
assert.equal(invest(mm, new Date(2027, 1, 28)).earned, invest(mm, new Date(2027, 1, 1)).earned); // feb 1 y feb 28: 4 pagos
assert.ok(invest(mm, new Date(2027, 2, 1)).earned > invest(mm, new Date(2027, 1, 28)).earned); // 1 de marzo: 5 pagos
console.log('ok pagos mensuales');

// Gasto por sobre en varios meses (trimestre, año)
const { spentIn } = require('./app.js');
const q = fresh(new Date(2026, 11, 5), false);
q.movements.push({ amount: 100, cat: 'comida', date: '2026-10-03' }, { amount: 200, cat: 'comida', date: '2026-11-03' }, { amount: 50, cat: 'casa', date: '2026-12-01' }, { amount: 999, cat: 'comida', date: '2027-01-01' });
assert.deepEqual(spentIn(q, '2026-10', '2026-12'), { comida: 300, casa: 50 });
assert.deepEqual(spentIn(q, '2026-01', '2026-12').comida, 300);
console.log('ok periodos');
assert.deepEqual(spentIn(q, '2026-10-01', '2026-11-03'), { comida: 300 }); // rango por días, incluye el día final
assert.deepEqual(spentIn(q, '2026-10-04', '2026-11-02'), {});
console.log('ok rangos por días');

// Ranking de entradas: mismo nombre (sin importar tildes ni mayúsculas) se suma
const { incomeRank } = require('./app.js');
const ir = fresh(new Date(2026, 10, 1), false);
ir.incomes.push({ amount: 50000, note: 'Papá', date: '2026-10-02' }, { amount: 30000, note: ' papa ', date: '2026-10-10' }, { amount: 1500000, note: 'Sueldo', date: '2026-10-30' },
  { amount: 20000, note: 'Pago de Juan', date: '2026-10-11', debt: true }, { amount: 70000, note: 'PAPÁ', date: '2026-11-01' });
const rk = incomeRank(ir, '2026-10', '2026-10');
assert.deepEqual(rk.map(g => [g.name, g.total, g.count]), [['Sueldo', 1500000, 1], ['Papá', 80000, 2]]);
assert.equal(incomeRank(ir, '0000', '9999')[1].total, 150000);
console.log('ok ranking de entradas');

// Subcategorías: gasto de un sobre repartido por restaurante
const { subTotals } = require('./app.js');
const sb = fresh(new Date(2026, 10, 1), false);
sb.movements.push({ amount: 60000, cat: 'comida', sub: 'El Corral', date: '2026-10-05' }, { amount: 40000, cat: 'comida', sub: 'Crepes', date: '2026-10-06' },
  { amount: 30000, cat: 'comida', sub: 'El Corral', date: '2026-10-20' }, { amount: 10000, cat: 'comida', date: '2026-10-21' }, { amount: 5000, cat: 'casa', sub: 'X', date: '2026-10-21' },
  { amount: 99000, cat: 'comida', sub: 'Crepes', date: '2026-11-02' });
assert.deepEqual(subTotals(sb, 'comida', '2026-10', '2026-10').map(g => [g.name, g.total, g.count]), [['El Corral', 90000, 2], ['Crepes', 40000, 1], ['', 10000, 1]]);
assert.equal(subTotals(sb, 'comida', '2026-10', '2026-11')[0].name, 'Crepes'); // 139.000 en dos meses
assert.equal(search(sb, 'corral').length, 2); // la búsqueda encuentra la subcategoría
console.log('ok subcategorías');

// Entró vs. salió
const { cashflow } = require('./app.js');
const cf = fresh(new Date(2026, 10, 1), false);
cf.incomes.push({ amount: 2000000, date: '2026-10-01' }, { amount: 50000, date: '2026-10-09', debt: true }, { amount: 700000, date: '2026-11-01' });
cf.movements.push({ amount: 300000, cat: 'casa', date: '2026-10-02' }, { amount: 80000, split: 40000, cat: 'comida', date: '2026-10-09' }, { amount: 1, cat: 'otros', date: '2026-11-03' });
assert.deepEqual(cashflow(cf, '2026-10', '2026-10'), { inc: 2050000, out: 340000, left: 1710000 }); // el pago de una deuda también entra; el gasto dividido cuenta tu parte
console.log('ok entró vs salió');

// Gráfica: grupos por día, semana, 15 días, mes y trimestre dentro de un rango
const { buckets, rangeFor, rangeLabel } = require('./app.js');
const gb = fresh(new Date(2026, 11, 20), false);
gb.movements.push({ amount: 100, cat: 'comida', date: '2026-10-05' }, { amount: 200, cat: 'comida', date: '2026-10-20' }, { amount: 400, cat: 'comida', date: '2026-11-30' }, { amount: 800, cat: 'comida', date: '2026-12-02' });
const T = '2026-12-20', ALL = '2026-10-01';
assert.deepEqual(buckets(gb, 'm', ALL, T, T).map(b => [b.short, b.total, b.now]), [['oct', 300, false], ['nov', 400, false], ['dic', 800, true]]);
assert.deepEqual(buckets(gb, 'q', ALL, T, T).map(b => [b.short, b.total]), [['1–15 oct', 100], ['16–31 oct', 200], ['1–15 nov', 0], ['16–30 nov', 400], ['1–15 dic', 800], ['16–31 dic', 0]]);
assert.deepEqual(buckets(gb, 't', ALL, T, T).map(b => [b.short, b.total]), [['oct–dic', 1500]]);
assert.equal(buckets(gb, 'm', ALL, ALL, ALL).length, 1);
// por día: solo los 3 días pedidos, y cada día cuenta lo suyo
assert.deepEqual(buckets(gb, 'd', '2026-10-04', '2026-10-06', T).map(b => [b.short, b.total]), [['4 oct', 0], ['5 oct', 100], ['6 oct', 0]]);
// por semana (lunes a domingo): la semana del 5 de oct (lunes) y la del 19
const bw = buckets(gb, 'w', '2026-10-05', '2026-10-25', T);
assert.deepEqual(bw.map(b => [b.from, b.to, b.total]), [['2026-10-05', '2026-10-11', 100], ['2026-10-12', '2026-10-18', 0], ['2026-10-19', '2026-10-25', 200]]);
// un rango que corta un mes: solo cuenta lo que cae dentro del rango
assert.equal(buckets(gb, 'm', '2026-10-10', '2026-10-31', T)[0].total, 200);
const bd = buckets(gb, 'd', '2026-10-01', '2026-12-31', T); // 92 días: se queda con los últimos 60
assert.equal(bd.length, 60); assert.equal(bd.at(-1).from, '2026-12-31');
console.log('ok grupos de la gráfica');
// atajos de fechas
assert.deepEqual(rangeFor('sem', '2026-10-15'), { from: '2026-10-12', to: '2026-10-15' }); // jueves: la semana empezó el lunes 12
assert.deepEqual(rangeFor(15, '2026-10-20'), { from: '2026-10-06', to: '2026-10-20' });
assert.deepEqual(rangeFor(30, '2026-10-05'), { from: '2026-10-01', to: '2026-10-05' }); // nunca antes del 1 de octubre de 2026
assert.deepEqual(rangeFor('anio', '2027-03-10'), { from: '2027-01-01', to: '2027-03-10' });
assert.equal(rangeLabel('2026-10-05', '2026-10-05'), '5 oct');
assert.equal(rangeLabel('2026-10-01', '2026-11-18'), '1 oct – 18 nov');
console.log('ok atajos de fechas');
// apuestas y acciones: sale del líquido, el sobre muestra el resultado, el resultado cuenta en el mes en que metiste la plata
{
  const p = fresh(new Date(2026, 9, 25), false); p.methods[0].base = 80000; p.methods[0].baseT = 0;
  const bet = { id: 'b1', t: 10, split: 0, cat: 'inversiones', note: 'Combinada', amount: 50000, method: 'm0', date: '2026-10-28', pos: { back: null } };
  p.movements.push(bet);
  assert.equal(balance(p, p.methods[0]), 30000);                       // salió del líquido
  assert.equal(spentByCat(p, '2026-10').inversiones, 50000);           // gastado en el sobre Inversiones
  assert.equal(worth(p).inv, 0); assert.equal(worth(p).total, 30000); // las apuestas no suman al dinero total
  bet.pos = { back: 70000, to: 'm0', date: '2026-11-02', t: 20 };        // la cierras en noviembre y ganas
  assert.equal(balance(p, p.methods[0]), 100000);                      // vuelve con la ganancia
  assert.equal(spentByCat(p, '2026-10').inversiones, -20000);          // el sobre de octubre muestra +20.000
  assert.equal(spentByCat(p, '2026-11').inversiones || 0, 0);          // nada cae en noviembre
  assert.equal(worth(p).inv, 0);
  bet.pos = { back: 0, to: 'm0', date: '2026-11-02', t: 20 };           // perdiste todo
  assert.equal(balance(p, p.methods[0]), 30000); assert.equal(spentByCat(p, '2026-10').inversiones, 50000);
}
console.log('ok apuestas y acciones');
// un solo sobre Inversiones y todo gasto en él cuenta como inversión
{
  const q = fresh(new Date(2026, 9, 25), false);
  q.categories.push({ id: 'inversiones', name: 'Inversiones', icon: 'trend', color: '#2E8C86', budget: 0, subs: [] }, { id: 'zz', name: 'inversiones ', icon: 'dots', color: '#111', budget: 0, subs: ['Bolsa'] });
  q.movements.push({ id: 'a', t: 1, split: 0, cat: 'zz', amount: 10000, method: 'm0', date: '2026-10-02' }, { id: 'b', t: 2, split: 0, cat: 'inversiones', amount: 5000, method: 'm0', date: '2026-10-03', pos: { back: null } });
  tidyInv(q);
  assert.equal(q.categories.filter(c => norm(c.name) === 'inversiones').length, 1);
  assert.equal(q.categories.find(c => norm(c.name) === 'inversiones').subs[0], 'Bolsa'); // se queda con el tuyo
  assert.ok(q.movements.every(m => m.cat === 'inversiones' && m.pos && m.pos.back == null));
  assert.equal(worth(q).inv, 0);
}
console.log('ok sobre Inversiones único');
// una sola cuenta con saldo: los gastos con una cuenta sin saldo salen de ella
{
  const q = fresh(new Date(2026, 9, 25), false); q.methods[3].base = 50000; q.methods[3].baseT = 0; // Nu con $50.000, Efectivo sin saldo
  q.movements.push({ id: 'e', t: 5, split: 0, cat: 'comida', amount: 40000, method: 'm0', date: '2026-10-05' });
  assert.equal(balance(q, q.methods[3]), 10000); assert.equal(worth(q).liquid, 10000);
  q.methods[1].base = 20000; q.methods[1].baseT = 0; // ahora dos cuentas con saldo: ya no se adivina
  assert.equal(balance(q, q.methods[3]), 50000);
}
console.log('ok una sola fuente de plata');
// perder una apuesta con una sola cuenta con saldo: el líquido no vuelve a subir
{
  const q = fresh(new Date(2026, 9, 25), false); q.methods[3].base = 100000; q.methods[3].baseT = 0;
  const m = { id: 'p', t: 5, split: 0, cat: 'inversiones', amount: 10000, method: 'm0', date: '2026-10-05', pos: { back: null } };
  q.movements.push(m);
  assert.equal(worth(q).liquid, 90000);
  closePos(q, m, 0, 'm0', '2026-10-06');
  assert.equal(worth(q).liquid, 90000); assert.equal(balance(q, q.methods[3]), 90000);
  closePos(q, m, 4000, 'm0', '2026-10-06'); // recuperas 4.000: vuelven a Nu
  assert.equal(worth(q).liquid, 94000);
}
console.log('ok perder una apuesta');
// CDT: con intereses diarios el patrimonio sube, y los pagados aparte también cuentan
{
  const q = fresh(new Date(2026, 9, 25), false), t = new Date(2026, 9, 31); q.methods[3].base = 80000; q.methods[3].baseT = 0;
  q.investments.push({ id: 'c', name: 'CDT', amount: 20000, rate: 9, freq: 'd', compound: true, start: '2026-10-01', months: 12 });
  q.transfers.push({ id: 't', t: 5, amount: 20000, from: 'm3', to: null, date: '2026-10-01', invId: 'c' });
  assert.equal(worth(q, t).liquid, 60000);
  const a = worth(q, t); assert.ok(a.inv > 20000 && a.total > 80000, JSON.stringify(a));
  q.investments[0].compound = false; assert.ok(worth(q, t).total > 80000);
}
console.log('ok CDT sale del líquido y suma en el total');
// lo que te pagan de una deuda cuenta como "Entró" del mes
{
  const q = fresh(new Date(2026, 9, 25), false);
  q.incomes.push({ id: 'i', t: 5, amount: 50000, method: 'm0', note: 'Pago de Juan', date: '2026-10-07', debt: true });
  assert.equal(cashflow(q, '2026-10', '2026-10').inc, 50000);
}
console.log('ok deuda pagada cuenta como entrada');
// préstamos: salen de la cuenta, cuentan en el sobre Préstamos y bajan a medida que te devuelven
{
  const q = fresh(new Date(2026, 9, 25), false); q.methods[3].base = 100000; q.methods[3].baseT = 0;
  tidyInv(q);
  assert.equal(q.categories.filter(c => c.id === 'prestamos').length, 1);
  const m = { id: 'l', t: 5, split: 0, cat: 'prestamos', amount: 30000, method: 'm3', date: '2026-10-05', loan: { debt: 'd', back: 0 } };
  q.movements.push(m);
  assert.equal(balance(q, q.methods[3]), 70000); assert.equal(spentByCat(q, '2026-10').prestamos, 30000);
  m.loan.back = 10000; q.incomes.push({ id: 'i', t: 9, amount: 10000, method: 'm3', date: '2026-10-08', debt: true });
  assert.equal(spentByCat(q, '2026-10').prestamos, 20000); assert.equal(balance(q, q.methods[3]), 80000);
  m.loan.back = 30000; q.incomes.push({ id: 'j', t: 10, amount: 20000, method: 'm3', date: '2026-10-09', debt: true });
  assert.equal(spentByCat(q, '2026-10').prestamos, 0); assert.equal(balance(q, q.methods[3]), 100000);
}
console.log('ok préstamos');
