# DESIGN.md — the Sous design constitution

Every slice shipped after this file exists is graded against it. The rubric is at
the bottom. Below 8/10 is not done. Anything on the NEVER SHIP list fails the
slice outright, regardless of score.

Read CONTEXT.md first. Design decisions here are subordinate to the domain
decisions there.

---

## 1. Aesthetic thesis

Sous is a financial instrument for someone who did not want a financial
instrument. It must feel calm, precise and warm — a well-kept ledger, not a SaaS
dashboard. Paper-warm surfaces, ink-dark text, numbers that sit still in aligned
columns, one accent used sparingly, generous whitespace that makes a small amount
of information feel composed rather than empty. Decoration is spent only where
trust is earned: the numbers, their alignment, their traceability. Rejected
outright: gradient hero cards, emoji in UI chrome, purple-to-blue anything, the
generic dashboard grid-of-stat-cards, and the default shadcn look shipped
unchanged.

## 2. Theming engine

Each org picks **up to 3 colours** at onboarding. Colour 1 is mandatory; 2 and 3
are optional.

- **Colour 1 → primary.** Buttons, active nav, focus rings, links, chart series 1.
- **Colour 2 → accent.** Secondary emphasis, chips, chart series 2. When absent,
  derived from primary: hue rotated ±30° in OKLCH at matched chroma (the rotation
  direction that lands furthest from the semantic hues below is chosen).
- **Colour 3 → surface tint.** The paper of the app. When absent, derived:
  primary's hue at chroma ≈ 0.015, near-white lightness (near-black in dark
  mode). The brand's temperature enters invisibly.

**Derivation is in OKLCH, never HSL**, so lightness steps stay perceptually even
across hues. Each input colour generates a 12-step scale (50–950) by a fixed
lightness ladder with a chroma curve peaking mid-scale. Light and dark mode each
map the same scale to tokens differently. Implementation:
[lib/theme/derive.ts](lib/theme/derive.ts). Tokens land as CSS variables on a
root carrying `data-mode="light" | "dark"`; org values are applied as inline
variables by the theme provider. Both modes ship in v1.

**Contrast guard.** The picker refuses combinations that fall below WCAG AA
(4.5:1 body text, 3:1 large text and UI components) **on the surfaces they will
actually land on, in both light and dark mode** — and says so in plain language
while she is choosing, never after she has committed. Refusal always offers a
door: the nearest passing shade (same hue and chroma, lightness nudged in OKLCH
until AA passes) is offered one tap away — "Too light to read on white — here's
the closest that works." Committing is disabled while any colour fails. There is
no "save anyway."

**Semantic colours are fixed and never derived from her palette:**

| Token | Meaning | Light | Dark |
|---|---|---|---|
| `--profit` | positive money, margin above target | green, oklch(0.55 0.15 150) | oklch(0.72 0.17 150) |
| `--loss` | negative money, margin below target | red, oklch(0.55 0.21 27) | oklch(0.68 0.19 25) |
| `--warn` | amber pantry alerts, stale estimates | oklch(0.68 0.14 75) | oklch(0.78 0.14 80) |
| `--danger` | red pantry alerts, destructive actions | same family as `--loss` | same |

