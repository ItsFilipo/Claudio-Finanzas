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
