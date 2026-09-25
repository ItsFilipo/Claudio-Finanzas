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