A kitchen that picks red as its brand colour must not have "you are losing
money" rendered as brand chrome. If a picked brand colour sits within ΔH < 20°
of a semantic hue, the picker says so ("this is close to the red Sous uses for
losses — it still works, but losses will always show the fixed red") — a flag,
not a veto.

**Neutrals** are warm-toned greys (ledger paper, not screen grey): a 12-step
OKLCH ramp with a whisper of hue (h ≈ 75, c ≈ 0.004–0.012), overridden by colour
3's tint when present.

## 3. Type, space, radius, elevation — one decision each

**Typefaces** (all via `next/font`, self-hosted):

- **Fraunces** — display only: page titles, invoice header, empty-state
  headlines. Never below 24px.
- **Poppins** — all UI text: body, labels, buttons, nav, sub-display headings.
- **Inter, numerals only** — every rendered number (money, margins, quantities,
  tabular dates) via the `.numeric` utility: Inter with
  `font-feature-settings: "tnum"`. It never sets prose. It exists because the
  ledger's columns must align to the decimal. Poppins has no tabular figures;
  money in Poppins is a NEVER SHIP.
- **Ephesis** — brand flourish only: the wordmark, the invoice thank-you line.
  ≥28px always. Never headings, never labels, never numbers.
- Bagel Fat One was considered and dropped: incompatible with the thesis.

**Type scale** (fixed steps; no per-component font sizes):

| Token | Size/leading | Face | Use |
|---|---|---|---|
| `display-lg` | 38/44 | Fraunces 600 | Home greeting, invoice header |
| `display` | 30/36 | Fraunces 600 | Page titles |
| `display-sm` | 24/30 | Fraunces 500 | Section titles, empty-state headlines |
| `title` | 20/28 | Poppins 600 | Card titles, dialog titles |
| `body-lg` | 17/26 | Poppins 400 | Reading text |
| `body` | 15/22 | Poppins 400 | Default UI text |
| `label` | 13/18 | Poppins 500 | Form labels, table headers, nav |
| `caption` | 12/16 | Poppins 400 | Timestamps, footnotes, sample sizes |
| `numeric-xl` | 28/34 | Inter 600 tnum | The one number a screen is about |
| `numeric-lg` | 20/28 | Inter 600 tnum | Card-level totals |
| `numeric` | 15/22 | Inter 500 tnum | Table cells, line items |
| `numeric-sm` | 13/18 | Inter 500 tnum | Dense tables, chart axes |

**Spacing**: 4px grid. Allowed steps: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
Nothing off-grid. Screen gutters: 16px mobile, 24px desktop.

**Radius**: three stops plus round. `--radius-sm: 6px` (inputs' inner elements,
checkboxes), `--radius-md: 10px` (buttons, inputs, chips' rectangles),
`--radius-lg: 14px` (cards, dialogs, drawers), `--radius-full` (avatars,
occasion chips, status dots). No other values, ever.

**Elevation**: three levels, warm-tinted shadows (shadow colour is the deep
neutral hue, not black).

- **Level 0 — resting.** Border only (`--border`), no shadow. The default. A
  ledger is flat.
- **Level 1 — floating.** Popovers, dropdowns, tooltips:
  `0 1px 2px oklch(0.28 0.02 75 / 0.06), 0 4px 12px oklch(0.28 0.02 75 / 0.10)`.
- **Level 2 — overlay.** Dialogs, drawers:
  `0 2px 6px oklch(0.28 0.02 75 / 0.08), 0 16px 40px oklch(0.28 0.02 75 / 0.16)`.

Dark mode halves shadow opacity and leans on borders instead. No hover-elevation
changes on cards; elevation states nothing but stacking order.

## 4. Numeric display rules

This is a maths app. This section outranks every other.

- **Tabular figures everywhere** a number can change or be compared — `.numeric`
  utility, no exceptions, including chart axes and tooltips.
- **Money is always 2dp with the currency symbol**: `$12.40`, never `$12.4`,
  never `12.40`, never abbreviated to `$1.2k` on any screen where she might act
  on the number. (Axis *tick labels* on charts may abbreviate; the tooltip
  showing the actual value never does.)
- **Margins are 0dp with the % sign**: `62%`, never `61.8%`.
- **Negative money is red AND parenthesised**: `($4.20)` in `--loss`. Colour
  alone fails colourblind users and fails in a WhatsApp screenshot.
- **Every derived number is traceable.** Tapping a margin reveals the three
  layers that produced it; tapping a cost reveals its lines. She will not trust
  a number she cannot take apart. A derived number with no breakdown affordance
  is a defect.
- **Staleness is part of the number.** A number computed from stale estimates
  (see CONTEXT.md pantry freshness) renders with its staleness stated. A number
  whose staleness is unknown does not render.

## 5. Charting rules

All charts come from **Bklit UI** ([bklit.com/docs](https://bklit.com/docs)) —
no other charting library, including hand-rolled SVG charts.

- **A chart earns its place only when shape beats prose.** Most of Sous is
  sentences. If a chart's insight fits in a sentence, ship the sentence.
- **Series colours derive from the org palette** (primary scale, then accent
  scale). **Semantic colours never do**: profit, loss, amber alert, red alert
  and target lines use the fixed semantic tokens. A kitchen whose brand colour
  is red must not have "you are losing money" render as brand chrome.
- **Every charted value is traceable.** Bklit's Tooltip utility carries the
  cost-layer breakdown behind the number. A chart whose figures cannot be taken
  apart is decoration.
- **Pie at 4 slices or fewer.** Beyond that, sorted horizontal Bar. Ring is for
  binary splits only. A 12-item menu as a pie is an unreadable colour wheel
  where 8% and 11% are indistinguishable.
- **Three extra states per chart, designed, not defaulted**: empty (a new
  kitchen has one order), single-data-point (a dot is not a line), too-much-data
  (a year-old kitchen has 800 orders — aggregate, paginate or summarise). Each
  states what it needs to become useful.
- **Sample sizes are stated wherever a claim depends on one.** n=11 is not a
  trend and must not be drawn as one. No trend line through fewer than 8 points.
- **Axes always start at zero for money and counts.** Truncated axes exaggerate
  change, and this is an app whose entire premise is telling the truth about
  numbers.

## 6. Motion

Per emil-design-eng. Easing tokens, verbatim:

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
```

Durations: `--duration-fast: 120ms` (micro-feedback), `--duration-base: 200ms`
(popovers, fades), `--duration-drawer: 260ms` (drawers, sheets).

Rules:

- Nothing over 300ms.
- Never ease-in. Enter with `--ease-out`; move with `--ease-in-out`; drawers
  with `--ease-drawer`.
- Never `scale(0)`. Popovers scale from ~0.95 at their trigger origin
  (`transform-origin` set from the trigger side); modals stay centred and fade
  + scale from ~0.95.
- Exits run faster than enters: overlays enter at `--duration-base` (200ms)
  and leave at 150ms. Slow where she is deciding, fast where Sous is
  responding.
- Buttons `scale(0.97)` on `:active`.
- Hover effects gated behind `@media (hover: hover) and (pointer: fine)` — she
  is on a phone in a kitchen.
- `prefers-reduced-motion: reduce` collapses all of it to opacity or nothing.
- Anything she does dozens of times a day does not animate at all: list rows,
  tab switches, keyboard focus moves, table sorting, calendar day taps.
- `transition: all` is a NEVER SHIP. Transition named properties only.

## 7. Empty states

A first-class deliverable, not a fallback. A new kitchen sees empty screens for
its entire first week — the empty states *are* the first-week product. Every
screen ships one, and each one:

- **Names the next action** as its single button ("Add your first menu item"),
  never a shrug ("Nothing here yet").
- Explains in one sentence what the screen will show once it has data —
  vocabulary from CONTEXT.md, her words ("Pantry", not "inventory").
- Uses `display-sm` Fraunces headline + one body line + one primary action. No
  illustrations bought from a marketplace; a quiet glyph at most.
- Never shows a zero as data. An empty dashboard does not chart $0.00 — it says
  what it's waiting for.

Loading states are skeletons in the shape of the real content (no spinners for
list/table loads). Error states say what failed and what she can do, in plain
language, and never dead-end.

## 8. The grading rubric

Score each slice out of 10, weighted:

| Criterion | Weight |
|---|---|
| Visual craft and restraint (does it look designed or generated) | 3 |
| Numeric and chart legibility and trustworthiness | 2 |
| Motion correctness against the emil rules | 2 |
| Mobile ergonomics: thumb reach, tap targets ≥ 44px, no hover-dependent affordance | 2 |
| Empty, loading and error states present and considered | 1 |

**NEVER SHIP — any single occurrence is an automatic fail regardless of score:**

- `transition: all`
- A number displayed without knowing whether it is stale
- A destructive action without confirmation
- Costs or margins reachable by a staff-role user
- Money rendered in a proportional font
- A screen with no empty state
- A pie chart with more than 4 slices
- A chart with a truncated money or count axis
- A charting library other than Bklit
- A trend drawn through fewer than 8 data points
