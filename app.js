'use strict';

// ---------- Lógica (sin pantalla; se prueba con check.js) ----------

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const money = n => (n < 0 ? '−$' : '$') + Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const big = n => money(n).replace('$', '<span class="cur">$</span>');
const fmtNum = n => (n ? money(n).slice(1) : '');
const fmtDay = d => `${+d.slice(8)} ${new Date(d + 'T00:00').toLocaleDateString('es-CO', { month: 'short' }).replace('.', '')}`;
const digits = s => Number(String(s).replace(/\D/g, '')) || 0;
// La app empieza en octubre de 2026: no se muestran ni se registran meses anteriores.
const START = '2026-10';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Lo que de verdad te costó un gasto: si lo dividiste, sin la parte que te deben.
// Si es una apuesta o acción ya cerrada (m.pos.back), lo que te devolvieron se resta: el sobre muestra solo lo perdido (o ganado).
const own = m => m.amount - (m.split || 0) - (m.pos?.back || 0);
const daysIn = (y, m0) => new Date(y, m0 + 1, 0).getDate();
const prevMonth = m => { const [y, mo] = m.split('-').map(Number); return ymd(new Date(y, mo - 2, 1)).slice(0, 7); };

// Entradas menos salidas de una cuenta desde que fijaste su saldo (gastos, ingresos, transferencias).
function flow(state, m) {
  const tot = (xs, f) => (xs || []).filter(x => f(x) && (x.t || 0) > (m.baseT || 0)).reduce((a, x) => a + x.amount, 0);
  return tot(state.incomes, x => x.method === m.id) + tot(state.transfers, x => x.to === m.id)
    - tot(state.movements, x => x.method === m.id) - tot(state.transfers, x => x.from === m.id)
    + state.movements.filter(x => x.pos?.back && x.pos.to === m.id && x.pos.t > (m.baseT || 0)).reduce((a, x) => a + x.pos.back, 0);
}
// Saldo de una cuenta normal (null si no lo llevas). Las tarjetas de crédito no son plata líquida.
const balance = (state, m) => (m.credit || m.base == null ? null : m.base + flow(state, m));
// Lo que debes en una tarjeta de crédito: lo que debías al fijarla más lo que compraste menos lo que pagaste.
const cardDebt = (state, m) => (m.base || 0) - flow(state, m);

// Si a una cuenta sin saldo le entra o sale plata (ingreso, transferencia, abono), empieza a llevarlo desde $0 justo antes.
function track(state, id, t) {
  const m = state.methods.find(x => x.id === id);
  if (m && !m.credit && m.base == null) { m.base = 0; m.baseT = t - 1; }
}
// Arregla datos viejos: cuentas sin saldo que ya tenían ingresos o transferencias.
function trackAll(state) {
  for (const x of [...(state.incomes || []), ...(state.transfers || [])].sort((a, b) => (a.t || 0) - (b.t || 0)))
    for (const id of [x.method, x.to, x.from]) if (id) track(state, id, x.t || 1);
}

// Tarjetas cuyo día de pago llega en los próximos 5 días y tienen deuda.
function cardAlerts(state, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return state.methods.filter(m => m.credit?.pay).map(m => {
    const debt = cardDebt(state, m);
    let due = new Date(today.getFullYear(), today.getMonth(), Math.min(m.credit.pay, daysIn(today.getFullYear(), today.getMonth())));
    if (due < today) due = new Date(today.getFullYear(), today.getMonth() + 1, Math.min(m.credit.pay, daysIn(today.getFullYear(), today.getMonth() + 1)));
    const days = Math.round((due - today) / 864e5);
    return debt > 0 && days <= 5 ? { m, debt, due, days } : null;
  }).filter(Boolean);
}
// Inversiones: la tasa es efectiva anual (EA); cada frecuencia usa su tasa equivalente.
const FREQ = { d: [365, 'diario', 'Cada día'], w: [52, 'semanal', 'Cada semana'], m: [12, 'mensual', 'Cada mes'], e: [1, 'al vencimiento', 'Al vencimiento'] };
// Con retención en la fuente, el banco se queda con el 4% de cada pago de intereses.
function invest(x, now) {
  const r = x.rate / 100, n = FREQ[x.freq][0], atEnd = x.freq === 'e', net = x.ret ? 0.96 : 1;
  const i = net * (atEnd ? (1 + r) ** ((x.months || 12) / 12) - 1 : (1 + r) ** (1 / n) - 1);
  const perPay = x.amount * i;
  const N = atEnd ? 1 : x.months ? Math.round(n * x.months / 12) : 0;
  const gain = !N ? null : atEnd ? perPay : x.compound ? x.amount * ((1 + i) ** N - 1) : perPay * N;
  const [y, m, d] = x.start.split('-').map(Number), start = new Date(y, m - 1, d);
  // Pagos ya hechos: los mensuales caen el mismo día de cada mes; los demás cada 1/365 o 1/52 de año.
  const monthsGone = (now.getFullYear() - y) * 12 + now.getMonth() - (m - 1) - (now.getDate() < d ? 1 : 0);
  let done = atEnd ? 0 : x.freq === 'm' ? Math.max(0, monthsGone) : Math.floor(Math.max(0, (now - start) / 864e5) / (365 / n));
  if (N) done = Math.min(done, N);
  const end = x.months ? new Date(y, m - 1 + x.months, d) : null;
  const value = x.compound && !atEnd ? x.amount * (1 + i) ** done : x.amount;
  // Ganado hasta la fecha: lo que ya se sumó (compuesto), lo que ya te pagaron (aparte) o todo al vencer.
  const earned = atEnd ? (end && now >= end ? perPay : 0) : x.compound ? value - x.amount : perPay * done;
  return { i, perPay, N, gain, value, earned, start, end };
}

function worth(state, now = new Date()) {
  const liquid = state.methods.reduce((a, m) => a + (balance(state, m) ?? 0), 0);
  const cards = state.methods.filter(m => m.credit).reduce((a, m) => a + Math.max(0, cardDebt(state, m)), 0);
  const owed = state.debts.filter(d => d.dir === 'in').reduce((a, d) => a + d.amount, 0);
  const owe = state.debts.filter(d => d.dir === 'out').reduce((a, d) => a + d.amount, 0);
  // Apuestas y acciones abiertas: la plata ya salió del líquido, pero todavía cuenta como tuya.
  const inv = (state.investments || []).reduce((a, x) => a + invest(x, now).value, 0) + state.movements.filter(m => m.pos && m.pos.back == null).reduce((a, m) => a + m.amount, 0);
  return { liquid, inv, owed, owe, cards, total: liquid + inv + owed - owe - cards };
}
// Gastos como tabla para pegar en Excel o Google Sheets.
// Gasto de un sobre repartido por subcategoría entre dos fechas, de mayor a menor.
function subTotals(state, catId, from, to) {
  const g = new Map();
  for (const m of state.movements) if (m.cat === catId && between(m.date, from, to)) { const k = m.sub || ''; const o = g.get(k) || { name: k, total: 0, count: 0 }; o.total += own(m); o.count++; g.set(k, o); }
  return [...g.values()].sort((a, b) => b.total - a.total);
}
const toTable = state => ['Fecha\tSobre\tSubcategoría\tNota\tMétodo\tValor', ...[...state.movements].sort((a, b) => a.date.localeCompare(b.date)).map(m =>
  [m.date, state.categories.find(c => c.id === m.cat)?.name || 'Sin sobre', m.sub || '', m.note || '', state.methods.find(x => x.id === m.method)?.name || '', m.amount - (m.pos?.back || 0)]
    .map(v => String(v).replace(/[\t\n]/g, ' ')).join('\t'))].join('\n');

// Gasto por sobre entre dos fechas incluidas: meses ('2026-10' a '2026-12') o días ('2026-10-03' a '2026-11-18').
const between = (date, from, to) => date >= from && date <= to + '~';
function spentIn(state, from, to) {
  const t = {};
  for (const m of state.movements) if (between(m.date, from, to)) t[m.cat] = (t[m.cat] || 0) + own(m);
  return t;
}
const spentByCat = (state, month) => spentIn(state, month, month);

// Resumen de un mes: comparación con el anterior a la misma fecha, sobre y día más caros, promedio, ingresos.
function insights(state, month, now) {
  const [y, mo] = month.split('-').map(Number);
  const ms = state.movements.filter(m => m.date.startsWith(month));
  const total = ms.reduce((a, m) => a + own(m), 0);
  const current = month === ymd(now).slice(0, 7);
  const upTo = current ? now.getDate() : 31;
  const prev = prevMonth(month);
  const prevTotal = prev < START ? null : state.movements.filter(m => m.date.startsWith(prev) && +m.date.slice(8) <= upTo).reduce((a, m) => a + own(m), 0);
  const group = key => { const g = {}; for (const m of ms) g[key(m)] = (g[key(m)] || 0) + own(m); return Object.entries(g).sort((a, b) => b[1] - a[1])[0] || null; };
  const income = (state.incomes || []).filter(x => x.date.startsWith(month) && !x.debt).reduce((a, x) => a + x.amount, 0);
  return { total, prev, prevTotal, current, topCat: group(m => m.cat), topDay: group(m => m.date), avg: total / (current ? now.getDate() : daysIn(y, mo - 1)), income };
}

