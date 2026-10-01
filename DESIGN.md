# Design: Mis Sobres

The app is built on the cash-envelope method. Each category is a paper envelope with a V-shaped flap and a round seal that holds its icon. The money left in the envelope fills it from the bottom, up to a dashed "level" line.

## Color
The ground is a pale security-paper green. Ink and the accent are deep peso green. Everything is defined as tokens in `index.html` `:root`, with the same token names in dark mode.

| Token | Light | Dark |
|---|---|---|
| --bg | #EDF0EA | #0F1411 |
| --surface | #F9FBF7 | #18201B |
| --ink | #16201A | #E4EBE6 |
| --ink-2 | #55635A | #9AA99F |
| --line | #D3DBD1 | #2A342E |
| --accent | #16603F | #4FBF8B |
| --danger | #B3362B | #F07A6E |
| --warn | #8F5B0F | #E0A84A |

- **Envelope colors** are drawn from Colombian banknote hues and live in `COLORS` in `app.js`: ocre, azul, morado, verde azulado, rojo, verde, naranja, rosa, oliva and pizarra.
- **Envelope parts** mix the envelope's color `--c` with `--surface`: 10% for the body, 34% for the flap and 26% for the money-left fill. The seal is solid `--c` with a white icon.
- **Semantic colors** are separate from the accent: `--warn` marks an envelope with less than 20% left, and `--danger` marks an envelope that went over budget (it also gets an inset ring).

## Type
- **Bricolage Grotesque** (600–800) is used only for amounts and titles.
- **Manrope** (400–800) is used for all other UI text.
- Every amount uses `tabular-nums`.
- Money is written as `$1.234.567`. Negative amounts use a real minus sign (`−$`).

## Components
- **Envelope (`.env`):** a 12px radius, a soft neutral shadow, and a flap made with a 3-point `clip-path`.
- **Lists (`.list` > `.row`):** one surface card per group, with 1px dividers and a 32px tinted `.dot` icon.
- **Buttons:**
  - `.btn` is 46px tall and has a 12px radius.
  - `.btn.primary` uses the accent color.
  - `.link` is a text-only accent action.
- **Selectable options:** `.chip` (payment method), `.seg` (theme), `.ic` (icon) and `.sw` (color swatch) are radios styled as chips.
- **Sheets:** a `<dialog>` that fills the screen on phones and becomes a centered 560px card from 700px wide.
- **Bottom bar:** a fixed tab bar plus a centered green "Anotar gasto" pill.
- **Icons:** Lucide-style inline SVG with a 2px stroke. Emoji are never used.

## Motion
- **Signature moment:** when you save a gasto, its envelope's flap lifts, the seal hops, the amount counts down and the fill drops. This takes 0.8–0.9s with an ease-out curve.
- **Everything else:** sheets rise in over 0.28s, and buttons have a small press-scale effect.
- All motion turns off under `prefers-reduced-motion`.

## Update: investments and polish
- **Navigation**
  - The bottom bar holds Sobres, Gastos, Dinero, Inversión and Metas.
  - The active tab gets a tinted pill (accent at 18%) behind its icon.
  - Ajustes is a sliders icon at the top right of every screen, and it has a back button.
- **Top bar:** the title sits on the left and the actions sit on the right (`.top-actions`). The month title keeps its calendar chevron.
- **Buttons:** 50px tall with a 14px radius. `:active` scales to 0.97. Primary buttons get an inset highlight and a soft drop shadow. `.link` is a pill-shaped tap target.
- **FAB:** 58px tall, and its plus sits in a translucent circle.
- **Inputs:** 52px tall, 16px text (this stops iOS from zooming in) and a 12px radius. Field labels use `--ink` at 700 weight.
- **Rows:** 66px tall, with a 38px rounded-square `.dot` icon. `.list` has an 18px radius.
- **Empty states:** a dashed 18px card with a short sentence and one primary action.
- **Investment card (`.inv`):**
  - Name in the display face, next to a `.pill` for the rate and frequency.
  - Current value at 30px.
  - A 3-column facts row (pago, al final, vence) separated from the rest by a hairline.

