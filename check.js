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
const { balance, worth, toTable } = require('./app.js');
const w = fresh(new Date(2026, 9, 5), false);
w.methods[1].base = 100000; w.methods[1].baseT = 10;
w.movements.push({ amount: 20000, cat: 'comida', method: 'm1', date: '2026-10-05', t: 5 }); // antes del saldo: no descuenta
w.movements.push({ amount: 30000, cat: 'comida', method: 'm1', date: '2026-10-05', t: 20, note: 'Almuerzo' });
assert.equal(balance(w, w.methods[1]), 70000);
assert.equal(balance(w, w.methods[0]), null);
w.debts.push({ amount: 50000, dir: 'in' }, { amount: 10000, dir: 'out' });
assert.deepEqual(worth(w), { liquid: 70000, inv: 0, owed: 50000, owe: 10000, cards: 0, total: 110000 });
assert.equal(toTable(w).split('\n')[2], '2026-10-05\tComida\tAlmuerzo\tNequi\t30000');
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
