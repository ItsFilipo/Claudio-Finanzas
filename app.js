'use strict';

// ---------- Lógica (sin pantalla; se prueba con check.js) ----------

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const money = n => (n < 0 ? '−$' : '$') + Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const fmtNum = n => (n ? money(n).slice(1) : '');
const digits = s => Number(String(s).replace(/\D/g, '')) || 0;
// La app empieza en octubre de 2026: no se muestran ni se registran meses anteriores.
const START = '2026-10';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Saldo de una cuenta: el saldo que escribiste menos los gastos anotados después.
function balance(state, m) {
  if (m.base == null) return null;
  return m.base - state.movements.filter(x => x.method === m.id && (x.t || 0) > m.baseT).reduce((a, x) => a + x.amount, 0);
}
// Inversiones: la tasa es efectiva anual (EA); cada frecuencia usa su tasa equivalente.
const FREQ = { d: [365, 'diario', 'Cada día'], w: [52, 'semanal', 'Cada semana'], m: [12, 'mensual', 'Cada mes'], e: [1, 'al vencimiento', 'Al vencimiento'] };
function invest(x, now) {
  const r = x.rate / 100, n = FREQ[x.freq][0], atEnd = x.freq === 'e';
  const i = atEnd ? (1 + r) ** ((x.months || 12) / 12) - 1 : (1 + r) ** (1 / n) - 1;
  const perPay = x.amount * i;
  const N = atEnd ? 1 : x.months ? Math.round(n * x.months / 12) : 0;
  const gain = !N ? null : atEnd ? perPay : x.compound ? x.amount * ((1 + i) ** N - 1) : perPay * N;
  const [y, m, d] = x.start.split('-').map(Number), start = new Date(y, m - 1, d);
  let done = atEnd ? 0 : Math.floor(Math.max(0, (now - start) / 864e5) / (365 / n));
  if (N) done = Math.min(done, N);
  return { i, perPay, N, gain, value: x.compound && !atEnd ? x.amount * (1 + i) ** done : x.amount, end: x.months ? new Date(y, m - 1 + x.months, d) : null };
}

function worth(state, now = new Date()) {
  const liquid = state.methods.reduce((a, m) => a + (balance(state, m) ?? 0), 0);
  const owed = state.debts.filter(d => d.dir === 'in').reduce((a, d) => a + d.amount, 0);
  const owe = state.debts.filter(d => d.dir === 'out').reduce((a, d) => a + d.amount, 0);
  const inv = (state.investments || []).reduce((a, x) => a + invest(x, now).value, 0);
  return { liquid, inv, owed, owe, total: liquid + inv + owed - owe };
}
// Gastos como tabla para pegar en Excel o Google Sheets.
const toTable = state => ['Fecha\tSobre\tNota\tMétodo\tValor', ...[...state.movements].sort((a, b) => a.date.localeCompare(b.date)).map(m =>
  [m.date, state.categories.find(c => c.id === m.cat)?.name || 'Sin sobre', m.note || '', state.methods.find(x => x.id === m.method)?.name || '', m.amount]
    .map(v => String(v).replace(/[\t\n]/g, ' ')).join('\t'))].join('\n');

function spentByCat(state, month) {
  const t = {};
  for (const m of state.movements) if (m.date.startsWith(month)) t[m.cat] = (t[m.cat] || 0) + m.amount;
  return t;
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
    state.movements.push({ id: uid(), t: Date.now(), amount: r.amount, cat: r.cat, method: r.method, note: r.name, date: `${month}-${pad(day)}`, rec: r.id });
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
    ].map(([id, name, icon, color, budget]) => ({ id, name, icon, color, budget })),
    methods: ['Efectivo', 'Nequi', 'Bancolombia', 'Nu'].map((name, i) => ({ id: 'm' + i, name })),
    movements: [], goals: [], recurring: [], debts: [], investments: [],
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
  hostTheme = document.documentElement.getAttribute('data-theme');
  S = store.load() || fresh(new Date(), true);
  S.movements = S.movements.filter(m => m.date >= START); // borra lo anterior a octubre 2026
  S.debts ||= [];
  S.investments ||= [];
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
  });
  document.addEventListener('change', e => {
    if (e.target.name === 'sort') { ui.sort = e.target.value; render(); }
    if (e.target.name === 'theme') { S.settings.theme = e.target.value; applyTheme(); commit(); }
  });
  document.addEventListener('keydown', e => {
    if (e.target.id === 'amt' && e.key === 'Enter') { e.preventDefault(); saveMov(); }
  });
  $('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
}