## Update: elegance pass
- **Guilloche:** a banknote-style guilloche (a wave rosette SVG used as a mask, tinted with `--accent` at 22%) fades in behind the big figure on each summary.
- **Big figures:** `big()` shrinks the `$` sign and raises it (`.cur`).
- **Depth on press:** buttons and the FAB have a bottom inner edge (`--edge`). On `:active` they sink by 1.5–2px, lose that edge and their shadow, then spring back on release with `--spring` (cubic-bezier(.34,1.56,.64,1)). Envelopes, cards, chips and tab icons use the same spring. The FAB's plus rotates 90° while pressed.
- **Floating tab bar:** a rounded 24px bar that floats 8px above the safe area, with a soft shadow and a backdrop blur.
- **Sheets:**
  - On phones: a bottom sheet with 22px top corners and a grabber, sliding up with `--ease`, over a backdrop that fades in.
  - On desktop: a centered card sized to its content (`height: fit-content`).
- **Tab changes:** the incoming view fades in and rises 10px over 0.42s.

## Update: richer money features
- **Resumen del mes:** a `.list` of info rows. Positive amounts use `.a.pos` (accent) and worse amounts use `.a.neg`.
- **Card-payment alert:** a `.banner.alert` in warn tint that springs on tap.
- **Search:** `.searchbox` is a 50px surface field with a focus ring. `#tag` filters are `.chip-btn` pills in accent tint, solid when active.
- **Gastos frecuentes:** `.quick-btn` chips scroll horizontally at the top of the add sheet. Each one is tinted by its sobre color and has a bottom inner edge.
- **Dividir:** a `<details class="split">` card inside the add sheet.
- **Deudas:** the abono form sits in a raised `.pay-box` card above the details form.
- **Row subtitles** now wrap to 2 lines (line-clamp) so key facts like the card payment day stay visible.

## Update: investment detail
- **Opening it:** tapping an investment card opens a sheet with the current value, a growth chart, four `.tile` stats (earned so far, total gain, days left, real EA) and a month-by-month `.months` table.
- **Growth chart:** a single-series SVG. The curve is a 2.5px `--accent` line over an accent area fading to transparent.
  - What you invested is a dashed `--ink-2` baseline, labeled directly at the right.
  - A thin "Hoy" rule marks today.
  - Pointer or touch shows a crosshair, a ringed dot and an ink tooltip.
  - All text uses ink tokens, never the series color.

## Update: subcategories, flow strip, chart, backup note
- **Subcategories:** each sobre can have a comma-separated list. In the add sheet the chosen sobre reveals `.subs` chips (`.chip-btn`, 40px tall). Sobres without subs still save on one tap.
- **Day chips:** `.when` holds Hoy / Ayer / Anteayer under the date field, and the chip that matches the date is filled.
- **Flow strip:** `.flowstrip` shows three `.ftile` tiles (Entró, Gastaste, Quedó) under the big figure on Sobres, for whatever period is chosen.
- **Time chart:** `barChart` is a single-series SVG of rounded-top bars in `--accent`. The current period is full strength and the others are at 72%. It has three gridlines, a compact money axis (`$100 mil`, `$1,2 M`) and a tap tooltip. A table below repeats every value, and the period is picked with a `.seg` control (15 días, Mes, Trimestre).
- **Backup note:** `.nudge` is a single quiet line at the bottom of Sobres with a "Copiar" link and a softer "Luego" link. It appears after 7 days and snoozes for 3.
- **iOS:** date and month inputs, selects, search and number inputs reset their native appearance so they fit the column on iPhone. Interactive controls are at least 40px tall.

## Update: custom ranges
- **Range controls** (`rangeChips`): quick `.chip-btn` presets (Esta semana, Este mes, 15/30 días, Este año, Todo) over two date fields (Desde, Hasta). Typing a date drops the preset. They are shared by the time chart and by Entradas y transferencias.
- **Time chart:** groups by Día, Semana (Mon–Sun), 15 días, Mes or Trimestre, up to 60 bars. Axis labels are spaced by their measured width so they never touch, and the last label hugs the right edge.
- **Entradas y transferencias:** a kind filter (Todo, Ingresos, Transferencias) and a sort control (Recientes, Mayor a menor, Menor a mayor) sit under the range. The "De dónde te entra más plata" ranking follows the same range.