// Nombre normalizado: "Papá", "papa" y " PAPÁ " cuentan como el mismo.
const norm = t => String(t || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
// Ingresos agrupados por nombre entre dos fechas, de mayor a menor total (sin contar pagos de deudas).
function incomeRank(state, from, to) {
  const g = new Map();
  for (const x of state.incomes || []) {
    if (x.debt || !between(x.date, from, to)) continue;
    const k = norm(x.note) || 'ingreso', o = g.get(k) || { key: k, name: (x.note || 'Ingreso').trim(), total: 0, count: 0, last: '' };
    o.total += x.amount; o.count++; if (x.date >= o.last) o.last = x.date;
    g.set(k, o);
  }
  return [...g.values()].sort((a, b) => b.total - a.total);
}

// Entró vs. salió entre dos fechas: ingresos (sin pagos de deudas) contra lo que gastaste.
function cashflow(state, from, to) {
  const inc = (state.incomes || []).filter(x => !x.debt && between(x.date, from, to)).reduce((a, x) => a + x.amount, 0);
  const out = state.movements.filter(m => between(m.date, from, to)).reduce((a, m) => a + own(m), 0);
  return { inc, out, left: inc - out };
}

// Atajos de fechas: esta semana, este mes, últimos 15/30 días, este año, todo. Nunca antes de que empezó la app.
const addDays = (d, k) => { const x = new Date(d + 'T00:00'); x.setDate(x.getDate() + k); return ymd(x); };
function rangeFor(k, today) {
  const y = today.slice(0, 4), mon = addDays(today, -((new Date(today + 'T00:00').getDay() + 6) % 7));
  const from = { sem: mon, mes: today.slice(0, 7) + '-01', 15: addDays(today, -14), 30: addDays(today, -29), anio: `${y}-01-01`, todo: START + '-01' }[k];
  return { from: from < START + '-01' ? START + '-01' : from, to: today };
}
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const shortDay = d => `${+d.slice(8)} ${MES[+d.slice(5, 7) - 1]}`;
const rangeLabel = (from, to) => from === to ? shortDay(from) : `${shortDay(from)}${from.slice(0, 4) !== to.slice(0, 4) ? ' ' + from.slice(2, 4) : ''} – ${shortDay(to)}${from.slice(0, 4) !== to.slice(0, 4) ? ' ' + to.slice(2, 4) : ''}`;

// Controles de rango reutilizables (atajos + Desde/Hasta), que recuerdan el último atajo elegido.
const refresh = st => { if (st.k) Object.assign(st, rangeFor(st.k, todayStr())); return st; };
const chartState = () => refresh(ui.chart ||= { k: 'sem', by: 'd' });
const flowState = () => refresh(ui.flowF ||= { k: 'sem', sort: 'new', kind: 'all' });
const rangeChips = (act, st, presets) => `<div class="chips" role="group" aria-label="Rango de fechas">${presets.map(([k, l]) => `<button type="button" class="chip-btn ${String(st.k) === String(k) ? 'on' : ''}" data-act="${act}" data-k="${k}">${l}</button>`).join('')}</div>
  <div class="two even"><label class="field"><span>Desde</span><input class="text" type="date" name="${act}-from" value="${st.from}" min="${START}-01"></label>
  <label class="field"><span>Hasta</span><input class="text" type="date" name="${act}-to" value="${st.to}" min="${START}-01"></label></div>`;
const PRESET = { sem: 'Esta semana', mes: 'Este mes', 15: '15 días', 30: '30 días', anio: 'Este año', todo: 'Todo' };
const dateLabel = st => st.k ? PRESET[st.k] : rangeLabel(st.from, st.to);
// Barra con dos botones; al tocar uno se abre su cajón de opciones (solo uno a la vez).
const toolbar = (act, open, items) => `<div class="toolbar">${items.map(([w, icon, label]) => `<button type="button" class="tool ${open === w ? 'on' : ''}" data-act="${act}" data-w="${w}" aria-expanded="${open === w}">${ico(icon, 16)}<span>${label}</span>${ico('down', 14)}</button>`).join('')}</div>`;
const drawer = (open, w, html) => open === w ? `<div class="drawer">${html}</div>` : '';
// Cambia una fecha a mano: ordena el rango y suelta el atajo.
function setDates(st, which, v) { if (!v || v < START + '-01') return; st[which] = v; if (st.from > st.to) { if (which === 'from') st.to = v; else st.from = v; } st.k = null; }
// Vuelve a dibujar una ventana sin perder dónde ibas.
const keepScroll = fn => { const d = $('#sheet'), y = d.scrollTop; fn(); d.scrollTop = y; };

// Gastos agrupados en el tiempo entre dos fechas: por día ('d'), semana ('w'), 15 días ('q'), mes ('m') o trimestre ('t').
// Cada grupo cuenta solo lo que cae dentro del rango; devuelve como máximo los últimos 60.
function buckets(state, by, from, to, today) {
  const out = [], add = (short, full, f, t) => { if (f <= to && t >= from) out.push({ short, full, from: f, to: t, now: today >= f && today <= t }); };
  const y0 = +from.slice(0, 4), m0 = +from.slice(5, 7);
  if (by === 'd') for (let d = from; d <= to; d = addDays(d, 1)) add(shortDay(d), `${DIA[new Date(d + 'T00:00').getDay()]} ${shortDay(d)} ${d.slice(0, 4)}`, d, d);
  else if (by === 'w') for (let d = addDays(from, -((new Date(from + 'T00:00').getDay() + 6) % 7)); d <= to; d = addDays(d, 7)) { const e = addDays(d, 6);
    add(`${+d.slice(8)}–${+e.slice(8)} ${MES[+e.slice(5, 7) - 1]}`, `Semana del ${shortDay(d)} al ${shortDay(e)} ${e.slice(0, 4)}`, d, e); }
  else for (let [y, m] = [y0, m0]; `${y}-${pad(m)}` <= to.slice(0, 7); m > 11 ? (y++, m = 1) : m++) {
    const mo = `${y}-${pad(m)}`, n = daysIn(y, m - 1);
    if (by === 'm') add(MES[m - 1], `${MES[m - 1]} ${y}`, `${mo}-01`, `${mo}-${n}`);
    else if (by === 'q') { add(`1–15 ${MES[m - 1]}`, `1 al 15 de ${MES[m - 1]} ${y}`, `${mo}-01`, `${mo}-15`); add(`16–${n} ${MES[m - 1]}`, `16 al ${n} de ${MES[m - 1]} ${y}`, `${mo}-16`, `${mo}-${n}`); }
    else if ((m - 1) % 3 === 0 || (y === y0 && m === m0)) { const q = Math.floor((m - 1) / 3) * 3 + 1, e = `${y}-${pad(q + 2)}`;
      add(`${MES[q - 1]}–${MES[q + 1]}`, `${MES[q - 1]} a ${MES[q + 1]} ${y}`, `${y}-${pad(q)}-01`, `${e}-${daysIn(y, q + 1)}`); }
  }
  const seen = new Set();
  return out.filter(b => !seen.has(b.from) && seen.add(b.from)).slice(-60).map(b => ({ ...b, total: state.movements.filter(x => between(x.date, b.from < from ? from : b.from, b.to > to ? to : b.to)).reduce((a, x) => a + own(x), 0) }));
}

// Búsqueda en todos los gastos por nota, sobre, cuenta o #etiqueta.
const tagsOf = text => (String(text).match(/#[\p{L}\d_]+/gu) || []).map(t => t.toLowerCase());
function search(state, q) {
  q = q.trim().toLowerCase();
  const name = (list, id) => list.find(x => x.id === id)?.name || '';
  return state.movements.filter(m => `${m.note || ''} ${m.sub || ''} ${name(state.categories, m.cat)} ${name(state.methods, m.method)}`.toLowerCase().includes(q));
}

// Meta con fecha: cuánto ahorrar cada mes para llegar (incluye el mes actual y el de la meta).
function goalPlan(g, now) {
  if (!g.due) return null;
  const [y, m] = g.due.split('-').map(Number);
  const months = (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth()) + 1;
  return { months, perMonth: months > 0 ? Math.max(0, g.target - g.saved) / months : null };
}

// Anota los gastos recurrentes cuyo día ya llegó este mes (una vez por mes).
// ponytail: no rellena meses en los que no se abrió la app; agregarlo si hace falta.
function postRecurring(state, now) {
  const month = ymd(now).slice(0, 7);
  if (month < START) return 0;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  let n = 0;
  for (const r of state.recurring) {
    const day = Math.min(r.day, last);
    if (r.last === month || now.getDate() < day) continue;
    const x = { id: uid(), t: Date.now(), amount: r.amount, method: r.method, note: r.name, date: `${month}-${pad(day)}`, rec: r.id };
    if (r.kind === 'in') { track(state, r.method, x.t); (state.incomes ||= []).push(x); } else state.movements.push({ ...x, cat: r.cat });
    r.last = month;
    n++;
  }
  return n;
}

const COLORS = [['#C8912E', 'Ocre'], ['#3F6FA8', 'Azul'], ['#7A5AA6', 'Morado'], ['#2E8C86', 'Verde azulado'], ['#C2544A', 'Rojo'],
  ['#5E8C3A', 'Verde'], ['#D2743A', 'Naranja'], ['#B0508A', 'Rosa'], ['#7C8163', 'Oliva'], ['#4F6275', 'Pizarra']];

function fresh(now, examples) {
  const s = {
    v: 1,
    categories: [
      ['comida', 'Comida', 'utensils', '#C8912E', 0],
      ['transporte', 'Transporte', 'bus', '#3F6FA8', 0],
      ['casa', 'Casa', 'home', '#7A5AA6', 0],
      ['servicios', 'Servicios', 'zap', '#2E8C86', 0],
      ['salidas', 'Salidas', 'glass', '#C2544A', 0],
      ['salud', 'Salud', 'heart', '#5E8C3A', 0],
      ['compras', 'Compras', 'cart', '#D2743A', 0],
      ['otros', 'Otros', 'dots', '#7C8163', 0],
    ].map(([id, name, icon, color, budget]) => ({ id, name, icon, color, budget, subs: [] })),
    methods: ['Efectivo', 'Nequi', 'Bancolombia', 'Nu'].map((name, i) => ({ id: 'm' + i, name })),
    movements: [], goals: [], recurring: [], debts: [], investments: [], incomes: [], transfers: [], quick: [],
    settings: { theme: 'system', method: 'm0' },
  };
  if (examples) {
    const early = ymd(now).slice(0, 7) < START, a = early ? new Date(2026, 9, 1) : now;
    const day = k => { const d = new Date(a); d.setDate(early ? 1 + k : Math.max(1, a.getDate() - k)); return ymd(d); };
    s.movements = [
      [8500, 'comida', 'm0', 'Tinto y pandebono', 0], [18000, 'comida', 'm1', 'Almuerzo', 0],
      [3200, 'transporte', 'm0', 'Bus', 0], [142500, 'comida', 'm2', 'Mercado', 1],
      [12000, 'transporte', 'm1', 'Taxi', 2], [26900, 'servicios', 'm3', 'Netflix', 2],
      [32000, 'salidas', 'm3', 'Cine', 3], [1100000, 'casa', 'm1', 'Arriendo', 4],
      [21400, 'salud', 'm0', 'Droguería', 5], [95000, 'servicios', 'm1', 'Internet', 6],
      [64900, 'compras', 'm3', 'Camiseta', 7], [285000, 'salidas', 'm3', 'Cumpleaños de Laura', 8],
    ].map(([amount, cat, method, note, k], i) => ({ id: uid() + i, t: i, amount, cat, method, note, date: day(k), ex: true }));
    s.goals = [{ id: uid(), name: 'Viaje a Cartagena', target: 2000000, saved: 650000, ex: true }];
  }
  return s;
}

// Todo lo que se guarda pasa por aquí. Para sincronizar con la nube en el futuro, solo cambia este objeto.
const KEY = 'mis-sobres.v1';
const store = {
  load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
  save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; } },
};

// ---------- Íconos ----------

const ICONS = {
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  bus: '<path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  glass: '<path d="M8 22h8"/><path d="M7 10h10"/><path d="M12 15v7"/><path d="M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  dots: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  coffee: '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><path d="M6 2v2"/><path d="M10 2v2"/><path d="M14 2v2"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  shirt: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  sliders: '<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  bars: '<path d="M3 3v18h18"/><path d="M7 16v-5"/><path d="M12 16V6"/><path d="M17 16v-8"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  arrows: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  down2: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  split: '<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.17-2.83L3 3"/><path d="m15 9 6-6"/>',
};
const CAT_ICONS = ['utensils', 'bus', 'home', 'zap', 'glass', 'heart', 'cart', 'coffee', 'car', 'gift',
  'book', 'phone', 'shirt', 'plane', 'music', 'activity', 'card', 'cash', 'target', 'dots'];
const ico = (k, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ICONS.dots}</svg>`;

// ---------- Pantalla ----------

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const todayStr = () => { const t = ymd(new Date()); return t < START + '-01' ? START + '-01' : t; };
const thisMonth = () => todayStr().slice(0, 7);
const byDate = (a, b) => b.date.localeCompare(a.date) || (b.t || 0) - (a.t || 0);
const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);

let S, ui, hostTheme;
const cat = id => S.categories.find(c => c.id === id) || { id, name: 'Sin sobre', icon: 'dots', color: '#7C8163', budget: 0 };
const meth = id => S.methods.find(m => m.id === id)?.name || 'Sin método';

function monthName(m) {
  const [y, mo] = m.split('-').map(Number);
  return cap(new Date(y, mo - 1, 1).toLocaleDateString('es-CO', { month: 'long' })) + (y !== new Date().getFullYear() ? ' ' + y : '');
}
function shiftMonth(m, k) {
  const [y, mo] = m.split('-').map(Number);
  return ymd(new Date(y, mo - 1 + k, 1)).slice(0, 7);
}
function dayLabel(d) {
  const now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  if (d === ymd(now)) return 'Hoy';
  if (d === ymd(y)) return 'Ayer';
  const [yy, mm, dd] = d.split('-').map(Number);
  return cap(new Date(yy, mm - 1, dd).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric' }));
}
// Lo que muestra un sobre: con presupuesto, lo que queda; sin presupuesto, lo gastado.
function shown(c, spent) {
  const b = c.budget;
  return b ? { val: Math.abs(b - spent), r: Math.round(Math.max(0, Math.min(1, (b - spent) / b)) * 100) } : { val: spent, r: 0 };
}

function boot() {
  const saved = store.load();
  hostTheme = document.documentElement.getAttribute('data-theme');
  S = saved || fresh(new Date(), true);
  S.movements = S.movements.filter(m => m.date >= START); // borra lo anterior a octubre 2026
  S.debts ||= [];
  S.investments ||= [];
  delete S.settings.fakeToday;
  S.settings.since ||= ymd(new Date());
  S.categories.forEach(c => { c.subs ||= []; });
  for (const k of ['incomes', 'transfers', 'quick']) S[k] ||= [];
  trackAll(S);
  S.categories.forEach(c => { c.budget = 0; }); // por ahora sin presupuestos: solo se registra lo gastado
  postRecurring(S, new Date());
  ui = { view: 'sobres', month: thisMonth() };
  $('#fab').innerHTML = `${ico('plus', 22)} Anotar gasto`;
  $('#tabs').innerHTML = [['sobres', 'Sobres', 'mail'], ['movs', 'Gastos', 'list'], ['dinero', 'Dinero', 'cash'], ['inversiones', 'Inversión', 'trend'], ['metas', 'Metas', 'target']]
    .map(([v, l, i]) => `<button data-act="tab" data-tab="${v}">${ico(i, 22)}<span>${l}</span></button>`).join('');
  applyTheme();
  commit();
  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('input', e => {
    if (e.target.matches('#amt, [data-money]')) e.target.value = fmtNum(digits(e.target.value));
    if (e.target.id === 'q') { ui.q = e.target.value; $('#mov-results').innerHTML = movResults(); }
    if (e.target.id === 'note' && !ui.add?.id) suggestFrom(e.target.value);
    if (e.target.id === 'inc-note') { // mismo nombre de antes: elige la cuenta de la última vez
      const prev = S.incomes.filter(x => norm(x.note) === norm(e.target.value)).sort(byDate)[0];
      if (prev && e.target.form.elements.method.querySelector(`option[value="${prev.method}"]`)) e.target.form.elements.method.value = prev.method;
    }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'date') refreshWhen();
    if (e.target.name === 'chart-k-from' || e.target.name === 'chart-k-to') { setDates(chartState(), e.target.name.endsWith('from') ? 'from' : 'to', e.target.value); openChart(); }
    if (e.target.name === 'flow-k-from' || e.target.name === 'flow-k-to') { setDates(flowState(), e.target.name.endsWith('from') ? 'from' : 'to', e.target.value); keepScroll(() => openPanel('flows')); }
    if (e.target.name === 'fkind' || e.target.name === 'fsort') { flowState()[e.target.name === 'fkind' ? 'kind' : 'sort'] = e.target.value; keepScroll(() => openPanel('flows')); }
    if (e.target.name === 'horizon') { ui.invYears = +e.target.value; openInvDetail(e.target.dataset.id); }
    if (e.target.name === 'sort') { ui.sort = e.target.value; $('#mov-results').innerHTML = movResults(); }
    if (e.target.name === 'theme') { S.settings.theme = e.target.value; applyTheme(); commit(); }
  });
  document.addEventListener('keydown', e => {
    if (e.target.id === 'amt' && e.key === 'Enter') { e.preventDefault(); saveMov(); }
  });
  $('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
  $('#sheet').addEventListener('close', () => { ui.flowF = ui.flowOpen = ui.chart = ui.chartOpen = null; if (ui.view === 'dinero') render(); }); // lo que cambies vale solo mientras la ventana está abierta
}

function applyTheme() {
  const t = S.settings.theme, r = document.documentElement;
  if (t !== 'system') r.setAttribute('data-theme', t);
  else if (hostTheme) r.setAttribute('data-theme', hostTheme);
  else r.removeAttribute('data-theme');
}

// Un solo sobre "Inversiones": si ya habías creado uno con ese nombre, se usa ese y se junta todo ahí.
// Todo gasto anotado en él cuenta como inversión abierta (sale en la pestaña Inversión).
function tidyInv(state) {
  const mine = state.categories.filter(c => norm(c.name) === 'inversiones');
  const keep = mine.find(c => c.id !== 'inversiones') || mine[0] || { id: 'inversiones', name: 'Inversiones', icon: 'trend', color: '#2E8C86', budget: 0, subs: [] };
  if (!mine.length) state.categories.push(keep);
  const old = new Set(mine.map(c => c.id));
  state.categories = state.categories.filter(c => !mine.includes(c) || c === keep);
  keep.id = 'inversiones';
  for (const x of [...state.movements, ...(state.recurring || []), ...(state.quick || [])]) if (old.has(x.cat)) x.cat = 'inversiones';
  for (const m of state.movements) if (m.cat === 'inversiones' && !m.pos) m.pos = { back: null };
}
function commit() {
  tidyInv(S);
  ui.saveFail = !store.save(S);
  render();
}

function render() {
  for (const v of Object.keys(VIEWS)) $('#v-' + v).hidden = v !== ui.view;
  const el = $('#v-' + ui.view);
  el.innerHTML = VIEWS[ui.view]();
  if (ui.shown !== ui.view) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); ui.shown = ui.view; }
  document.querySelectorAll('[data-tab]').forEach(b => b.dataset.tab === ui.view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  if (ui.flash) runFlash();
}

// Periodo que se ve en Sobres y Gastos: mes, trimestre, año o todo.
function period() {
  const p = ui.period || 'mes', [y, m] = ui.month.split('-').map(Number), now = thisMonth();
  if (p === 'tri') { const q = Math.floor((m - 1) / 3) * 3; const from = `${y}-${pad(q + 1)}`, to = `${y}-${pad(q + 3)}`;
    return { p, from, to, label: `${cap(new Date(y, q, 1).toLocaleDateString('es-CO', { month: 'short' }).replace('.', ''))} – ${new Date(y, q + 2, 1).toLocaleDateString('es-CO', { month: 'short' }).replace('.', '')} ${y}`, step: 3, words: 'este trimestre' }; }
  if (p === 'anio') return { p, from: `${y}-01`, to: `${y}-12`, label: String(y), step: 12, words: `en ${y}` };
  const fmt = d => `${+d.slice(8)} ${new Date(d + 'T00:00').toLocaleDateString('es-CO', { month: 'short' }).replace('.', '')}`;
  if (p === 'dias') { const t = todayStr(), f = new Date(t + 'T00:00'); f.setDate(f.getDate() - ui.days + 1); const from = ymd(f);
    return { p, from, to: t, label: `Últimos ${ui.days} días`, step: 0, words: `en los últimos ${ui.days} días`, chip: `${ui.days} días` }; }
  if (p === 'rango') return { p, ...ui.range, label: `${fmt(ui.range.from)} – ${fmt(ui.range.to)}`, step: 0, words: `del ${fmt(ui.range.from)} al ${fmt(ui.range.to)}`, chip: 'Personalizado' };
  if (p === 'todo') return { p, from: '0000', to: '9999', label: 'Desde el inicio', step: 0, words: 'desde que empezaste' };
  return { p, from: ui.month, to: ui.month, label: monthName(ui.month), step: 1, words: 'en ' + monthName(ui.month).toLowerCase() };
}
const inPeriod = (date, pr) => between(date, pr.from, pr.to);

const gear = () => `<button class="icon-btn" data-act="tab" data-tab="ajustes" aria-label="Ajustes">${ico('sliders')}</button>`;
const monthBar = () => {
  const pr = period();
  return `<header class="top">
  <h1>${pr.p === 'mes' ? `<button class="title-btn" data-act="year" data-y="${ui.month.slice(0, 4)}" aria-label="Ver calendario del año">${pr.label} ${ico('down', 18)}</button>` : pr.label}</h1>
  <div class="top-actions">
    ${pr.step ? `<button class="icon-btn" data-act="month" data-k="-${pr.step}" aria-label="Periodo anterior" ${pr.from.slice(0, 7) <= START ? 'disabled' : ''}>${ico('left')}</button>
    <button class="icon-btn" data-act="month" data-k="${pr.step}" aria-label="Periodo siguiente" ${pr.to.slice(0, 7) >= thisMonth() ? 'disabled' : ''}>${ico('right')}</button>` : ''}
    ${gear()}
  </div>
</header>
<div class="period-bar">
  <button class="chip-btn ${pr.p === 'mes' ? 'on' : ''}" data-act="period" data-p="mes">Mes</button>
  ${pr.p !== 'mes' ? `<button class="chip-btn on" data-act="period-more">${pr.chip || { tri: 'Trimestre', anio: 'Año', todo: 'Desde el inicio' }[pr.p]}</button>` : ''}
  <button class="link" data-act="period-more">Más opciones</button>
</div>`;
};
const topBar = (title, extra = '') => `<header class="top"><h1>${title}</h1><div class="top-actions">${extra}${gear()}</div></header>`;

const banners = () =>
  (S.movements.some(m => m.ex) || S.goals.some(g => g.ex)
    ? `<div class="banner"><span>Estos son datos de ejemplo para que veas cómo funciona.</span><button class="btn small" data-act="clear-ex">Empezar de cero</button></div>` : '') +
  (ui.saveFail ? `<div class="banner bad">Este navegador no está guardando tus datos. Lo que anotes se perderá al cerrar.</div>` : '');

const movRow = m => {
  const c = cat(m.cat), title = m.note || m.sub || c.name;
  const parts = [title !== c.name && c.name, m.sub && title !== m.sub && m.sub, meth(m.method), m.rec && 'recurrente', m.pos?.back != null && `metiste ${money(m.amount)}, recibiste ${money(m.pos.back)}`, m.split && 'te deben ' + money(m.split)].filter(Boolean);
  return `<button class="row" data-act="edit-mov" data-id="${m.id}">
    <span class="dot" style="--c:${c.color}">${ico(c.icon, 16)}</span>
    <span><span class="t">${esc(title)}</span><span class="s">${parts.map(esc).join(' · ')}</span></span>
    <span class="a ${own(m) < 0 ? 'pos' : ''}">${own(m) < 0 ? '+' + money(-own(m)) : money(own(m))}</span></button>`;
};

function envelope(c, spent) {
  const { val, r } = shown(c, spent), b = c.budget;
  const cls = (b && spent > b ? 'over' : b && r < 20 ? 'low' : '') + (r ? '' : ' dry');
  return `<button class="env ${cls}" data-act="open-cat" data-id="${c.id}" style="--c:${c.color};--left:${r}%">
    <span class="seal">${ico(c.icon, 18)}</span>
    <span class="env-name">${esc(c.name)}</span>
    <span class="env-amt" data-amt>${money(val)}</span>
    <span class="env-note">${!b ? 'gastado' : spent > b ? 'te pasaste' : 'quedan de ' + money(b)}</span>
  </button>`;
}

// Resumen del mes en filas: comparación, sobre y día más caros, promedio e ingresos.
// Entró vs. salió del periodo elegido, en tres cuadritos.
function flowStrip(pr) {
  const f = cashflow(S, pr.from, pr.to);
  if (!f.inc && !f.out) return '';
  const tile = (l, v, cls = '') => `<div class="ftile"><small>${l}</small><b class="${cls}">${v}</b></div>`;
  return `<div class="flowstrip" aria-label="Entró contra salió">${tile('Entró', money(f.inc), f.inc ? 'pos' : '')}${tile('Gastaste', money(f.out))}${tile('Quedó', (f.left > 0 ? '+' : '') + money(f.left), f.left < 0 ? 'neg' : f.left > 0 ? 'pos' : '')}</div>`;
}

// Aviso discreto al final de Sobres: solo si hay datos tuyos y pasaron 7 días sin copiar un respaldo.
function backupNote() {
  const st = S.settings, t = todayStr(), real = S.movements.some(m => !m.ex) || S.incomes.length || S.debts.length || S.investments.length;
  const days = Math.floor((new Date(t + 'T00:00') - new Date((st.lastBackup || st.since || t) + 'T00:00')) / 864e5);
  if (!real || days < 7 || (st.backupSnooze && t <= st.backupSnooze)) return '';
  return `<div class="nudge"><span>${st.lastBackup ? `Hace ${days} días no copias un respaldo.` : 'Aún no has copiado un respaldo.'}</span>
    <button class="link" data-act="backup-now">Copiar</button><button class="link soft" data-act="backup-later">Luego</button></div>`;
}

function summaryList() {
  const k = insights(S, ui.month, new Date());
  if (!k.total && !k.income) return '';
  const row = (icon, color, t, sub, a, cls = '') => `<div class="row"><span class="dot" style="--c:${color}">${ico(icon, 16)}</span><span><span class="t">${t}</span><span class="s">${sub}</span></span><span class="a ${cls}">${a}</span></div>`;
  const diff = k.prevTotal == null ? null : k.total - k.prevTotal;
  const c = k.topCat && cat(k.topCat[0]);
  return `<h2 class="sec">Resumen de ${monthName(ui.month).toLowerCase()}</h2><div class="list">
    ${diff == null ? '' : row(diff > 0 ? 'trend' : 'down2', diff > 0 ? '#C2544A' : '#2E8C86', diff > 0 ? 'Gastas más que el mes pasado' : 'Gastas menos que el mes pasado',
      `${monthName(k.prev)}${k.current ? ' a esta fecha' : ''}: ${money(k.prevTotal)}`, (diff > 0 ? '+' : '') + money(diff), diff > 0 ? 'neg' : 'pos')}
    ${c ? row(c.icon, c.color, 'Donde más gastas', esc(c.name), money(k.topCat[1])) : ''}
    ${k.topDay ? row('cal', '#7A5AA6', 'Tu día más caro', dayLabel(k.topDay[0]), money(k.topDay[1])) : ''}
    ${k.total ? row('bolt', '#C8912E', 'Promedio por día', k.current ? 'en lo que va del mes' : 'en todo el mes', money(k.avg)) : ''}
    ${k.income ? row('cash', '#2E8C86', 'Te entró', 'ingresos del mes', money(k.income), 'pos') : ''}
  </div>`;
}

// Lista de la pestaña Gastos: resultados de búsqueda (todos los meses) o el mes con su orden.
function movResults() {
  if (ui.q?.trim()) {
    const found = search(S, ui.q).sort(byDate);
    if (!found.length) return `<p class="empty">No encontré gastos con "${esc(ui.q)}".</p>`;
    return `<p class="sub total">${found.length} ${found.length === 1 ? 'resultado' : 'resultados'} · ${money(sum(found, own))} en total</p>
      <div class="list" style="margin-top:12px">${found.map(m => movRow(m).replace('<span class="s">', `<span class="s">${dayLabel(m.date)}${m.date.slice(0, 7) !== thisMonth() ? ' de ' + monthName(m.date.slice(0, 7)).toLowerCase() : ''} · `)).join('')}</div>`;
  }
  const pr = period(), list = S.movements.filter(m => inPeriod(m.date, pr)).sort(byDate);
  if (!list.length) return `<p class="empty">No hay gastos ${pr.words}. Toca <b>Anotar gasto</b> para registrar el primero.</p>`;
  const sort = ui.sort || 'new';
  const head = `<p class="sub total">${list.length} ${list.length === 1 ? 'gasto' : 'gastos'} · ${money(sum(list, own))}</p>
    <div class="seg" role="radiogroup" aria-label="Ordenar" style="margin-top:12px">${[['new', 'Recientes'], ['high', 'Más caros'], ['low', 'Más baratos']]
      .map(([v, l]) => `<label><input type="radio" name="sort" value="${v}" ${sort === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
  if (sort !== 'new') {
    const sorted = [...list].sort((a, b) => (sort === 'high' ? own(b) - own(a) : own(a) - own(b)) || byDate(a, b));
    return head + `<div class="list" style="margin-top:16px">${sorted.map(m => movRow(m).replace('<span class="s">', `<span class="s">${dayLabel(m.date)}${pr.p !== 'mes' ? ' de ' + monthName(m.date.slice(0, 7)).toLowerCase() : ''} · `)).join('')}</div>`;
  }
  const days = new Map();
  for (const m of list) days.set(m.date, [...(days.get(m.date) || []), m]);
  return head + [...days].map(([d, ms]) => `<h2 class="day"><span>${dayLabel(d)}${pr.p !== 'mes' && !['Hoy', 'Ayer'].includes(dayLabel(d)) ? ' de ' + monthName(d.slice(0, 7)).toLowerCase() : ''}</span><span>${money(sum(ms, own))}</span></h2><div class="list">${ms.map(movRow).join('')}</div>`).join('');
}

const VIEWS = {
  sobres() {
    const pr = period(), spent = spentIn(S, pr.from, pr.to);
    const total = sum(Object.values(spent), x => x);
    const withBudget = S.categories.filter(c => c.budget > 0);
    const budget = sum(withBudget, c => c.budget);
    const left = budget - sum(withBudget, c => spent[c.id] || 0);
    const recent = S.movements.filter(m => inPeriod(m.date, pr)).sort(byDate).slice(0, 4);
    return monthBar() + banners() + `
    <section class="summary">${budget
      ? `<p class="big ${left < 0 ? 'neg' : ''}">${big(left)}</p><p class="sub">${left < 0 ? 'te pasaste del presupuesto' : 'te quedan de ' + money(budget)} · gastaste ${money(total)}</p>`
      : `<p class="big">${big(total)}</p><p class="sub">gastado ${pr.words}</p>`}
    </section>
    ${cardAlerts(S, new Date()).map(a => `<button class="banner alert" data-act="tab" data-tab="dinero">${ico('card', 18)}<span>Paga tu <b>${esc(a.m.name)}</b> ${a.days === 0 ? 'hoy' : a.days === 1 ? 'mañana' : `en ${a.days} días`}: ${money(a.debt)}</span></button>`).join('')}
    ${flowStrip(pr)}
    <div class="envelopes">${S.categories.map(c => envelope(c, spent[c.id] || 0)).join('')}</div>
    ${pr.p === 'mes' ? summaryList() : ''}
    ${recent.length ? `<h2 class="sec">Últimos gastos</h2><div class="list">${recent.map(movRow).join('')}</div>` : ''}
    ${backupNote()}`;
  },

  movs() {
    const tags = [...new Set(S.movements.flatMap(m => tagsOf(m.note || '')))];
    return monthBar() + banners() + `<label class="searchbox">${ico('search', 18)}<input id="q" type="search" placeholder="Buscar: Rappi, taxi, #viaje…" value="${esc(ui.q || '')}" autocomplete="off" aria-label="Buscar gastos"></label>
      ${tags.length ? `<div class="chips tags">${tags.map(t => `<button class="chip-btn ${ui.q === t ? 'on' : ''}" data-act="tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
      <div class="list" style="margin-bottom:14px"><button class="row" data-act="chart"><span class="dot" style="--c:#2E8C86">${ico('bars', 16)}</span><span><span class="t">Gráfica de gastos</span><span class="s">Por 15 días, mes o trimestre</span></span>${ico('right', 18)}</button></div>
      <div id="mov-results">${movResults()}</div>`;
  },

  dinero() {
    const w = worth(S), cards = S.methods.filter(m => m.credit);
    const ff = flowState(), nFlows = S.incomes.filter(x => between(x.date, ff.from, ff.to)).length + S.transfers.filter(x => between(x.date, ff.from, ff.to)).length;
    const row = (panel, icon, color, t, sub, a, cls = '') => `<button class="row" data-act="panel" data-p="${panel}"><span class="dot" style="--c:${color}">${ico(icon, 16)}</span>
      <span><span class="t">${t}</span>${sub ? `<span class="s">${sub}</span>` : ''}</span><span class="a ${cls}">${a}</span></button>`;
    // Una cuenta sin saldo no mueve el líquido: avisa cuáles gastaste sin poner cuánto tenían.
    const noBal = S.methods.filter(m => !m.credit && m.base == null && S.movements.some(x => x.method === m.id));
    return topBar('Dinero') + banners() + noBal.map(m => `<button class="banner alert" data-act="meth-edit" data-id="${m.id}">${ico('cash', 18)}<span>Pon cuánto tienes en <b>${esc(m.name)}</b> para que el líquido baje cuando gastas con ella.</span></button>`).join('') + `
    <div class="list worth-list">
      ${row('liquid', 'cash', '#4F6275', 'Líquido', `${S.methods.filter(m => !m.credit).length} cuentas`, money(w.liquid), w.liquid < 0 ? 'neg' : '')}
      ${w.inv ? `<button class="row" data-act="tab" data-tab="inversiones"><span class="dot" style="--c:#2E8C86">${ico('trend', 16)}</span><span><span class="t">Inversiones</span></span><span class="a pos">+${money(w.inv)}</span></button>` : ''}
      ${row('in', 'user', '#2E8C86', 'Te deben', `${S.debts.filter(d => d.dir === 'in').length || 'Nadie'} ${S.debts.filter(d => d.dir === 'in').length === 1 ? 'persona' : S.debts.some(d => d.dir === 'in') ? 'personas' : ''}`.trim(), (w.owed ? '+' : '') + money(w.owed), w.owed ? 'pos' : '')}
      ${row('out', 'user', '#C2544A', 'Debes', `${S.debts.filter(d => d.dir === 'out').length || 'Nada'} ${S.debts.filter(d => d.dir === 'out').length === 1 ? 'deuda' : S.debts.some(d => d.dir === 'out') ? 'deudas' : ''}`.trim(), (w.owe ? '−' : '') + money(w.owe), w.owe ? 'neg' : '')}
      ${row('cards', 'card', '#7A5AA6', 'Tarjetas de crédito', cards.length ? `${cards.length} ${cards.length === 1 ? 'tarjeta' : 'tarjetas'}` : 'Agrega tu tarjeta', (w.cards ? '−' : '') + money(w.cards), w.cards ? 'neg' : '')}
      <div class="row total"><span class="dot" style="--c:var(--accent)">${ico('target', 16)}</span><span><span class="t">Dinero total</span></span><span class="a ${w.total < 0 ? 'neg' : ''}">${money(w.total)}</span></div>
    </div>
    <div class="actions duo"><button class="btn" data-act="inc-edit">${ico('down2', 18)} Ingreso</button><button class="btn" data-act="tr-edit">${ico('arrows', 18)} Transferir</button></div>
    <div class="list" style="margin-top:14px">${row('flows', 'arrows', '#4F6275', `Entradas y transferencias`, dateLabel(ff), nFlows ? `${nFlows}` : '—')}</div>`;
  },

  inversiones() {
    const now = new Date(), xs = S.investments.map(x => ({ x, c: invest(x, now) }));
    const head = topBar('Inversión', `<button class="btn small" data-act="inv-edit">${ico('plus', 16)} Nueva</button>`) + banners();
    const bets = betsList();
    if (!xs.length) return head + `<div class="empty"><p>Registra un CDT, una cajita o cualquier inversión con su tasa EA y mira cuánto te paga y cuánto vas a ganar.</p>
      <button class="btn primary" data-act="inv-edit">${ico('plus', 18)} Agregar inversión</button></div>` + bets;
    const gain = sum(xs, o => o.c.gain || 0);
    const card = ({ x, c }) => {
      const atEnd = x.freq === 'e', f = FREQ[x.freq];
      // Compuesto: lo que suma hoy se calcula sobre el valor actual (capital + intereses ya sumados).
      const pay = atEnd ? ['Al vencimiento te pagan', c.perPay] : x.compound ? ['Próximos intereses', c.value * c.i] : [`${f[2]} te pagan`, c.perPay];
      return `<button class="inv" data-act="inv-detail" data-id="${x.id}">
        <span class="inv-head"><span class="inv-name">${esc(x.name)}</span><span class="pill">${String(x.rate).replace('.', ',')}% EA · ${f[1]}${x.ret ? ' · con retención' : ''}</span></span>
        <span class="inv-amt">${big(c.value)}</span>
        <span class="inv-facts">
          <span><small>${pay[0]}</small><b>${money(pay[1])}</b></span>
          <span><small>Al final ganas</small><b>${c.gain == null ? '—' : money(c.gain)}</b></span>
          <span><small>Vence</small><b>${c.end ? `${c.end.getDate()} ${c.end.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '')} ${c.end.getFullYear()}` : 'Sin fecha'}</b></span>
        </span></button>`;
    };
    return head + `<section class="summary"><p class="big">${big(sum(xs, o => o.c.value))}</p>
      <p class="sub">invertido${gain ? ` · vas a ganar ${money(gain)} en total` : ''}</p></section>
      <div class="invs">${xs.map(card).join('')}</div>` + bets;
  },

  metas() {
    const card = g => {
      const p = Math.min(100, Math.round(g.saved / g.target * 100)) || 0;
      return `<article class="goal">
        <div class="goal-head"><h2>${esc(g.name)}</h2><button class="link" data-act="goal-edit" data-id="${g.id}">Editar</button></div>
        <p class="goal-amt"><b>${money(g.saved)}</b> de ${money(g.target)}</p>
        ${(() => { const pl = goalPlan(g, new Date(todayStr() + 'T00:00')); if (!pl || g.saved >= g.target) return '';
          const when = monthName(g.due).toLowerCase();
          return `<p class="goal-plan">${ico('cal', 16)}<span>${pl.months > 0 ? `Para ${when}: ahorra <b>${money(pl.perMonth)}</b> al mes` : `La fecha (${when}) ya pasó`}</span></p>`; })()}
        <div class="bar" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100" aria-label="Progreso de ${esc(g.name)}"><span style="width:${p}%"></span></div>
        <div class="goal-foot"><span>${g.saved >= g.target ? '¡Lo lograste!' : `${p}% · faltan ${money(g.target - g.saved)}`}</span><button class="btn small primary" data-act="goal-add" data-id="${g.id}">Abonar</button></div>
      </article>`;
    };
    return topBar('Metas', `<button class="btn small" data-act="goal-edit">${ico('plus', 16)} Nueva</button>`) + banners() +
      (S.goals.length ? `<div class="goals">${S.goals.map(card).join('')}</div>`
        : `<p class="empty">Aún no tienes metas. Crea una para ahorrar para algo que quieras: un viaje, un computador o un fondo de emergencia.</p>`);
  },

  ajustes() {
    const th = S.settings.theme;
    return `<header class="top"><div class="top-back"><button class="icon-btn" data-act="tab" data-tab="${ui.back || 'sobres'}" aria-label="Volver">${ico('left')}</button><h1>Ajustes</h1></div></header>
    <section class="set"><h2 class="sec" style="margin-block:12px 10px">Apariencia</h2>
      <div class="seg" role="radiogroup" aria-label="Tema">${[['system', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']]
        .map(([v, l]) => `<label><input type="radio" name="theme" value="${v}" ${th === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    </section>
    <section class="set"><h2 class="sec">Organización</h2>
      <div class="list"><button class="row" data-act="cats"><span class="dot" style="--c:#C8912E">${ico('mail', 16)}</span>
        <span><span class="t">Tus sobres</span><span class="s">${S.categories.length} sobres · crear, editar o eliminar</span></span>${ico('right', 18)}</button>
        <button class="row" data-act="quicks"><span class="dot" style="--c:#C8912E">${ico('bolt', 16)}</span>
        <span><span class="t">Gastos frecuentes</span><span class="s">${S.quick.length ? `${S.quick.length} guardados` : 'Anótalos con un toque'}</span></span>${ico('right', 18)}</button>
        <button class="row" data-act="recs"><span class="dot" style="--c:#2E8C86">${ico('repeat', 16)}</span>
        <span><span class="t">Recurrentes</span><span class="s">${S.recurring.length ? `${S.recurring.length} cada mes` : 'Se anotan solos cada mes'}</span></span>${ico('right', 18)}</button></div>
    </section>
    <section class="set"><h2 class="sec">Tus datos</h2>
      <p class="hint" style="margin-bottom:12px">Todo se guarda solo en este dispositivo. De vez en cuando copia un respaldo y pégalo en tus notas.</p>
      <button class="btn wide" data-act="export" style="margin-bottom:10px">Copiar gastos para Excel</button>
      <div class="actions"><button class="btn" data-act="backup">Copiar respaldo</button><button class="btn" data-act="restore">Restaurar respaldo</button><button class="btn danger" data-act="wipe" data-confirm>Borrar todo</button></div>
    </section>`;
  },
};

// ---------- Hojas ----------

function openSheet(html, focus) {
  const d = $('#sheet');
  d.innerHTML = `<div class="sheet">${html}</div>`;
  if (!d.open) d.showModal();
  const f = focus && d.querySelector(focus);
  if (f) f.focus(); else { const sh = d.querySelector('.sheet'); sh.tabIndex = -1; sh.focus({ preventScroll: true }); }
}
const closeSheet = () => $('#sheet').close();
const sheetTop = (title, right = '<span></span>') =>
  `<div class="sheet-top"><button type="button" class="icon-btn" data-act="close" aria-label="Cerrar">${ico('x')}</button><h2>${title}</h2>${right}</div>`;
const actions = (id, del) => `<div class="actions">${id ? `<button type="button" class="btn danger" data-act="${del}" data-id="${id}" data-confirm>Eliminar</button>` : ''}<button class="btn primary">Guardar</button></div>`;
const moneyField = (name, label, v, ph = '') =>
  `<label class="field"><span>${label}</span><input class="text" name="${name}" inputmode="numeric" data-money autocomplete="off" value="${fmtNum(v)}" placeholder="${ph}"></label>`;
const textField = (name, label, v) =>
  `<label class="field"><span>${label}</span><input class="text" name="${name}" value="${esc(v)}" required maxlength="40" autocomplete="off"></label>`;
const select = (name, label, items, v) =>
  `<label class="field"><span>${label}</span><select class="text" name="${name}">${items.map(x => `<option value="${x.id}" ${x.id === v ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>`;

// Subcategorías del sobre elegido (por ejemplo, restaurantes dentro de Comida).
const subChips = (catId, sel) => { const c = cat(catId);
  return c.subs?.length ? `<div class="subs" role="group" aria-label="Subcategoría"><span class="subs-t">¿Dónde o qué fue? (opcional)</span><div class="chips">${c.subs.map(n =>
    `<button type="button" class="chip-btn ${n === sel ? 'on' : ''}" data-act="sub" data-n="${esc(n)}">${esc(n)}</button>`).join('')}</div></div>` : ''; };
// Resalta Hoy / Ayer / Anteayer según la fecha escrita.
function refreshWhen() {
  const d = $('#date')?.value, base = new Date(todayStr() + 'T00:00');
  document.querySelectorAll('.when [data-k]').forEach(b => { const x = new Date(base); x.setDate(x.getDate() - +b.dataset.k);
    b.classList.toggle('on', ymd(x) === d); b.disabled = ymd(x) < START + '-01'; });
}

function openAdd(opts = {}) {
  const m = opts.id && S.movements.find(x => x.id === opts.id);
  ui.add = { id: m?.id, cat: m?.cat || opts.cat || null, sub: m?.sub || '' };
  const method = m?.method || (S.methods.some(x => x.id === S.settings.method) ? S.settings.method : S.methods[0].id);
  const notes = [...new Set(S.movements.filter(x => x.note).sort(byDate).map(x => x.note))].slice(0, 40);
  const debt = m?.debt && S.debts.find(d => d.id === m.debt);
  openSheet(sheetTop(m ? 'Editar gasto' : 'Anotar gasto') + `
    ${!m && S.quick.length ? `<div class="quick" role="group" aria-label="Gastos frecuentes">${S.quick.map(q => `<button type="button" class="quick-btn" data-act="quick" data-id="${q.id}" style="--c:${cat(q.cat).color}">${ico(cat(q.cat).icon, 15)}<span>${esc(q.note)}</span><b>${money(q.amount)}</b></button>`).join('')}</div>` : ''}
    <label class="amount"><span>$</span><input id="amt" inputmode="numeric" enterkeyhint="done" autocomplete="off" placeholder="0" value="${m ? fmtNum(m.amount) : ''}" aria-label="Valor del gasto"></label>
    <p class="hint" id="add-hint">${m ? 'Cambia lo que necesites y toca Guardar.' : 'Escribe el valor y toca el sobre de donde sale.'}</p>
    <div class="pick" role="group" aria-label="Sobre">${S.categories.map(c => `<button type="button" class="pick-cat" data-act="pick" data-id="${c.id}" style="--c:${c.color}" aria-pressed="${ui.add.cat === c.id}">
      <span class="seal sm">${ico(c.icon, 16)}</span><span>${esc(c.name)}</span></button>`).join('')}</div>
    <div id="subs">${ui.add.cat ? subChips(ui.add.cat, ui.add.sub) : ''}</div>
    <div class="chips" role="radiogroup" aria-label="Método de pago">${S.methods.map(x => `<label class="chip"><input type="radio" name="method" value="${x.id}" ${x.id === method ? 'checked' : ''}><span>${esc(x.name)}</span></label>`).join('')}</div>
    <div class="two"><input class="text" id="note" list="notes-dl" placeholder="Nota: Rappi #viaje" value="${esc(m?.note || '')}" maxlength="60" aria-label="Nota" autocomplete="off"><input class="text" type="date" id="date" value="${m?.date || todayStr()}" min="${START}-01" aria-label="Fecha"></div>
    <div class="when" role="group" aria-label="Día del gasto">${[[0, 'Hoy'], [1, 'Ayer'], [2, 'Anteayer']].map(([k, l]) => `<button type="button" class="chip-btn" data-act="when" data-k="${k}">${l}</button>`).join('')}<span class="hint">¿Se te olvidó? Elige el día.</span></div>
    <datalist id="notes-dl">${notes.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <details class="split" ${m?.split ? 'open' : ''}><summary>${ico('split', 16)} Dividir con alguien</summary>
      <div class="two even">
        <input class="text" id="split-who" placeholder="¿Quién te debe?" value="${esc(debt?.who || '')}" maxlength="30" aria-label="Quién te debe">
        <input class="text" id="split-amt" data-money inputmode="numeric" placeholder="Cuánto te debe" value="${fmtNum(m?.split || 0)}" aria-label="Cuánto te debe">
      </div>
      <button type="button" class="link" data-act="half">Mitad y mitad</button>
      <p class="hint">Pagaste todo, así que sale completo de tu cuenta. En tus sobres solo cuenta tu parte, y lo demás queda en "Me deben".</p>
    </details>
    ${m ? `<button type="button" class="link" data-act="make-quick" style="justify-self:start">${ico('bolt', 16)} Guardar como gasto frecuente</button>
      <div class="actions"><button type="button" class="btn danger" data-act="del-mov" data-confirm>Eliminar</button><button type="button" class="btn primary" data-act="save-mov">Guardar</button></div>`
      : `<button type="button" class="btn primary wide" data-act="save-mov">Guardar</button>`}`, '#amt');
  refreshWhen();
}

// Si la nota ya la usaste antes, elige el mismo sobre y la misma cuenta.
function suggestFrom(note) {
  const prev = note.trim() && S.movements.filter(x => x.note?.toLowerCase() === note.trim().toLowerCase()).sort(byDate)[0];
  if (!prev) return;
  ui.add.cat = prev.cat; ui.add.sub = prev.sub || '';
  document.querySelectorAll('.pick-cat').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === prev.cat));
  $('#subs').innerHTML = subChips(prev.cat, ui.add.sub);
  const r = document.querySelector(`input[name=method][value="${prev.method}"]`);
  if (r) r.checked = true;
  const h = $('#add-hint');
  h.className = 'hint';
  h.textContent = `Como la última vez: ${cat(prev.cat).name} con ${meth(prev.method)}. Toca Guardar.`;
}

function nudge(msg) {
  const h = $('#add-hint');
  h.textContent = msg;
  h.className = 'hint err';
  void h.offsetWidth;
  h.classList.add('shake');
}

function saveMov() {
  const amount = digits($('#amt').value);
  if (!amount) { $('#amt').focus(); return nudge('Escribe el valor primero.'); }
  if (!ui.add.cat) return nudge('Ahora toca el sobre de donde sale.');
  const data = {
    amount, cat: ui.add.cat, method: document.querySelector('input[name=method]:checked')?.value,
    note: $('#note').value.trim(), date: $('#date').value >= START ? $('#date').value : todayStr(), sub: ui.add.sub || '',
  };
  const who = $('#split-who').value.trim(), share = Math.min(amount, digits($('#split-amt').value));
  if (share && !who) return nudge('Escribe quién te debe la otra parte.');
  data.split = share && who ? share : 0;
  const editing = ui.add.id;
  closeSheet();
  if (!editing) return addMov(data, who);
  const m = S.movements.find(x => x.id === editing);
  Object.assign(m, data); delete m.ex;
  const d = m.debt && S.debts.find(x => x.id === m.debt);
  if (data.split && d) Object.assign(d, { who, amount: data.split });
  else if (data.split) { m.debt = uid(); S.debts.push({ id: m.debt, who, amount: data.split, note: m.note || cat(m.cat).name, dir: 'in' }); }
  ui.month = data.date.slice(0, 7);
  commit();
  toast(`Guardado: ${money(amount)} en ${cat(m.cat).name}`);
}

// Anota un gasto nuevo (desde la hoja o un gasto frecuente) con la animación del sobre y opción de deshacer.
function addMov(data, who) {
  const c = cat(data.cat), month = data.date.slice(0, 7);
  const before = shown(c, spentByCat(S, month)[c.id] || 0);
  const m = { id: uid(), t: Date.now(), split: 0, ...data };
  S.movements.push(m);
  if (m.split) { m.debt = uid(); S.debts.push({ id: m.debt, who, amount: m.split, note: m.note || c.name, dir: 'in' }); }
  S.settings.method = data.method;
  ui.month = month;
  if (ui.view === 'sobres') ui.flash = { cat: c.id, from: before, to: shown(c, spentByCat(S, month)[c.id] || 0) };
  commit();
  toast(`Anotado: ${money(data.amount)} en ${c.name}${m.split ? ` · ${who} te debe ${money(m.split)}` : ''}`, () => {
    S.movements = S.movements.filter(x => x !== m);
    S.debts = S.debts.filter(d => d.id !== m.debt);
    commit();
  });
}

// Momento propio de la app: el sobre abre la solapa y la plata baja.
function runFlash() {
  const f = ui.flash;
  ui.flash = null;
  const el = document.querySelector(`.env[data-id="${f.cat}"]`);
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.scrollIntoView({ block: 'nearest' });
  el.classList.add('took');
  el.style.setProperty('--left', f.from.r + '%');
  requestAnimationFrame(() => requestAnimationFrame(() => el.style.setProperty('--left', f.to.r + '%')));
  const amt = el.querySelector('[data-amt]'), t0 = performance.now();
  const step = t => {
    const p = Math.min(1, (t - t0) / 800), e = 1 - Math.pow(1 - p, 3);
    amt.textContent = money(f.from.val + (f.to.val - f.from.val) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function openCatDetail(id) {
  const c = cat(id);
  const pr = period(), ms = S.movements.filter(m => m.cat === id && inPeriod(m.date, pr)).sort(byDate);
  const s = sum(ms, own), b = c.budget, subs = subTotals(S, id, pr.from, pr.to);
  openSheet(sheetTop(esc(c.name), `<button class="link" data-act="cat-edit" data-id="${id}">Editar</button>`) + `
    <div><p class="big sm ${b && s > b ? 'neg' : ''}">${big(b ? b - s : s)}</p>
    <p class="sub">${b ? (s > b ? 'te pasaste' : 'quedan de ' + money(b)) + ' · gastaste ' + money(s) : 'gastado'} ${pr.words}</p></div>
    <button class="btn primary wide" data-act="add-in" data-id="${id}">${ico('plus', 18)} Anotar gasto en ${esc(c.name)}</button>
    ${subs.length > 1 || subs[0]?.name ? `<h2 class="sec">Por subcategoría</h2><div class="list">${subs.map(g => `<div class="row plain"><span><span class="t">${esc(g.name || 'Sin subcategoría')}</span><span class="s">${g.count} ${g.count === 1 ? 'gasto' : 'gastos'}${s ? ' · ' + Math.round(g.total / s * 100) + '%' : ''}</span></span><span class="a">${money(g.total)}</span></div>`).join('')}</div>` : ''}
    ${ms.length ? `<h2 class="sec">Gastos</h2><div class="list">${ms.map(movRow).join('')}</div>` : `<p class="empty" style="padding-block:8px">Nada anotado en este sobre ${pr.words}.</p>`}`);
}

function openCatEdit(id) {
  const c = id ? cat(id) : { name: '', icon: 'dots', color: COLORS[S.categories.length % COLORS.length][0], budget: 0 };
  openSheet(sheetTop(id ? 'Editar sobre' : 'Nuevo sobre') + `<form class="form" data-form="cat" data-id="${id || ''}">
    ${textField('name', 'Nombre', c.name)}
    <label class="field"><span>Subcategorías (opcional)</span><input class="text" name="subs" value="${esc((c.subs || []).join(', '))}" autocomplete="off" placeholder="Ej. El Corral, Crepes, Mercado"></label>
    <p class="hint" style="margin-top:-8px">Sepáralas con coma. Al anotar un gasto de este sobre eliges cuál fue, y luego ves cuánto llevas en cada una. Si cambias un nombre, los gastos viejos conservan el anterior.</p>
    <fieldset class="field"><legend>Ícono</legend><div class="icons">${CAT_ICONS.map(k => `<label class="ic"><input type="radio" name="icon" value="${k}" ${k === c.icon ? 'checked' : ''} aria-label="${k}"><span>${ico(k)}</span></label>`).join('')}</div></fieldset>
    <fieldset class="field"><legend>Color</legend><div class="colors">${COLORS.map(([k, n]) => `<label class="sw" style="--c:${k}"><input type="radio" name="color" value="${k}" ${k === c.color ? 'checked' : ''} aria-label="${n}"><span></span></label>`).join('')}</div></fieldset>
    ${actions(id, 'cat-del')}</form>`, id ? null : 'input[name=name]');
}

function openRec(id) {
  const r = id ? S.recurring.find(x => x.id === id) : { name: '', amount: 0, cat: S.categories[0]?.id, method: S.methods[0].id, day: new Date().getDate() };
  openSheet(sheetTop(id ? 'Editar recurrente' : 'Nuevo gasto recurrente') + `<form class="form" data-form="rec" data-id="${id || ''}">
    <div class="seg two-opt" role="radiogroup" aria-label="Tipo">${[['out', 'Gasto'], ['in', 'Ingreso']].map(([v, l]) => `<label><input type="radio" name="kind" value="${v}" ${(r.kind || 'out') === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    ${textField('name', 'Nombre', r.name)}
    ${moneyField('amount', 'Valor', r.amount, '0')}
    ${select('cat', 'Sobre (si es gasto)', S.categories, r.cat)}
    ${select('method', 'Método de pago', S.methods, r.method)}
    <label class="field"><span>Día del mes</span><input class="text" type="number" name="day" min="1" max="31" value="${r.day}" required></label>
    <p class="hint">Se anota solo ese día de cada mes. Si el día ya pasó este mes, empieza el próximo.</p>
    ${actions(id, 'rec-del')}</form>`, id ? null : 'input[name=name]');
}

function openGoal(id) {
  const g = id ? S.goals.find(x => x.id === id) : { name: '', target: 0, saved: 0 };
  openSheet(sheetTop(id ? 'Editar meta' : 'Nueva meta') + `<form class="form" data-form="goal" data-id="${id || ''}">
    ${textField('name', '¿Para qué ahorras?', g.name)}
    ${moneyField('target', 'Cuánto necesitas', g.target, '0')}
    ${moneyField('saved', 'Cuánto llevas', g.saved, '0')}
    <label class="field"><span>¿Para cuándo? (opcional)</span><input class="text" type="month" name="due" value="${g.due || ''}" min="${thisMonth()}"></label>
    ${actions(id, 'goal-del')}</form>`, id ? null : 'input[name=name]');
}

function openGoalAdd(id) {
  const g = S.goals.find(x => x.id === id);
  openSheet(sheetTop('Abonar a ' + esc(g.name)) + `<form class="form" data-form="goal-add" data-id="${id}">
    <label class="amount"><span>$</span><input name="amount" inputmode="numeric" data-money autocomplete="off" placeholder="0" aria-label="Valor del abono" required></label>
    <p class="hint">Llevas ${money(g.saved)} de ${money(g.target)}.</p>
    <label class="field"><span>¿De qué cuenta sale la plata?</span><select class="text" name="method"><option value="">No registrar en una cuenta</option>${S.methods.filter(m => !m.credit).map(m => `<option value="${m.id}" ${m.id === S.settings.method ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
    <button class="btn primary wide">Abonar</button></form>`, 'input[name=amount]');
}

// Calendario del año: cada mes con lo que gastaste; desde octubre 2026 hasta el mes actual.
function openYear(y) {
  const first = +START.slice(0, 4), last = +thisMonth().slice(0, 4);
  const nav = (k, ok, label) => `<button type="button" class="icon-btn" data-act="year" data-y="${y + k}" aria-label="${label}" ${ok ? '' : 'disabled'}>${ico(k < 0 ? 'left' : 'right')}</button>`;
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = `${y}-${pad(i + 1)}`, off = m < START || m > thisMonth();
    const spent = sum(S.movements.filter(x => x.date.startsWith(m)), own);
    return `<button class="month-cell" data-act="pick-month" data-m="${m}" ${off ? 'disabled' : ''} aria-current="${m === ui.month}">
      <span>${cap(new Date(y, i, 1).toLocaleDateString('es-CO', { month: 'short' }).replace('.', ''))}</span><b>${off ? '—' : money(spent)}</b></button>`;
  }).join('');
  openSheet(sheetTop('Calendario') + `<div class="year-nav">${nav(-1, y > first, 'Año anterior')}<h2>${y}</h2>${nav(1, y < last, 'Año siguiente')}</div>
    <div class="year">${months}</div>`);
}

function openMeth(id, credit) {
  const m = id ? S.methods.find(x => x.id === id) : { name: '', credit: credit ? {} : null };
  const isCard = !!m.credit;
  if (isCard) {
    const d = id ? cardDebt(S, m) : 0, c = m.credit;
    return openSheet(sheetTop(id ? 'Editar tarjeta' : 'Nueva tarjeta de crédito') + `<form class="form" data-form="meth" data-id="${id || ''}" data-credit="1">
      ${textField('name', 'Nombre', m.name)}
      ${moneyField('bal', '¿Cuánto debes hoy?', Math.max(0, d), '0')}
      ${moneyField('limit', 'Cupo total', c.limit, 'Opcional')}
      <div class="two even">
        <label class="field"><span>Día de corte</span><input class="text" type="number" name="cut" min="1" max="31" inputmode="numeric" value="${c.cut || ''}" placeholder="Ej. 5"></label>
        <label class="field"><span>Día de pago</span><input class="text" type="number" name="pay" min="1" max="31" inputmode="numeric" value="${c.pay || ''}" placeholder="Ej. 20"></label>
      </div>
      <p class="hint">Lo que compres con la tarjeta se suma a lo que debes. 5 días antes del pago te aviso en Sobres.</p>
      ${id && S.methods.length > 1 ? actions(id, 'meth-del') : actions()}</form>`, id ? null : 'input[name=name]');
  }
  const b = id ? balance(S, m) : null;
  openSheet(sheetTop(id ? 'Editar cuenta' : 'Nueva cuenta') + `<form class="form" data-form="meth" data-id="${id || ''}">
    ${textField('name', 'Nombre', m.name)}
    <label class="field"><span>¿Cuánto tienes hoy?</span><input class="text" name="bal" inputmode="numeric" data-money autocomplete="off" value="${b > 0 ? fmtNum(b) : ''}" placeholder="${b == null ? 'Opcional' : 'Escribe el saldo nuevo'}"></label>
    ${b < 0 ? `<p class="hint">Hoy el saldo va en ${money(b)}.</p>` : ''}
    ${id && S.methods.length > 1 ? actions(id, 'meth-del') : actions()}</form>`, id ? 'input[name=bal]' : 'input[name=name]');
}

// Ingreso: sueldo, pago, regalo… entra a una cuenta.
function openInc(id) {
  const x = id ? S.incomes.find(o => o.id === id) : { amount: 0, method: S.methods.find(m => !m.credit)?.id, note: '', date: todayStr() };
  openSheet(sheetTop(id ? 'Editar ingreso' : 'Nuevo ingreso') + `<form class="form" data-form="inc" data-id="${id || ''}">
    <label class="amount"><span>$</span><input name="amount" inputmode="numeric" data-money autocomplete="off" placeholder="0" value="${fmtNum(x.amount)}" aria-label="Valor" required></label>
    <label class="field"><span>¿Qué fue?</span><input class="text" name="note" id="inc-note" list="inc-dl" autocomplete="off" value="${esc(x.note)}" maxlength="40" placeholder="Ej. Sueldo, Papá, freelance"></label>
    <datalist id="inc-dl">${incomeRank(S, '0000', '9999').map(g => `<option value="${esc(g.name)}">`).join('')}</datalist>
    ${select('method', '¿A qué cuenta entró?', S.methods.filter(m => !m.credit), x.method)}
    <label class="field"><span>Fecha</span><input class="text" type="date" name="date" value="${x.date}" min="${START}-01" required></label>
    ${actions(id, 'inc-del')}</form>`, id ? null : 'input[name=amount]');
}

// Transferencia entre cuentas (o pago de la tarjeta): no es gasto.
function openTr(id) {
  const all = S.methods, x = id ? S.transfers.find(o => o.id === id) : { amount: 0, from: all[0]?.id, to: all[1]?.id, note: '', date: todayStr() };
  openSheet(sheetTop(id ? 'Editar transferencia' : 'Transferir') + `<form class="form" data-form="tr" data-id="${id || ''}">
    <label class="amount"><span>$</span><input name="amount" inputmode="numeric" data-money autocomplete="off" placeholder="0" value="${fmtNum(x.amount)}" aria-label="Valor" required></label>
    <div class="two even">${select('from', 'Desde', all.filter(m => !m.credit), x.from)}${select('to', 'Hacia', all, x.to)}</div>
    <label class="field"><span>Nota (opcional)</span><input class="text" name="note" value="${esc(x.note)}" maxlength="40" placeholder="Ej. Pago tarjeta Nu"></label>
    <label class="field"><span>Fecha</span><input class="text" type="date" name="date" value="${x.date}" min="${START}-01" required></label>
    <p class="hint" id="tr-hint">No cuenta como gasto: solo mueve plata de una cuenta a otra.</p>
    ${actions(id, 'tr-del')}</form>`, id ? null : 'input[name=amount]');
}

// Gasto frecuente: un botón que anota el gasto con un toque.
function openQuick(id) {
  const q = id ? S.quick.find(x => x.id === id) : { note: '', amount: 0, cat: S.categories[0]?.id, method: S.settings.method };
  openSheet(sheetTop(id ? 'Editar frecuente' : 'Nuevo gasto frecuente') + `<form class="form" data-form="quick" data-id="${id || ''}">
    ${textField('note', 'Nombre', q.note)}
    ${moneyField('amount', 'Valor', q.amount, '0')}
    ${select('cat', 'Sobre', S.categories, q.cat)}
    ${select('method', 'Cuenta', S.methods, q.method)}
    <p class="hint">Aparece arriba al tocar Anotar gasto. Un toque y queda anotado con la fecha de hoy.</p>
    ${actions(id, 'quick-del')}</form>`, id ? null : 'input[name=note]');
}

function openDebt(id, dir) {
  const d = id ? S.debts.find(x => x.id === id) : { who: '', amount: 0, note: '', dir, due: '' };
  const inn = d.dir === 'in';
  const accounts = S.methods.filter(m => !m.credit);
  openSheet(sheetTop(id ? (inn ? 'Te debe' : 'Le debes') : (inn ? 'Alguien me debe' : 'Yo debo')) +
    (id ? `<form class="form pay-box" data-form="debt-pay" data-id="${id}">
      <p class="big sm">${big(d.amount)}</p>
      <label class="field"><span>${inn ? '¿Cuánto te pagó?' : '¿Cuánto pagaste?'}</span><input class="text" name="amount" inputmode="numeric" data-money autocomplete="off" placeholder="Abono o pago completo" required></label>
      <label class="field"><span>${inn ? '¿A qué cuenta entró?' : '¿De qué cuenta salió?'}</span><select class="text" name="method"><option value="">No registrar en una cuenta</option>${accounts.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label>
      <div class="actions"><button type="button" class="btn" data-act="debt-full" data-id="${id}">Pagó todo</button><button class="btn primary">Registrar abono</button></div>
    </form><h2 class="sec">Detalles</h2>` : '') +
    `<form class="form" data-form="debt" data-id="${id || ''}" data-dir="${d.dir}">
    ${textField('who', inn ? '¿Quién te debe?' : '¿A quién le debes?', d.who)}
    ${moneyField('amount', 'Cuánto', d.amount, '0')}
    <label class="field"><span>Nota (opcional)</span><input class="text" name="note" value="${esc(d.note)}" maxlength="60" placeholder="Ej. almuerzo del viernes"></label>
    <label class="field"><span>Fecha límite (opcional)</span><input class="text" type="date" name="due" value="${d.due || ''}"></label>
    ${actions(id, 'debt-del')}</form>`, id ? 'input[name=amount]' : 'input[name=who]');
}

// Registra un abono a una deuda; si queda en cero, la deuda se cierra.
function payDebt(id, amount, method) {
  const d = S.debts.find(x => x.id === id), paid = Math.min(amount, d.amount);
  if (method) {
    track(S, method, Date.now());
    const x = { id: uid(), t: Date.now(), amount: paid, date: todayStr(), debt: true };
    if (d.dir === 'in') S.incomes.push({ ...x, method, note: `Pago de ${d.who}` });
    else S.transfers.push({ ...x, from: method, to: null, note: `Pago a ${d.who}` });
  }
  d.amount -= paid;
  if (d.amount <= 0) S.debts = S.debts.filter(x => x !== d);
  closeSheet();
  commit();
  toast(d.amount <= 0 ? `Deuda con ${d.who} saldada` : `Abono de ${money(paid)} · quedan ${money(d.amount)}`);
}

// Apuestas y acciones: la plata sale del líquido y cuenta como gasto del sobre Inversiones; al cerrar se devuelve lo que recibiste.
function betsList() {
  const ps = S.movements.filter(m => m.pos).sort((a, b) => b.t - a.t);
  const net = sum(ps.filter(m => m.pos.back != null), m => m.pos.back - m.amount);
  const row = m => { const open = m.pos.back == null, r = open ? 0 : m.pos.back - m.amount;
    return `<button class="row" data-act="pos-open" data-id="${m.id}"><span class="dot" style="--c:#2E8C86">${ico('trend', 16)}</span>
      <span><span class="t">${esc(m.note || 'Sin nombre')}</span><span class="s">${open ? `En juego · metiste el ${fmtDay(m.date)}` : `Recibiste ${money(m.pos.back)}`}</span></span>
      <span class="a ${open ? '' : r >= 0 ? 'pos' : 'neg'}">${open ? money(m.amount) : (r >= 0 ? '+' : '') + money(r)}</span></button>`; };
  return `<section class="set"><h2 class="sec">Apuestas y acciones</h2>
    <button class="btn wide" data-act="pos-new" style="margin-bottom:12px">${ico('plus', 16)} Anotar una nueva</button>
    ${ps.length ? `${ps.some(m => m.pos.back != null) ? `<p class="hint" style="margin-bottom:10px">Resultado de las cerradas: <b>${net >= 0 ? '+' : ''}${money(net)}</b></p>` : ''}<div class="list">${ps.map(row).join('')}</div>` : `<p class="hint">Aquí anotas lo que metes en una apuesta o en acciones. Cuando recuperes la plata, la cierras y se ve si ganaste o perdiste.</p>`}</section>`;
}
function openPos() {
  openSheet(sheetTop('Nueva apuesta o acción') + `<form class="form" data-form="pos">
    <label class="amount"><span>$</span><input name="amount" inputmode="numeric" data-money autocomplete="off" placeholder="0" aria-label="Valor" required></label>
    <label class="field"><span>¿Qué es?</span><input class="text" name="note" autocomplete="off" maxlength="40" placeholder="Ej. Combinada, acción Apple" required></label>
    ${select('method', '¿De qué cuenta sale?', S.methods, S.settings.method)}
    <label class="field"><span>Fecha</span><input class="text" type="date" name="date" value="${todayStr()}" min="${START}-01" required></label>
    <p class="hint">Se descuenta de tu líquido y queda como gasto en el sobre Inversiones hasta que la cierres.</p>
    <div class="actions"><button class="btn primary">Guardar</button></div></form>`, 'input[name=amount]');
}
function openPosClose(id) {
  const m = S.movements.find(x => x.id === id), done = m.pos.back != null, acc = S.methods.filter(x => !x.credit);
  openSheet(sheetTop(esc(m.note || 'Inversión')) + `<form class="form" data-form="pos-close" data-id="${id}">
    <p class="hint">Metiste <b>${money(m.amount)}</b> el ${fmtDay(m.date)}.</p>
    <label class="amount"><span>$</span><input name="amount" inputmode="numeric" data-money autocomplete="off" placeholder="¿Cuánto recibiste?" value="${done ? fmtNum(m.pos.back) : ''}" aria-label="Cuánto recibiste" required></label>
    ${select('method', '¿A qué cuenta volvió?', acc, done ? m.pos.to : acc.some(x => x.id === m.method) ? m.method : acc[0]?.id)}
    <label class="field"><span>Fecha</span><input class="text" type="date" name="date" value="${done ? m.pos.date : todayStr()}" min="${START}-01" required></label>
    <p class="hint">El resultado cuenta en el mes en que metiste la plata.</p>
    <div class="actions"><button type="button" class="btn danger" data-act="pos-del" data-id="${id}" data-confirm>Eliminar</button><button class="btn primary">Guardar</button></div>
    ${done ? '' : `<button type="button" class="btn wide" data-act="pos-lost" data-id="${id}" style="margin-top:10px">Perdí todo ($0)</button>`}</form>`, done ? null : 'input[name=amount]');
}
// Cierra una apuesta o acción: lo recibido vuelve a la cuenta.
function closePos(m, back, to, date) {
  if (to) track(S, to, Date.now());
  m.pos = { back, to, date, t: Date.now() };
  commit();
  const r = back - m.amount;
  toast(r >= 0 ? `Ganaste ${money(r)}` : `Perdiste ${money(-r)}`);
}

function openInv(id) {
  const x = id ? S.investments.find(o => o.id === id) : { name: '', amount: 0, rate: '', freq: 'm', compound: false, start: todayStr(), months: '' };
  const radios = (name, opts, v) => `<div class="chips">${opts.map(([k, l]) => `<label class="chip"><input type="radio" name="${name}" value="${k}" ${k === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
  openSheet(sheetTop(id ? 'Editar inversión' : 'Nueva inversión') + `<form class="form" data-form="inv" data-id="${id || ''}">
    ${textField('name', 'Nombre', x.name)}
    ${moneyField('amount', 'Cuánto invertiste', x.amount, '0')}
    <label class="field"><span>Tasa efectiva anual (% EA)</span><input class="text" name="rate" inputmode="decimal" autocomplete="off" required value="${String(x.rate).replace('.', ',')}" placeholder="Ej. 9 o 10,5"></label>
    <fieldset class="field"><legend>¿Cada cuánto paga intereses?</legend>${radios('freq', [['d', 'Diario'], ['w', 'Semanal'], ['m', 'Mensual'], ['e', 'Al vencimiento']], x.freq)}</fieldset>
    <fieldset class="field"><legend>Los intereses</legend>${radios('mode', [['sum', 'Se suman a la inversión'], ['pay', 'Me los pagan aparte']], x.compound ? 'sum' : 'pay')}</fieldset>
    <div class="two even">
      <label class="field"><span>Desde</span><input class="text" type="date" name="start" value="${x.start}" required></label>
      <label class="field"><span>Plazo (meses)</span><input class="text" type="number" name="months" min="1" max="600" inputmode="numeric" value="${x.months || ''}" placeholder="Sin plazo"></label>
    </div>
    <label class="check"><input type="checkbox" name="ret" ${x.ret ? 'checked' : ''}><span>Me descuentan retención en la fuente (4% de los intereses, como en los CDT)</span></label>
    <p class="hint" id="inv-hint">Si eliges "al vencimiento", pon el plazo.</p>
    ${actions(id, 'inv-del')}</form>`, id ? null : 'input[name=name]');
}

// Detalle de una inversión: gráfica de crecimiento, datos clave y tabla mes a mes.
function openInvDetail(id) {
  const x = S.investments.find(o => o.id === id), now = new Date(), c = invest(x, now);
  // Horizonte de la gráfica: su plazo o varios años (como si la renovaras con la misma tasa).
  const yrs = ui.invYears || 0, months = yrs ? yrs * 12 : x.months || 12, xh = yrs ? { ...x, months } : x;
  const at = k => new Date(c.start.getFullYear(), c.start.getMonth() + k, c.start.getDate());
  const step = Math.max(1, Math.round(months / 60));
  const ks = [...Array.from({ length: Math.floor(months / step) + 1 }, (_, j) => j * step), months].filter((k, j, a) => a.indexOf(k) === j);
  const pts = ks.map(k => ({ d: at(k), v: x.amount + invest(xh, at(k)).earned, s: x.amount * (1 + (x.rate / 100) * (x.ret ? .96 : 1) * k / 12) }));
  const compound = x.compound && x.freq !== 'e';
  const days = c.end ? Math.ceil((c.end - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5) : null;
  const n = FREQ[x.freq][0], realEA = x.freq === 'e' ? ((1 + c.i) ** (12 / (x.months || 12)) - 1) * 100 : ((1 + c.i) ** n - 1) * 100;
  const fmtD = d => `${d.getDate()} ${d.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '')} ${d.getFullYear()}`;
  const tile = (label, value, sub = '') => `<div class="tile"><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
  const rows = pts.slice(1).map((p, k) => `<tr><td>${fmtD(p.d)}</td><td class="pos">+${money(p.v - pts[k].v)}</td><td>${money(p.v)}</td></tr>`).join('');
  openSheet(sheetTop(esc(x.name), `<button class="link" data-act="inv-edit" data-id="${id}">Editar</button>`) + `
    <div><p class="big sm">${big(x.amount + c.earned)}</p><p class="sub">${String(x.rate).replace('.', ',')}% EA · ${FREQ[x.freq][1]} · ${x.compound && x.freq !== 'e' ? 'los intereses se suman' : 'te pagan los intereses'}</p></div>
    <div class="seg four" role="radiogroup" aria-label="Ver crecimiento a">${[[0, x.months ? 'Su plazo' : '1 año'], [5, '5 años'], [10, '10 años'], [20, '20 años']]
      .map(([v, l]) => `<label><input type="radio" name="horizon" value="${v}" data-id="${id}" ${yrs === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    <figure class="chart" id="inv-chart" aria-label="Crecimiento de ${esc(x.name)}">${growthChart(pts, x.amount, now, compound)}<div class="tip" hidden></div></figure>
    ${pts.length > 1 ? `<p class="hint">${yrs ? `Si la renuevas a la misma tasa, en ${yrs} años ganarías` : 'Al final ganas'} <b>${money(pts.at(-1).v - x.amount)}</b>.</p>` : ''}
    <div class="tiles">
      ${tile('Llevas ganado', money(c.earned), 'hasta hoy')}
      ${tile('Vas a ganar', c.gain == null ? '—' : money(c.gain), c.end ? 'al ' + fmtD(c.end) : 'en total')}
      ${tile('Faltan', days == null ? 'Sin plazo' : days > 0 ? `${days} días` : 'Ya venció', c.end ? 'para vencer' : '')}
      ${tile('Rentabilidad real', `${realEA.toFixed(2).replace('.', ',')}%`, x.ret ? 'EA, con retención' : 'EA')}
    </div>
    <h2 class="sec">Mes a mes</h2>
    <div class="table-wrap"><table class="months"><thead><tr><th>Fecha</th><th>Intereses</th><th>Valor</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  wireChart(pts, compound);
}

// Gráfica SVG: área del valor, línea punteada de lo invertido y un punto en "Hoy".
function growthChart(pts, base, now, compound) {
  const W = 340, H = 170, L = 8, R = 8, T = 22, B = 22;
  const t0 = +pts[0].d, t1 = +pts.at(-1).d, hi = Math.max(pts.at(-1).v, base + 1), lo = base - (hi - base) * .3;
  const X = t => L + (t - t0) / (t1 - t0) * (W - L - R), Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = pts.map((p, k) => `${k ? 'L' : 'M'}${X(+p.d).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const inRange = +now >= t0 && +now <= t1;
  const today = inRange ? pts.reduce((a, p) => (+p.d <= +now ? p : a), pts[0]) : null;
  const short = d => d.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' }).replace('.', '');
  return `<svg viewBox="0 0 ${W} ${H}" role="img">
    <defs><linearGradient id="gfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    <line x1="${L}" x2="${W - R}" y1="${Y(base)}" y2="${Y(base)}" class="base"/>
    <text x="${W - R}" y="${Y(base) + 15}" class="lbl" text-anchor="end">Invertiste ${money(base)}</text>
    <path d="${line}L${X(t1)},${Y(lo)}L${X(t0)},${Y(lo)}Z" fill="url(#gfill)"/>
    <path d="${line}" class="curve"/>
    <text x="${W - R}" y="${Y(pts.at(-1).v) - 8}" class="lbl end" text-anchor="end">${money(pts.at(-1).v)}</text>
    ${today ? `<line x1="${X(+now)}" x2="${X(+now)}" y1="${T - 6}" y2="${H - B}" class="now"/><text x="${X(+now)}" y="${T - 10}" class="lbl" text-anchor="middle">Hoy</text>` : ''}
    <text x="${L}" y="${H - 6}" class="axis">${short(pts[0].d)}</text><text x="${W - R}" y="${H - 6}" class="axis" text-anchor="end">${short(pts.at(-1).d)}</text>
    <line class="cross" y1="${T}" y2="${H - B}" visibility="hidden"/><circle class="cdot" r="5" visibility="hidden"/>
    <rect x="0" y="0" width="${W}" height="${H}" fill="transparent" class="hit"/>
  </svg>`;
}

// Al pasar el dedo o el mouse: línea vertical, punto y el valor de ese mes.
function wireChart(pts, compound) {
  const fig = $('#inv-chart'), svg = fig.querySelector('svg'), tip = fig.querySelector('.tip');
  const cross = svg.querySelector('.cross'), dot = svg.querySelector('.cdot'), curve = svg.querySelector('.curve');
  const xs = [...curve.getAttribute('d').matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(m => [+m[1], +m[2]]);
  const show = e => {
    const r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * 340;
    let k = 0; xs.forEach(([x], j) => { if (Math.abs(x - vx) < Math.abs(xs[k][0] - vx)) k = j; });
    const [x, y] = xs[k];
    for (const [a, v] of [['x1', x], ['x2', x]]) cross.setAttribute(a, v);
    dot.setAttribute('cx', x); dot.setAttribute('cy', y);
    cross.setAttribute('visibility', 'visible'); dot.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `<b>${money(pts[k].v)}</b><span>${pts[k].d.getDate()} ${pts[k].d.toLocaleDateString('es-CO', { month: 'short', year: 'numeric' }).replace('.', '')}</span>`;
    tip.style.left = `${Math.min(Math.max(x / 340 * 100, 18), 82)}%`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
  svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show); svg.addEventListener('pointerleave', hide);
}

// Ventanas de la pestaña Dinero: cuentas, tarjetas, deudas y entradas/transferencias.
const flowRow = x => x.k === 'in'
  ? `<button class="row" data-act="inc-edit" data-id="${x.id}"><span class="dot" style="--c:#2E8C86">${ico('down2', 16)}</span><span><span class="t">${esc(x.note || 'Ingreso')}</span><span class="s">${dayLabel(x.date)}${x.date.slice(0, 7) !== thisMonth() ? ' de ' + monthName(x.date.slice(0, 7)).toLowerCase() : ''} · a ${esc(meth(x.method))}${x.rec ? ' · recurrente' : ''}</span></span><span class="a pos">+${money(x.amount)}</span></button>`
  : `<button class="row" data-act="tr-edit" data-id="${x.id}"><span class="dot" style="--c:#4F6275">${ico('arrows', 16)}</span><span><span class="t">${esc(x.note || 'Transferencia')}</span><span class="s">${dayLabel(x.date)} · ${esc(meth(x.from))}${x.to ? ' → ' + esc(meth(x.to)) : ''}</span></span><span class="a">${money(x.amount)}</span></button>`;

function openPanel(kind) {
  const w = worth(S), today = todayStr();
  const dueTxt = d => { if (!d.due) return ''; const days = Math.round((new Date(d.due + 'T00:00') - new Date(today + 'T00:00')) / 864e5);
    return days < 0 ? ` · <b class="neg">venció hace ${-days} ${-days === 1 ? 'día' : 'días'}</b>` : days <= 3 ? ` · <b class="warn">vence ${days === 0 ? 'hoy' : `en ${days} ${days === 1 ? 'día' : 'días'}`}</b>` : ` · vence el ${dayLabel(d.due).toLowerCase()}`; };
  const P = {
    liquid() {
      // Cuentas ordenadas por saldo, de mayor a menor; las que no llevan saldo van al final.
      const accounts = S.methods.filter(m => !m.credit).sort((a, b) => (balance(S, b) ?? -Infinity) - (balance(S, a) ?? -Infinity));
      return sheetTop('Líquido', '<button class="link" data-act="meth-edit">Nueva</button>') + `<p class="big sm">${big(w.liquid)}</p>` +
        `<div class="list">${accounts.map(m => { const b = balance(S, m); return `<button class="row" data-act="meth-edit" data-id="${m.id}"><span class="dot" style="--c:#4F6275">${ico('cash', 16)}</span>
          <span><span class="t">${esc(m.name)}</span><span class="s">${b == null ? 'Toca para poner cuánto tienes' : 'Saldo'}</span></span><span class="a ${b < 0 ? 'neg' : ''}">${b == null ? '—' : money(b)}</span></button>`; }).join('')}</div>
        <p class="hint">Los gastos, ingresos y transferencias se suman y restan solos de cada cuenta.</p>`;
    },
    cards() {
      const cards = S.methods.filter(m => m.credit);
      return sheetTop('Tarjetas', '<button class="link" data-act="meth-edit" data-credit="1">Agregar</button>') + (cards.length ? `<p class="big sm">${big(w.cards)}</p>` +  `<div class="list">${cards.map(m => { const d = cardDebt(S, m), c = m.credit;
        return `<button class="row" data-act="meth-edit" data-id="${m.id}"><span class="dot" style="--c:#7A5AA6">${ico('card', 16)}</span>
          <span><span class="t">${esc(m.name)}</span><span class="s">${c.pay ? 'Pago día ' + c.pay : 'Tarjeta de crédito'}${c.cut ? ' · corte día ' + c.cut : ''}${c.limit ? ' · cupo libre ' + money(c.limit - d) : ''}</span></span><span class="a ${d > 0 ? 'neg' : ''}">${money(Math.max(0, d))}</span></button>`; }).join('')}</div>
        <p class="hint">Para pagar la tarjeta, usa Transferir desde tu cuenta hacia la tarjeta.</p>`
        : `<p class="hint">Agrega tu tarjeta para ver cuánto debes, tu cupo y recibir un aviso 5 días antes de la fecha de pago.</p>`);
    },
    debts(dir) {
      const xs = S.debts.filter(d => d.dir === dir).sort((x, y) => (x.due || '9').localeCompare(y.due || '9'));
      return sheetTop(dir === 'in' ? 'Te deben' : 'Debes', `<button class="link" data-act="debt-edit" data-dir="${dir}">Agregar</button>`) + `<p class="big sm">${big(dir === 'in' ? w.owed : w.owe)}</p>` +
        (xs.length ? `<div class="list">${xs.map(d => `<button class="row" data-act="debt-edit" data-id="${d.id}"><span class="dot" style="--c:${dir === 'in' ? '#2E8C86' : '#C2544A'}">${ico('user', 16)}</span>
          <span><span class="t">${esc(d.who)}</span><span class="s">${esc(d.note || (dir === 'in' ? 'Te debe' : 'Le debes'))}${dueTxt(d)}</span></span><span class="a">${money(d.amount)}</span></button>`).join('')}</div>
          <p class="hint">Toca una deuda para registrar un abono o marcarla como pagada.</p>`
        : `<p class="hint">${dir === 'in' ? 'Nadie te debe plata.' : 'No le debes plata a nadie.'}</p>`);
    },
    flows() {
      const f = flowState(), seg = (name, opts, v) => `<div class="seg tight" role="radiogroup">${opts.map(([k, l]) => `<label><input type="radio" name="${name}" value="${k}" ${v === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
      const xs = [...S.incomes.map(x => ({ ...x, k: 'in' })), ...S.transfers.map(x => ({ ...x, k: 'tr' }))].filter(x => between(x.date, f.from, f.to) && (f.kind === 'all' || f.kind === x.k))
        .sort(f.sort === 'high' ? (a, b) => b.amount - a.amount || byDate(a, b) : f.sort === 'low' ? (a, b) => a.amount - b.amount || byDate(a, b) : byDate);
      const rank = f.kind === 'tr' ? [] : incomeRank(S, f.from, f.to), inc = sum(xs.filter(x => x.k === 'in'), x => x.amount), tr = sum(xs.filter(x => x.k === 'tr'), x => x.amount);
      return sheetTop('Entradas y transferencias', '<span></span>') +
        toolbar('flow-open', ui.flowOpen, [['date', 'cal', dateLabel(f)], ['sort', 'sliders', { new: 'Recientes', high: 'Mayor a menor', low: 'Menor a mayor' }[f.sort] + (f.kind === 'all' ? '' : ' · ' + { in: 'Ingresos', tr: 'Transferencias' }[f.kind])]]) +
        drawer(ui.flowOpen, 'date', rangeChips('flow-k', f, [['sem', 'Esta semana'], ['mes', 'Este mes'], [15, '15 días'], [30, '30 días'], ['anio', 'Este año'], ['todo', 'Todo']])) +
        drawer(ui.flowOpen, 'sort', seg('fkind', [['all', 'Todo'], ['in', 'Ingresos'], ['tr', 'Transferencias']], f.kind) + seg('fsort', [['new', 'Recientes'], ['high', 'Mayor a menor'], ['low', 'Menor a mayor']], f.sort)) +
        `<p class="hint">${rangeLabel(f.from, f.to)} · ${f.kind !== 'tr' ? `entró <b>${money(inc)}</b>` : ''}${f.kind === 'all' ? ' · ' : ''}${f.kind !== 'in' ? `transferiste <b>${money(tr)}</b>` : ''}</p>` +
        (rank.length ? `<h2 class="sec">De dónde te entra más plata</h2><div class="list">${rank.map(g => `<button class="row" data-act="inc-group" data-key="${esc(g.key)}"><span class="dot" style="--c:#2E8C86">${ico('down2', 16)}</span>
          <span><span class="t">${esc(g.name)}</span><span class="s">${g.count} ${g.count === 1 ? 'vez' : 'veces'} · promedio ${money(g.total / g.count)}</span></span><span class="a pos">+${money(g.total)}</span></button>`).join('')}</div>` : '') +
        (xs.length ? `<h2 class="sec">${f.sort === 'high' ? 'De mayor a menor' : f.sort === 'low' ? 'De menor a mayor' : 'Más recientes primero'}</h2><div class="list">${xs.map(flowRow).join('')}</div>`
        : `<p class="hint">No hay nada en estas fechas. Prueba con otro rango o usa los botones Ingreso y Transferir.</p>`);
    },
    group(key) {
      const f = flowState(), xs = S.incomes.filter(x => !x.debt && (norm(x.note) || 'ingreso') === key && between(x.date, f.from, f.to)).sort(byDate);
      return sheetTop(esc((xs[0]?.note || 'Ingreso').trim()), '<button class="link" data-act="panel" data-p="flows" data-keep="1">Volver</button>') +
        `<p class="big sm">${big(sum(xs, x => x.amount))}</p><p class="sub" style="margin:0">${xs.length} ${xs.length === 1 ? 'vez' : 'veces'} · ${rangeLabel(f.from, f.to)}</p>
        <div class="list">${xs.map(x => flowRow({ ...x, k: 'in' })).join('')}</div>`;
    },
  };
  openSheet(kind === 'in' || kind === 'out' ? P.debts(kind) : kind.startsWith('group:') ? P.group(kind.slice(6)) : P[kind]());
}

// Más opciones de periodo: rápidos y un rango personalizado de fechas.
function openPeriods() {
  const t = todayStr(), opt = (p, extra, label, sub) => `<button class="row plain" data-act="period" data-p="${p}" ${extra}><span><span class="t">${label}</span><span class="s">${sub}</span></span>${ico('right', 18)}</button>`;
  openSheet(sheetTop('Ver gastos de…') + `<div class="list">
    ${opt('mes', '', 'Este mes', monthName(thisMonth()))}
    ${opt('dias', 'data-n="15"', 'Últimos 15 días', 'Hasta hoy')}
    ${opt('dias', 'data-n="30"', 'Últimos 30 días', 'Hasta hoy')}
    ${opt('tri', '', 'Trimestre', 'Tres meses juntos')}
    ${opt('anio', '', 'Año', 'Todo el año')}
    ${opt('todo', '', 'Desde el inicio', 'Todo lo que has anotado')}
  </div>
  <h2 class="sec">Personalizado</h2>
  <form class="form" data-form="range">
    <div class="two even">
      <label class="field"><span>Desde</span><input class="text" type="date" name="from" value="${ui.range?.from || thisMonth() + '-01'}" min="${START}-01" required></label>
      <label class="field"><span>Hasta</span><input class="text" type="date" name="to" value="${ui.range?.to || t}" min="${START}-01" required></label>
    </div>
    <p class="hint" id="range-hint">Por ejemplo, del día que te pagaron hasta hoy.</p>
    <button class="btn primary wide">Ver este rango</button>
  </form>`);
}

// Gráfica de gastos en el tiempo, por 15 días, mes o trimestre.
const compact = n => n >= 1e6 ? '$' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' M' : n >= 1000 ? '$' + Math.round(n / 1000) + ' mil' : '$' + Math.round(n);
function barChart(bs) {
  const W = 340, H = 200, L = 52, R = 6, T = 22, B = 28, max = Math.max(...bs.map(b => b.total), 1);
  const mag = 10 ** Math.floor(Math.log10(max)), r = max / mag, top = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag;
  const bw = (W - L - R) / bs.length, w = Math.min(bw * .64, 34), Y = v => T + (1 - v / top) * (H - T - B);
  const lw = Math.max(...bs.map(b => b.short.length)) * 7, every = Math.max(1, Math.ceil(lw * 1.5 / bw)); // ancho de una etiqueta y cada cuántas barras poner una
  const bar = (b, i) => { const x = L + i * bw + (bw - w) / 2, y = Y(b.total), h = H - B - y, rad = Math.min(4, h);
    return b.total ? `<path class="bar${b.now ? ' now' : ''}" data-i="${i}" d="M${x},${H - B}V${y + rad}Q${x},${y} ${x + rad},${y}H${x + w - rad}Q${x + w},${y} ${x + w},${y + rad}V${H - B}Z"/>` : `<rect class="bar zero" data-i="${i}" x="${x}" y="${H - B - 2}" width="${w}" height="2" rx="1"/>`; };
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gastos por periodo">
    ${[0, top / 2, top].map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${L - 6}" y="${Y(v) + 4}" class="axis" text-anchor="end">${v ? compact(v) : '$0'}</text>`).join('')}
    ${bs.map(bar).join('')}
    ${bs.map((b, i) => { if ((bs.length - 1 - i) % every) return ''; const cx = L + i * bw + bw / 2, end = cx + lw / 2 > W - R;
      return `<text x="${end ? W - R : cx}" y="${H - 8}" class="axis${b.now ? ' strong' : ''}" text-anchor="${end ? 'end' : 'middle'}">${b.short}</text>`; }).join('')}
    <rect x="0" y="0" width="${W}" height="${H}" fill="transparent" class="hit"/>
  </svg>`;
}
function openChart() {
  const c = chartState(), t = todayStr(), bs = buckets(S, c.by, c.from, c.to, t), total = sum(bs, b => b.total), n = bs.filter(b => b.total).length;
  const BY = [['d', 'Día'], ['w', 'Semana'], ['q', '15 días'], ['m', 'Mes'], ['t', 'Trimestre']];
  keepScroll(() => openSheet(sheetTop('Gastos en el tiempo') + `
    ${toolbar('chart-open', ui.chartOpen, [['date', 'cal', dateLabel(c)], ['by', 'bars', 'Por ' + { d: 'día', w: 'semana', q: '15 días', m: 'mes', t: 'trimestre' }[c.by]]])}
    ${drawer(ui.chartOpen, 'date', rangeChips('chart-k', c, [['sem', 'Esta semana'], ['mes', 'Este mes'], [30, '30 días'], ['anio', 'Este año'], ['todo', 'Todo']]))}
    ${drawer(ui.chartOpen, 'by', `<div class="chips" role="radiogroup" aria-label="Agrupar por">${BY.map(([v, l]) => `<button type="button" class="chip-btn ${c.by === v ? 'on' : ''}" data-act="chart-by" data-by="${v}">${l}</button>`).join('')}</div>`)}
    <figure class="chart" id="bar-chart">${barChart(bs)}<div class="tip" hidden></div></figure>
    <p class="hint">${rangeLabel(c.from, c.to)} · en total <b>${money(total)}</b>${n > 1 ? ` · promedio por ${{ d: 'día', w: 'semana', q: 'quincena', m: 'mes', t: 'trimestre' }[c.by]}: <b>${money(total / bs.length)}</b>` : ''}.${bs.length === 60 ? ' Muestro los últimos 60 periodos; elige menos fechas o agrupa por semana o mes para ver más.' : ' Toca una barra para ver su valor.'}</p>
    <div class="table-wrap"><table class="months"><thead><tr><th>Periodo</th><th>Gastaste</th></tr></thead><tbody>${[...bs].reverse().map(b => `<tr><td>${b.full}${b.now ? ' · en curso' : ''}</td><td>${money(b.total)}</td></tr>`).join('')}</tbody></table></div>`));
  const fig = $('#bar-chart'), svg = fig.querySelector('svg'), tip = fig.querySelector('.tip');
  const show = e => { const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 340, i = Math.max(0, Math.min(bs.length - 1, Math.floor((x - 52) / ((340 - 58) / bs.length))));
    svg.querySelectorAll('.bar').forEach(el => el.classList.toggle('sel', +el.dataset.i === i));
    tip.hidden = false; tip.innerHTML = `<b>${money(bs[i].total)}</b><span>${bs[i].full}</span>`;
    tip.style.left = `${Math.min(Math.max((52 + (i + .5) * ((340 - 58) / bs.length)) / 340 * 100, 18), 82)}%`; };
  svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', () => { tip.hidden = true; svg.querySelectorAll('.bar').forEach(el => el.classList.remove('sel')); });
}

// Copia al portapapeles; si el navegador no deja, muestra el texto para copiarlo a mano.
function copyText(text, ok, title) {
  const fallback = () => openSheet(sheetTop(title) + `<p class="hint">Copia todo este texto.</p><textarea class="text" id="bk" readonly>${esc(text)}</textarea>`, '#bk');
  (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast(ok), fallback);
}

let toastTimer;
function toast(msg, undo) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button class="link" id="undo">Deshacer</button>' : ''}`;
  t.hidden = false;
  if (undo) $('#undo').onclick = () => { undo(); t.hidden = true; };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

// Botones destructivos: el primer toque pide confirmación, el segundo actúa.
function armed(btn) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1';
  const label = btn.innerHTML;
  btn.textContent = btn.classList.contains('icon-btn') ? '¿Seguro?' : '¿Seguro? Toca otra vez';
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.innerHTML = label; } }, 3000);
  return false;
}

function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (el.hasAttribute('data-confirm') && !armed(el)) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'tab': if (el.dataset.tab === 'ajustes' && ui.view !== 'ajustes') ui.back = ui.view; ui.view = el.dataset.tab; scrollTo(0, 0); render(); break;
    case 'month': { const n = shiftMonth(ui.month, +el.dataset.k); ui.month = n < START ? START : n > thisMonth() ? thisMonth() : n; render(); break; }
    case 'year': openYear(+el.dataset.y); break;
    case 'tag': ui.q = ui.q === el.dataset.tag ? '' : el.dataset.tag; render(); break;
    case 'pick-month': ui.month = el.dataset.m; closeSheet(); render(); break;
    case 'add': openAdd(); break;
    case 'add-in': openAdd({ cat: id }); break;
    case 'close': closeSheet(); break;
    case 'open-cat': openCatDetail(id); break;
    case 'edit-mov': openAdd({ id }); break;
    case 'pick': {
      ui.add.cat = id; ui.add.sub = '';
      document.querySelectorAll('.pick-cat').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === id));
      $('#subs').innerHTML = subChips(id, '');
      // Sin subcategorías se guarda al instante; con subcategorías eliges una (o tocas Guardar).
      if (!ui.add.id && !cat(id).subs.length) saveMov();
      else if (cat(id).subs.length && !ui.add.id) { const h = $('#add-hint'); h.className = 'hint'; h.textContent = 'Toca dónde fue, o Guardar si no importa.'; }
      break;
    }
    case 'sub':
      ui.add.sub = ui.add.sub === el.dataset.n ? '' : el.dataset.n;
      $('#subs').innerHTML = subChips(ui.add.cat, ui.add.sub);
      if (!ui.add.id && ui.add.sub) saveMov();
      break;
    case 'when': { const x = new Date(todayStr() + 'T00:00'); x.setDate(x.getDate() - +el.dataset.k); $('#date').value = ymd(x); refreshWhen(); break; }
    case 'save-mov': saveMov(); break;
    case 'quick': {
      const q = S.quick.find(x => x.id === id);
      closeSheet();
      addMov({ amount: q.amount, cat: q.cat, method: S.methods.some(x => x.id === q.method) ? q.method : S.settings.method, note: q.note, date: todayStr(), split: 0, sub: q.sub || '' });
      break;
    }
    case 'half': $('#split-amt').value = fmtNum(Math.round(digits($('#amt').value) / 2)); break;
    case 'make-quick': {
      // Usa lo que está escrito en la hoja ahora mismo, aunque todavía no hayas guardado.
      const catId = ui.add.cat, note = $('#note').value.trim();
      S.quick.push({ id: uid(), sub: ui.add.sub || '', note: note || cat(catId).name, amount: digits($('#amt').value), cat: catId, method: document.querySelector('input[name=method]:checked')?.value });
      commit();
      toast('Listo: ahora aparece arriba al anotar un gasto');
      break;
    }
    case 'quick-edit': openQuick(id); break;
    case 'quick-del': S.quick = S.quick.filter(x => x.id !== id); closeSheet(); commit(); break;
    case 'del-mov': S.movements = S.movements.filter(m => m.id !== ui.add.id); closeSheet(); commit(); toast('Gasto eliminado'); break;
    case 'clear-ex': S.movements = S.movements.filter(m => !m.ex); S.goals = S.goals.filter(g => !g.ex); commit(); toast('Listo. Ahora todo es tuyo.'); break;
    case 'cat-edit': openCatEdit(id); break;
    case 'quicks': openSheet(sheetTop('Gastos frecuentes', '<button class="link" data-act="quick-edit">Nuevo</button>') + (S.quick.length ? `<div class="list">${S.quick.map(q => { const c = cat(q.cat);
      return `<button class="row" data-act="quick-edit" data-id="${q.id}"><span class="dot" style="--c:${c.color}">${ico('bolt', 16)}</span>
        <span><span class="t">${esc(q.note)}</span><span class="s">${esc(c.name)} · ${esc(meth(q.method))}</span></span><span class="a">${money(q.amount)}</span></button>`; }).join('')}</div>` : '') +
      `<p class="hint">Los creas tú, aquí o desde un gasto con "Guardar como gasto frecuente". Aparecen arriba al tocar Anotar gasto: un toque y queda anotado.</p>`); break;
    case 'recs': openSheet(sheetTop('Recurrentes', '<button class="link" data-act="rec-edit">Nuevo</button>') + (S.recurring.length ? `<div class="list">${S.recurring.map(r => { const c = cat(r.cat);
      return `<button class="row" data-act="rec-edit" data-id="${r.id}"><span class="dot" style="--c:${c.color}">${ico('repeat', 16)}</span>
        <span><span class="t">${esc(r.name)}</span><span class="s">Cada día ${r.day} · ${r.kind === 'in' ? 'ingreso' : esc(c.name)} · ${esc(meth(r.method))}</span></span><span class="a ${r.kind === 'in' ? 'pos' : ''}">${r.kind === 'in' ? '+' : ''}${money(r.amount)}</span></button>`; }).join('')}</div>` : '') +
      `<p class="hint">Arriendo, Netflix o tu sueldo: los creas una vez y se anotan solos cada mes el día que elijas.</p>`); break;
    case 'panel': if (el.dataset.p === 'flows' && !el.dataset.keep) { ui.flowF = null; ui.flowOpen = null; } openPanel(el.dataset.p); break;
    case 'period-more': openPeriods(); break;
    case 'chart': ui.chart = ui.chartOpen = null; openChart(); break;
    case 'chart-k': { const c = chartState(); c.k = el.dataset.k; c.by = { sem: 'd', mes: 'd', 30: 'd', anio: 'm', todo: 'm' }[c.k]; ui.chartOpen = null; openChart(); break; }
    case 'chart-by': chartState().by = el.dataset.by; ui.chartOpen = null; openChart(); break;
    case 'chart-open': ui.chartOpen = ui.chartOpen === el.dataset.w ? null : el.dataset.w; openChart(); break;
    case 'flow-open': ui.flowOpen = ui.flowOpen === el.dataset.w ? null : el.dataset.w; keepScroll(() => openPanel('flows')); break;
    case 'flow-k': flowState().k = el.dataset.k; ui.flowOpen = null; keepScroll(() => openPanel('flows')); break;
    case 'inc-group': openPanel('group:' + el.dataset.key); break;
    case 'period': ui.period = el.dataset.p; if (el.dataset.n) ui.days = +el.dataset.n; if (ui.period === 'mes' || ui.period === 'dias') ui.month = thisMonth(); if ($('#sheet').open) closeSheet(); render(); break;
    case 'cats': openSheet(sheetTop('Tus sobres', '<button class="link" data-act="cat-edit">Nuevo</button>') + `<div class="list">${S.categories.map(c => `<button class="row" data-act="cat-edit" data-id="${c.id}">
      <span class="dot" style="--c:${c.color}">${ico(c.icon, 16)}</span>
      <span><span class="t">${esc(c.name)}</span><span class="s">${money(spentByCat(S, thisMonth())[c.id] || 0)} este mes</span></span>${ico('right', 18)}</button>`).join('')}</div>
      <p class="hint">Toca un sobre para cambiarle el nombre, el ícono o el color, o para eliminarlo.</p>`); break;
    case 'cat-del': S.categories = S.categories.filter(c => c.id !== id); closeSheet(); commit(); toast('Sobre eliminado'); break;
    case 'rec-edit': openRec(id); break;
    case 'rec-del': S.recurring = S.recurring.filter(r => r.id !== id); closeSheet(); commit(); break;
    case 'goal-edit': openGoal(id); break;
    case 'goal-add': openGoalAdd(id); break;
    case 'goal-del': S.goals = S.goals.filter(g => g.id !== id); closeSheet(); commit(); break;
    case 'meth-del': S.methods = S.methods.filter(m => m.id !== id); closeSheet(); commit(); break;
    case 'backup': case 'backup-now': S.settings.lastBackup = todayStr(); S.settings.backupSnooze = null; ui.saveFail = !store.save(S); copyText(JSON.stringify(S), 'Respaldo copiado. Pégalo en tus notas para guardarlo.', 'Tu respaldo'); if (ui.view === 'sobres') render(); break;
    case 'backup-later': { const d = new Date(todayStr() + 'T00:00'); d.setDate(d.getDate() + 3); S.settings.backupSnooze = ymd(d); commit(); break; }
    case 'export': copyText(toTable(S), 'Gastos copiados. Pégalos en una hoja de Excel o Google Sheets.', 'Tus gastos'); break;
    case 'meth-edit': openMeth(id, el.dataset.credit); break;
    case 'inc-edit': openInc(id); break;
    case 'inc-del': S.incomes = S.incomes.filter(x => x.id !== id); closeSheet(); commit(); break;
    case 'tr-edit': openTr(id); break;
    case 'tr-del': S.transfers = S.transfers.filter(x => x.id !== id); closeSheet(); commit(); break;
    case 'debt-full': payDebt(id, S.debts.find(x => x.id === id).amount, el.closest('form').elements.method.value); break;
    case 'debt-edit': openDebt(id, el.dataset.dir); break;
    case 'inv-edit': openInv(id); break;
    case 'pos-new': openPos(); break;
    case 'pos-open': openPosClose(id); break;
    case 'pos-lost': { const m = S.movements.find(x => x.id === id); closeSheet(); closePos(m, 0, m.method, todayStr()); break; }
    case 'pos-del': S.movements = S.movements.filter(x => x.id !== id); closeSheet(); commit(); toast('Eliminada'); break;
    case 'inv-detail': ui.invYears = 0; openInvDetail(id); break;
    case 'inv-del': S.investments = S.investments.filter(x => x.id !== id); closeSheet(); commit(); toast('Inversión eliminada'); break;
    case 'debt-del': S.debts = S.debts.filter(d => d.id !== id); closeSheet(); commit(); toast('Deuda eliminada'); break;
    case 'restore':
      openSheet(sheetTop('Restaurar respaldo') + `<form class="form" data-form="restore"><p class="hint" id="rs-hint">Pega aquí el texto de un respaldo. Reemplaza todo lo que hay ahora.</p>
        <textarea class="text" name="data" required aria-label="Respaldo"></textarea><button class="btn primary wide">Restaurar</button></form>`, 'textarea');
      break;
    case 'wipe': S = { ...fresh(new Date(), false), settings: S.settings }; commit(); toast('Listo, empezaste de cero.'); break;
  }
}

function onSubmit(e) {
  e.preventDefault();
  const f = e.target, d = Object.fromEntries(new FormData(f)), id = f.dataset.id;
  const upsert = (list, obj) => { const x = id && list.find(o => o.id === id); if (x) Object.assign(x, obj); else list.push({ id: uid(), ...obj }); };
  switch (f.dataset.form) {
    case 'meth': {
      const m = id && S.methods.find(x => x.id === id), bal = d.bal.trim() ? digits(d.bal) : null;
      // Solo reinicia el saldo si escribiste uno distinto; así los gastos ya anotados siguen descontándose.
      const v = bal != null && bal !== (m ? balance(S, m) : null) ? { base: bal, baseT: Date.now() } : m ? {} : { base: null, baseT: 0 };
      if (f.dataset.credit) {
        // En una tarjeta, el "saldo" es lo que debes; solo se reinicia si escribiste otro valor.
        const prev = m ? cardDebt(S, m) : null, debt = bal ?? 0;
        upsert(S.methods, { name: d.name.trim(), ...(debt !== prev ? { base: debt, baseT: Date.now() } : {}), credit: { limit: digits(d.limit), cut: digits(d.cut), pay: digits(d.pay) } });
        break;
      }
      upsert(S.methods, { name: d.name.trim(), ...v });
      break;
    }
    case 'inc': if (!id) track(S, d.method, Date.now());
      upsert(S.incomes, { amount: digits(d.amount), note: d.note.trim(), method: d.method, date: d.date >= START ? d.date : todayStr(), ...(id ? {} : { t: Date.now() }) }); break;
    case 'tr':
      if (d.from === d.to) { const h = $('#tr-hint'); h.textContent = 'Elige dos cuentas distintas.'; h.className = 'hint err'; return; }
      if (!id) { track(S, d.from, Date.now()); track(S, d.to, Date.now()); }
      upsert(S.transfers, { amount: digits(d.amount), from: d.from, to: d.to, note: d.note.trim(), date: d.date >= START ? d.date : todayStr(), ...(id ? {} : { t: Date.now() }) });
      break;
    case 'quick': upsert(S.quick, { note: d.note.trim(), amount: digits(d.amount), cat: d.cat, method: d.method }); break;
    case 'pos': closeSheet(); addMov({ cat: 'inversiones', note: d.note.trim(), amount: digits(d.amount), method: d.method, date: d.date >= START ? d.date : todayStr(), pos: { back: null } }); return;
    case 'pos-close': { const m = S.movements.find(x => x.id === id); closeSheet(); closePos(m, digits(d.amount), d.method, d.date >= START ? d.date : todayStr()); return; }
    case 'debt-pay': return payDebt(id, digits(d.amount), d.method);
    case 'inv': {
      const months = digits(d.months), rate = parseFloat(String(d.rate).replace(',', '.')) || 0;
      if ((d.freq === 'e' && !months) || !rate) {
        const h = $('#inv-hint');
        h.textContent = !rate ? 'Escribe la tasa EA, por ejemplo 9.' : 'Para "al vencimiento" necesito el plazo en meses.';
        h.className = 'hint err';
        return;
      }
      upsert(S.investments, { name: d.name.trim(), amount: digits(d.amount), rate, freq: d.freq, compound: d.mode === 'sum', start: d.start, months: months || null, ret: !!d.ret });
      break;
    }
    case 'range':
      if (d.from > d.to) { const h = $('#range-hint'); h.textContent = '"Desde" tiene que ser antes de "Hasta".'; h.className = 'hint err'; return; }
      ui.period = 'rango'; ui.range = { from: d.from, to: d.to }; closeSheet(); render(); return;
    case 'debt': upsert(S.debts, { who: d.who.trim(), amount: digits(d.amount), note: d.note.trim(), dir: f.dataset.dir, due: d.due || '' }); break;
    case 'cat': upsert(S.categories, { name: d.name.trim(), budget: 0, icon: d.icon, color: d.color, subs: String(d.subs || '').split(',').map(t => t.trim().slice(0, 30)).filter((t, i, a) => t && a.findIndex(u => u.toLowerCase() === t.toLowerCase()) === i) }); break;
    case 'rec': {
      const day = Math.max(1, Math.min(31, digits(d.day)));
      const r = { name: d.name.trim(), amount: digits(d.amount), cat: d.cat, method: d.method, day, kind: d.kind };
      if (!id && todayStr() > `${thisMonth()}-${pad(day)}`) r.last = thisMonth();
      upsert(S.recurring, r);
      postRecurring(S, new Date());
      break;
    }
    case 'goal': upsert(S.goals, { name: d.name.trim(), target: digits(d.target), saved: digits(d.saved), due: d.due || '', ex: undefined }); break;
    case 'goal-add': {
      const g = S.goals.find(x => x.id === id), amt = digits(d.amount);
      if (!amt) return;
      g.saved += amt;
      // La plata sale de la cuenta que elegiste: queda como una salida en Entradas y transferencias.
      if (d.method) { track(S, d.method, Date.now()); S.transfers.push({ id: uid(), t: Date.now(), amount: amt, from: d.method, to: null, note: `Abono a ${g.name}`, date: todayStr(), goal: true }); }
      toast(`Abonaste ${money(amt)} a ${g.name}${d.method ? ' desde ' + meth(d.method) : ''}`);
      break;
    }
    case 'restore': {
      let x;
      try { x = JSON.parse(d.data); } catch { x = null; }
      if (!x || !Array.isArray(x.categories) || !Array.isArray(x.movements) || !Array.isArray(x.methods)) {
        const h = $('#rs-hint');
        h.textContent = 'Ese texto no es un respaldo válido. Copia el respaldo completo, desde { hasta }.';
        h.className = 'hint err';
        return;
      }
      S = { ...fresh(new Date(), false), ...x };
      applyTheme();
      toast('Respaldo restaurado');
      break;
    }
  }
  if ($('#sheet').open) closeSheet();
  commit();
}

if (typeof module !== 'undefined') module.exports = { tidyInv, rangeFor, rangeLabel, buckets, cashflow, subTotals, incomeRank, norm, spentIn, track, trackAll, money, digits, ymd, spentByCat, postRecurring, fresh, balance, worth, toTable, invest, cardDebt, cardAlerts, insights, search, tagsOf, goalPlan, own };
else {
  boot();
  // App instalada: funciona sin internet y pide al navegador no borrar los datos.
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.storage?.persist?.().catch(() => {});
}