function applyTheme() {
  const t = S.settings.theme, r = document.documentElement;
  if (t !== 'system') r.setAttribute('data-theme', t);
  else if (hostTheme) r.setAttribute('data-theme', hostTheme);
  else r.removeAttribute('data-theme');
}

function commit() {
  ui.saveFail = !store.save(S);
  render();
}

function render() {
  for (const v of Object.keys(VIEWS)) $('#v-' + v).hidden = v !== ui.view;
  $('#v-' + ui.view).innerHTML = VIEWS[ui.view]();
  document.querySelectorAll('[data-tab]').forEach(b => b.dataset.tab === ui.view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  if (ui.flash) runFlash();
}

const gear = () => `<button class="icon-btn" data-act="tab" data-tab="ajustes" aria-label="Ajustes">${ico('sliders')}</button>`;
const monthBar = () => `<header class="top">
  <h1><button class="title-btn" data-act="year" data-y="${ui.month.slice(0, 4)}" aria-label="Ver calendario del año">${monthName(ui.month)} ${ico('down', 18)}</button></h1>
  <div class="top-actions">
    <button class="icon-btn" data-act="month" data-k="-1" aria-label="Mes anterior" ${ui.month <= START ? 'disabled' : ''}>${ico('left')}</button>
    <button class="icon-btn" data-act="month" data-k="1" aria-label="Mes siguiente" ${ui.month >= thisMonth() ? 'disabled' : ''}>${ico('right')}</button>
    ${gear()}
  </div>
</header>`;
const topBar = (title, extra = '') => `<header class="top"><h1>${title}</h1><div class="top-actions">${extra}${gear()}</div></header>`;

const banners = () =>
  (S.movements.some(m => m.ex) || S.goals.some(g => g.ex)
    ? `<div class="banner"><span>Estos son datos de ejemplo para que veas cómo funciona.</span><button class="btn small" data-act="clear-ex">Empezar de cero</button></div>` : '') +
  (ui.saveFail ? `<div class="banner bad">Este navegador no está guardando tus datos. Lo que anotes se perderá al cerrar.</div>` : '');

const movRow = m => {
  const c = cat(m.cat);
  return `<button class="row" data-act="edit-mov" data-id="${m.id}">
    <span class="dot" style="--c:${c.color}">${ico(c.icon, 16)}</span>
    <span><span class="t">${esc(m.note || c.name)}</span><span class="s">${m.note ? esc(c.name) + ' · ' : ''}${esc(meth(m.method))}${m.rec ? ' · recurrente' : ''}</span></span>
    <span class="a">${money(m.amount)}</span></button>`;
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

const VIEWS = {
  sobres() {
    const spent = spentByCat(S, ui.month);
    const total = sum(Object.values(spent), x => x);
    const withBudget = S.categories.filter(c => c.budget > 0);
    const budget = sum(withBudget, c => c.budget);
    const left = budget - sum(withBudget, c => spent[c.id] || 0);
    const recent = S.movements.filter(m => m.date.startsWith(ui.month)).sort(byDate).slice(0, 4);
    return monthBar() + banners() + `
    <section class="summary">${budget
      ? `<p class="big ${left < 0 ? 'neg' : ''}">${money(left)}</p><p class="sub">${left < 0 ? 'te pasaste del presupuesto' : 'te quedan de ' + money(budget)} · gastaste ${money(total)}</p>`
      : `<p class="big">${money(total)}</p><p class="sub">gastado en ${monthName(ui.month).toLowerCase()}</p>`}
    </section>
    <div class="envelopes">${S.categories.map(c => envelope(c, spent[c.id] || 0)).join('')}</div>
    ${recent.length ? `<h2 class="sec">Últimos gastos</h2><div class="list">${recent.map(movRow).join('')}</div>` : ''}`;
  },

  movs() {
    const list = S.movements.filter(m => m.date.startsWith(ui.month)).sort(byDate);
    if (!list.length) return monthBar() + banners() + `<p class="empty">No hay gastos en ${monthName(ui.month).toLowerCase()}. Toca <b>Anotar gasto</b> para registrar el primero.</p>`;
    const sort = ui.sort || 'new';
    const head = monthBar() + banners() + `<p class="sub total">${list.length} ${list.length === 1 ? 'gasto' : 'gastos'} · ${money(sum(list, m => m.amount))}</p>
      <div class="seg" role="radiogroup" aria-label="Ordenar" style="margin-top:12px">${[['new', 'Recientes'], ['high', 'Más caros'], ['low', 'Más baratos']]
        .map(([v, l]) => `<label><input type="radio" name="sort" value="${v}" ${sort === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
    if (sort !== 'new') {
      const sorted = [...list].sort((a, b) => (sort === 'high' ? b.amount - a.amount : a.amount - b.amount) || byDate(a, b));
      return head + `<div class="list" style="margin-top:16px">${sorted.map(m => movRow(m).replace('<span class="s">', `<span class="s">${dayLabel(m.date)} · `)).join('')}</div>`;
    }
    const days = new Map();
    for (const m of list) days.set(m.date, [...(days.get(m.date) || []), m]);
    return head + [...days].map(([d, ms]) => `<h2 class="day"><span>${dayLabel(d)}</span><span>${money(sum(ms, m => m.amount))}</span></h2><div class="list">${ms.map(movRow).join('')}</div>`).join('');
  },

  dinero() {
    const w = worth(S);
    const debtRow = d => `<button class="row" data-act="debt-edit" data-id="${d.id}"><span class="dot" style="--c:${d.dir === 'in' ? '#2E8C86' : '#C2544A'}">${ico('user', 16)}</span>
      <span><span class="t">${esc(d.who)}</span><span class="s">${esc(d.note || (d.dir === 'in' ? 'Te debe' : 'Le debes'))}</span></span><span class="a">${money(d.amount)}</span></button>`;
    const debts = dir => { const xs = S.debts.filter(d => d.dir === dir); return xs.length ? `<div class="list">${xs.map(debtRow).join('')}</div>` : `<p class="hint">${dir === 'in' ? 'Nadie te debe plata.' : 'No le debes plata a nadie.'}</p>`; };
    return topBar('Dinero') + banners() + `
    <section class="summary"><p class="big ${w.total < 0 ? 'neg' : ''}">${money(w.total)}</p>
      <p class="sub">tu dinero total: líquido ${money(w.liquid)}${w.inv ? ' + inversiones ' + money(w.inv) : ''}${w.owed ? ' + te deben ' + money(w.owed) : ''}${w.owe ? ' − debes ' + money(w.owe) : ''}</p></section>
    <div class="sec-head"><h2 class="sec">Dinero líquido · ${money(w.liquid)}</h2><button class="link" data-act="meth-edit">Nueva cuenta</button></div>
    <div class="list">${S.methods.map(m => { const b = balance(S, m); return `<button class="row" data-act="meth-edit" data-id="${m.id}"><span class="dot" style="--c:#4F6275">${ico('card', 16)}</span>
      <span><span class="t">${esc(m.name)}</span><span class="s">${b == null ? 'Toca para poner cuánto tienes' : 'Saldo'}</span></span><span class="a ${b < 0 ? 'neg' : ''}">${b == null ? '—' : money(b)}</span></button>`; }).join('')}</div>
    <p class="hint" style="margin-top:8px">Cada gasto se descuenta solo de la cuenta con que pagaste. Cuando te entre plata, toca la cuenta y actualiza el saldo.</p>
    <div class="sec-head"><h2 class="sec">Me deben · ${money(w.owed)}</h2><button class="link" data-act="debt-edit" data-dir="in">Agregar</button></div>${debts('in')}
    <div class="sec-head"><h2 class="sec">Debo · ${money(w.owe)}</h2><button class="link" data-act="debt-edit" data-dir="out">Agregar</button></div>${debts('out')}`;
  },

  inversiones() {
    const now = new Date(), xs = S.investments.map(x => ({ x, c: invest(x, now) }));
    const head = topBar('Inversiones', `<button class="btn small" data-act="inv-edit">${ico('plus', 16)} Nueva</button>`) + banners();
    if (!xs.length) return head + `<div class="empty"><p>Registra un CDT, una cajita o cualquier inversión con su tasa EA y mira cuánto te paga y cuánto vas a ganar.</p>
      <button class="btn primary" data-act="inv-edit">${ico('plus', 18)} Agregar inversión</button></div>`;
    const gain = sum(xs, o => o.c.gain || 0);
    const card = ({ x, c }) => {
      const atEnd = x.freq === 'e', f = FREQ[x.freq];
      const pay = atEnd ? ['Al vencimiento te pagan', c.perPay] : [`${f[2]} ${x.compound ? 'se suman' : 'te pagan'}`, c.perPay];
      return `<button class="inv" data-act="inv-edit" data-id="${x.id}">
        <span class="inv-head"><span class="inv-name">${esc(x.name)}</span><span class="pill">${String(x.rate).replace('.', ',')}% EA · ${f[1]}</span></span>
        <span class="inv-amt">${money(c.value)}</span>
        <span class="inv-facts">
          <span><small>${pay[0]}</small><b>${money(pay[1])}</b></span>
          <span><small>Al final ganas</small><b>${c.gain == null ? '—' : money(c.gain)}</b></span>
          <span><small>Vence</small><b>${c.end ? `${c.end.getDate()} ${c.end.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '')} ${c.end.getFullYear()}` : 'Sin fecha'}</b></span>
        </span></button>`;
    };
    return head + `<section class="summary"><p class="big">${money(sum(xs, o => o.c.value))}</p>
      <p class="sub">invertido${gain ? ` · vas a ganar ${money(gain)} en total` : ''}</p></section>
      <div class="invs">${xs.map(card).join('')}</div>`;
  },

  metas() {
    const card = g => {
      const p = Math.min(100, Math.round(g.saved / g.target * 100)) || 0;
      return `<article class="goal">
        <div class="goal-head"><h2>${esc(g.name)}</h2><button class="link" data-act="goal-edit" data-id="${g.id}">Editar</button></div>
        <p class="goal-amt"><b>${money(g.saved)}</b> de ${money(g.target)}</p>
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
    <section class="set"><div class="sec-head"><h2 class="sec">Sobres</h2><button class="link" data-act="cat-edit">Nuevo sobre</button></div>
      <div class="list">${S.categories.map(c => `<button class="row" data-act="cat-edit" data-id="${c.id}">
        <span class="dot" style="--c:${c.color}">${ico(c.icon, 16)}</span>
        <span><span class="t">${esc(c.name)}</span><span class="s">${money(spentByCat(S, thisMonth())[c.id] || 0)} este mes</span></span>${ico('right', 18)}</button>`).join('')}</div>
    </section>
    <section class="set"><div class="sec-head"><h2 class="sec">Gastos recurrentes</h2><button class="link" data-act="rec-edit">Nuevo</button></div>
      ${S.recurring.length ? `<div class="list">${S.recurring.map(r => {
        const c = cat(r.cat);
        return `<button class="row" data-act="rec-edit" data-id="${r.id}"><span class="dot" style="--c:${c.color}">${ico('repeat', 16)}</span>
          <span><span class="t">${esc(r.name)}</span><span class="s">Cada día ${r.day} · ${esc(c.name)} · ${esc(meth(r.method))}</span></span><span class="a">${money(r.amount)}</span></button>`;
      }).join('')}</div>` : `<p class="hint">Arriendo, internet, Netflix… Agrégalos y se anotan solos cada mes el día que elijas.</p>`}
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
  if (f) f.focus(); else d.querySelector('.sheet').scrollIntoView();
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

function openAdd(opts = {}) {
  const m = opts.id && S.movements.find(x => x.id === opts.id);
  ui.add = { id: m?.id, cat: m?.cat || opts.cat || null };
  const method = m?.method || (S.methods.some(x => x.id === S.settings.method) ? S.settings.method : S.methods[0].id);
  openSheet(sheetTop(m ? 'Editar gasto' : 'Anotar gasto') + `
    <label class="amount"><span>$</span><input id="amt" inputmode="numeric" enterkeyhint="done" autocomplete="off" placeholder="0" value="${m ? fmtNum(m.amount) : ''}" aria-label="Valor del gasto"></label>
    <p class="hint" id="add-hint">${m ? 'Cambia lo que necesites y toca Guardar.' : 'Escribe el valor y toca el sobre de donde sale.'}</p>
    <div class="pick" role="group" aria-label="Sobre">${S.categories.map(c => `<button type="button" class="pick-cat" data-act="pick" data-id="${c.id}" style="--c:${c.color}" aria-pressed="${ui.add.cat === c.id}">
      <span class="seal sm">${ico(c.icon, 16)}</span><span>${esc(c.name)}</span></button>`).join('')}</div>
    <div class="chips" role="radiogroup" aria-label="Método de pago">${S.methods.map(x => `<label class="chip"><input type="radio" name="method" value="${x.id}" ${x.id === method ? 'checked' : ''}><span>${esc(x.name)}</span></label>`).join('')}</div>
    <div class="two"><input class="text" id="note" placeholder="Nota (opcional)" value="${esc(m?.note || '')}" maxlength="60" aria-label="Nota"><input class="text" type="date" id="date" value="${m?.date || todayStr()}" min="${START}-01" aria-label="Fecha"></div>
    ${m ? `<div class="actions"><button type="button" class="btn danger" data-act="del-mov" data-confirm>Eliminar</button><button type="button" class="btn primary" data-act="save-mov">Guardar</button></div>` : ''}`, '#amt');
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
    note: $('#note').value.trim(), date: $('#date').value >= START ? $('#date').value : todayStr(),
  };
  const c = cat(data.cat), month = data.date.slice(0, 7);
  const before = shown(c, spentByCat(S, month)[c.id] || 0);
  const editing = ui.add.id;
  let m;
  if (editing) { m = S.movements.find(x => x.id === editing); Object.assign(m, data); delete m.ex; }
  else { m = { id: uid(), t: Date.now(), ...data }; S.movements.push(m); }
  S.settings.method = data.method;
  closeSheet();
  ui.month = month;
  if (!editing && ui.view === 'sobres') ui.flash = { cat: c.id, from: before, to: shown(c, spentByCat(S, month)[c.id] || 0) };
  commit();
  toast(`${editing ? 'Guardado' : 'Anotado'}: ${money(amount)} en ${c.name}`, editing ? null : () => { S.movements = S.movements.filter(x => x !== m); commit(); });
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
  const ms = S.movements.filter(m => m.cat === id && m.date.startsWith(ui.month)).sort(byDate);
  const s = sum(ms, m => m.amount), b = c.budget;
  openSheet(sheetTop(esc(c.name), `<button class="link" data-act="cat-edit" data-id="${id}">Editar</button>`) + `
    <div><p class="big sm ${b && s > b ? 'neg' : ''}">${money(b ? b - s : s)}</p>
    <p class="sub">${b ? (s > b ? 'te pasaste' : 'quedan de ' + money(b)) + ' · gastaste ' + money(s) : 'gastado'} en ${monthName(ui.month).toLowerCase()}</p></div>
    <button class="btn primary wide" data-act="add-in" data-id="${id}">${ico('plus', 18)} Anotar gasto en ${esc(c.name)}</button>
    ${ms.length ? `<div class="list">${ms.map(movRow).join('')}</div>` : `<p class="empty" style="padding-block:8px">Nada anotado en este sobre este mes.</p>`}`);
}

function openCatEdit(id) {
  const c = id ? cat(id) : { name: '', icon: 'dots', color: COLORS[S.categories.length % COLORS.length][0], budget: 0 };
  openSheet(sheetTop(id ? 'Editar sobre' : 'Nuevo sobre') + `<form class="form" data-form="cat" data-id="${id || ''}">
    ${textField('name', 'Nombre', c.name)}
    <fieldset class="field"><legend>Ícono</legend><div class="icons">${CAT_ICONS.map(k => `<label class="ic"><input type="radio" name="icon" value="${k}" ${k === c.icon ? 'checked' : ''} aria-label="${k}"><span>${ico(k)}</span></label>`).join('')}</div></fieldset>
    <fieldset class="field"><legend>Color</legend><div class="colors">${COLORS.map(([k, n]) => `<label class="sw" style="--c:${k}"><input type="radio" name="color" value="${k}" ${k === c.color ? 'checked' : ''} aria-label="${n}"><span></span></label>`).join('')}</div></fieldset>
    ${actions(id, 'cat-del')}</form>`, id ? null : 'input[name=name]');
}

function openRec(id) {
  const r = id ? S.recurring.find(x => x.id === id) : { name: '', amount: 0, cat: S.categories[0]?.id, method: S.methods[0].id, day: new Date().getDate() };
  openSheet(sheetTop(id ? 'Editar recurrente' : 'Nuevo gasto recurrente') + `<form class="form" data-form="rec" data-id="${id || ''}">
    ${textField('name', 'Nombre', r.name)}
    ${moneyField('amount', 'Valor', r.amount, '0')}
    ${select('cat', 'Sobre', S.categories, r.cat)}
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
    ${actions(id, 'goal-del')}</form>`, id ? null : 'input[name=name]');
}

function openGoalAdd(id) {
  const g = S.goals.find(x => x.id === id);
  openSheet(sheetTop('Abonar a ' + esc(g.name)) + `<form class="form" data-form="goal-add" data-id="${id}">
    <label class="amount"><span>$</span><input name="amount" inputmode="numeric" data-money autocomplete="off" placeholder="0" aria-label="Valor del abono" required></label>
    <p class="hint">Llevas ${money(g.saved)} de ${money(g.target)}.</p>
    <button class="btn primary wide">Abonar</button></form>`, 'input[name=amount]');
}

// Calendario del año: cada mes con lo que gastaste; desde octubre 2026 hasta el mes actual.
function openYear(y) {
  const first = +START.slice(0, 4), last = +thisMonth().slice(0, 4);
  const nav = (k, ok, label) => `<button type="button" class="icon-btn" data-act="year" data-y="${y + k}" aria-label="${label}" ${ok ? '' : 'disabled'}>${ico(k < 0 ? 'left' : 'right')}</button>`;
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = `${y}-${pad(i + 1)}`, off = m < START || m > thisMonth();
    const spent = sum(S.movements.filter(x => x.date.startsWith(m)), x => x.amount);
    return `<button class="month-cell" data-act="pick-month" data-m="${m}" ${off ? 'disabled' : ''} aria-current="${m === ui.month}">
      <span>${cap(new Date(y, i, 1).toLocaleDateString('es-CO', { month: 'short' }).replace('.', ''))}</span><b>${off ? '—' : money(spent)}</b></button>`;
  }).join('');
  openSheet(sheetTop('Calendario') + `<div class="year-nav">${nav(-1, y > first, 'Año anterior')}<h2>${y}</h2>${nav(1, y < last, 'Año siguiente')}</div>
    <div class="year">${months}</div>`);
}

function openMeth(id) {
  const m = id ? S.methods.find(x => x.id === id) : { name: '' };
  const b = id ? balance(S, m) : null;
  openSheet(sheetTop(id ? 'Editar cuenta' : 'Nueva cuenta') + `<form class="form" data-form="meth" data-id="${id || ''}">
    ${textField('name', 'Nombre', m.name)}
    <label class="field"><span>¿Cuánto tienes hoy?</span><input class="text" name="bal" inputmode="numeric" data-money autocomplete="off" value="${b > 0 ? fmtNum(b) : ''}" placeholder="${b == null ? 'Opcional' : 'Escribe el saldo nuevo'}"></label>
    ${b < 0 ? `<p class="hint">Hoy el saldo va en ${money(b)}.</p>` : ''}
    ${id && S.methods.length > 1 ? actions(id, 'meth-del') : actions()}</form>`, id ? 'input[name=bal]' : 'input[name=name]');
}

function openDebt(id, dir) {
  const d = id ? S.debts.find(x => x.id === id) : { who: '', amount: 0, note: '', dir };
  const inn = d.dir === 'in';
  openSheet(sheetTop(id ? (inn ? 'Te debe' : 'Le debes') : (inn ? 'Alguien me debe' : 'Yo debo')) + `<form class="form" data-form="debt" data-id="${id || ''}" data-dir="${d.dir}">
    ${textField('who', inn ? '¿Quién te debe?' : '¿A quién le debes?', d.who)}
    ${moneyField('amount', 'Cuánto', d.amount, '0')}
    <label class="field"><span>Nota (opcional)</span><input class="text" name="note" value="${esc(d.note)}" maxlength="60" placeholder="Ej. almuerzo del viernes"></label>
    ${id ? `<div class="actions"><button type="button" class="btn" data-act="debt-del" data-id="${id}">${inn ? 'Ya me pagó' : 'Ya pagué'}</button><button class="btn primary">Guardar</button></div>` : actions()}</form>`, id ? null : 'input[name=who]');
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
    <p class="hint" id="inv-hint">Si eliges "al vencimiento", pon el plazo.</p>
    ${actions(id, 'inv-del')}</form>`, id ? null : 'input[name=name]');
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
    case 'month': ui.month = shiftMonth(ui.month, +el.dataset.k); render(); break;
    case 'year': openYear(+el.dataset.y); break;
    case 'pick-month': ui.month = el.dataset.m; closeSheet(); render(); break;
    case 'add': openAdd(); break;
    case 'add-in': openAdd({ cat: id }); break;
    case 'close': closeSheet(); break;
    case 'open-cat': openCatDetail(id); break;
    case 'edit-mov': openAdd({ id }); break;
    case 'pick':
      ui.add.cat = id;
      document.querySelectorAll('.pick-cat').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === id));
      if (!ui.add.id) saveMov();
      break;
    case 'save-mov': saveMov(); break;
    case 'del-mov': S.movements = S.movements.filter(m => m.id !== ui.add.id); closeSheet(); commit(); toast('Gasto eliminado'); break;
    case 'clear-ex': S.movements = S.movements.filter(m => !m.ex); S.goals = S.goals.filter(g => !g.ex); commit(); toast('Listo. Ahora todo es tuyo.'); break;
    case 'cat-edit': openCatEdit(id); break;
    case 'cat-del': S.categories = S.categories.filter(c => c.id !== id); closeSheet(); commit(); toast('Sobre eliminado'); break;
    case 'rec-edit': openRec(id); break;
    case 'rec-del': S.recurring = S.recurring.filter(r => r.id !== id); closeSheet(); commit(); break;
    case 'goal-edit': openGoal(id); break;
    case 'goal-add': openGoalAdd(id); break;
    case 'goal-del': S.goals = S.goals.filter(g => g.id !== id); closeSheet(); commit(); break;
    case 'meth-del': S.methods = S.methods.filter(m => m.id !== id); closeSheet(); commit(); break;
    case 'backup': copyText(JSON.stringify(S), 'Respaldo copiado. Pégalo en tus notas para guardarlo.', 'Tu respaldo'); break;
    case 'export': copyText(toTable(S), 'Gastos copiados. Pégalos en una hoja de Excel o Google Sheets.', 'Tus gastos'); break;
    case 'meth-edit': openMeth(id); break;
    case 'debt-edit': openDebt(id, el.dataset.dir); break;
    case 'inv-edit': openInv(id); break;
    case 'inv-del': S.investments = S.investments.filter(x => x.id !== id); closeSheet(); commit(); toast('Inversión eliminada'); break;
    case 'debt-del': S.debts = S.debts.filter(d => d.id !== id); closeSheet(); commit(); toast('Deuda saldada'); break;
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
      upsert(S.methods, { name: d.name.trim(), ...v });
      break;
    }
    case 'inv': {
      const months = digits(d.months), rate = parseFloat(String(d.rate).replace(',', '.')) || 0;
      if ((d.freq === 'e' && !months) || !rate) {
        const h = $('#inv-hint');
        h.textContent = !rate ? 'Escribe la tasa EA, por ejemplo 9.' : 'Para "al vencimiento" necesito el plazo en meses.';
        h.className = 'hint err';
        return;
      }
      upsert(S.investments, { name: d.name.trim(), amount: digits(d.amount), rate, freq: d.freq, compound: d.mode === 'sum', start: d.start, months: months || null });
      break;
    }
    case 'debt': upsert(S.debts, { who: d.who.trim(), amount: digits(d.amount), note: d.note.trim(), dir: f.dataset.dir }); break;
    case 'cat': upsert(S.categories, { name: d.name.trim(), budget: 0, icon: d.icon, color: d.color }); break;
    case 'rec': {
      const day = Math.max(1, Math.min(31, digits(d.day)));
      const r = { name: d.name.trim(), amount: digits(d.amount), cat: d.cat, method: d.method, day };
      if (!id && todayStr() > `${thisMonth()}-${pad(day)}`) r.last = thisMonth();
      upsert(S.recurring, r);
      postRecurring(S, new Date());
      break;
    }
    case 'goal': upsert(S.goals, { name: d.name.trim(), target: digits(d.target), saved: digits(d.saved), ex: undefined }); break;
    case 'goal-add': { const g = S.goals.find(x => x.id === id); g.saved += digits(d.amount); toast(`Abonaste ${money(digits(d.amount))} a ${g.name}`); break; }
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

if (typeof module !== 'undefined') module.exports = { money, digits, ymd, spentByCat, postRecurring, fresh, balance, worth, toTable, invest };
else {
  boot();
  // App instalada: funciona sin internet y pide al navegador no borrar los datos.
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.storage?.persist?.().catch(() => {});
}
