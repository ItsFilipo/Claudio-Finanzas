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
assert.deepEqual(worth(w), { liquid: 70000, owed: 50000, owe: 10000, total: 110000 });
assert.equal(toTable(w).split('\n')[2], '2026-10-05\tComida\tAlmuerzo\tNequi\t30000');
console.log('ok saldos');
