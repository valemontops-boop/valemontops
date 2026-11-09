# Design system — Valemont OS

Derived from spec §8. References in `docs/design-inspiration/` are a vocabulary, not layouts to copy.

## Direction
Calm, light workspace: quiet surfaces, large confident numbers, near-monochrome; primary actions in ink. One theme ships; tokens are
semantic (`--canvas`, `--panel`, …) so a dark theme can be added later.

## Tokens (`src/app/globals.css`)
| Token | Value | Use |
|---|---|---|
| canvas | #F1F0EC | app background |
| panel | #FBFAF7 | panels, sidebar |
| ink | #17161A | primary text, the single dark block |
| text-2 | #57545C | secondary text (7.1:1 on panel) |
| text-3 | #6E6A72 | tertiary, never lighter (5.1:1) |
| hairline | #E2E0DA | separators only |
| control-border | #8E8A92 | input/control boundaries (3.2:1) |
| accent | #17161A | primary action fill with `on-accent` #FBFAF7 text (orange removed at the founders' request, D017) |
| accent-text | #17161A | links (underlined) |
| good / bad | #17704F / #B3261E | status only, with icon and sign |
| sales / sales-soft | #2A78D6 / #E9F1FB | sales activity everywhere: calls, dials, outreach, Call mode, CRM, My Day › Sales (D044) |
| win / win-soft | #16946A / #E3F3EC | results: yes, meetings, won, targets reached, passed days |
| mkt / mkt-soft | #7A4FD6 / #EFE9FB | marketing: traffic, audience, content, ideas |
| ops / ops-soft | #0E8FA3 / #E0F2F5 | ops: tasks, agenda, files |
| brand-consulting / brand-local / brand-thirty | #2F5FBF / #D6457A / #7A4FD6 | brand dots only (Local was orange; the palette has no orange) |
| market FR / ES | ink / #8E8A92 | direct-labelled |

Type: Geist (via the `geist` package, `next/font/local` under the hood), `tabular-nums` on every number.
Scale 12/14/16/20/24/32/48; hero number 40–48px weight 500–600, tight tracking. Body 14–16.

Shape: panels radius 20, inner rows 12, controls/segmented switches fully rounded. Spacing 4/8/16/24/32/48.
Surfaces separate by tone and hairline; shadow only on floating layers. No card inside a card.

Color rule (D044): one meaning per color across the app; tiles take the soft tint of their area with a colored key dot,
values stay in ink. Section headers carry a colored bar; the active menu item takes its section's tint. Colorblind
validation was dropped at the founders' request; meaning is still never color-only (labels and values are printed).
Shared pieces in `src/components/app/charts.tsx`: Kpi (tint, delta, sparkline, progress), Funnel (step conversion),
Bars, Columns, Spark, Ring, SplitBar, ToneTitle; tokens in `src/lib/tones.ts`.

## Limits (§8.2) — checked per screen
≤5 primary numbers above the fold · ≤1 chart above the fold · accent ≤2 per screen (primary action + focus) ·
≤1 dark ink block · overview lists ≤5 rows + "See all" · hide empty widgets unless the empty state gives the next action ·
details in a right panel (list stays visible); modals only for protected focus (Quick Action) · My Day Focus toggle.

## Components
- **ActionMeter** (signature): one tick per action up to target; hollow tick while saving; fills only after server
  confirmation; continuous bar above 60.
- **Solid vs hatched**: solid = recorded fact, hatched = remaining/projected (`.hatch`).
- **SegmentedBar** with legend counts, 2px gaps: pipeline by stage.
- **SegmentedSwitch**: views, periods.
- **TaskRow** with round check (follow-ups).
- **SetupChecklist** with struck-through completed items (onboarding / setup page).
- **Sidebar** quiet active row, action badges only, account block at the bottom showing work mode.
- **DetailPanel** right-hand properties panel (CRM).
- **SyncBadge**: "Saved" / "Syncing" / "Error: retry" — only after server confirmation.

## Behavior
My Day opens on the next action, not KPI tiles. Tables for tabular data. Every metric shows its denominator.
No eyebrow labels, gradient text, colored side stripes, emoji, praise, greetings, badges or sounds.
Contrast ≥ 4.5:1 for text, visible focus rings, labelled inputs, ≥44px touch targets; Log Call and Log Field Visit
are completable with one thumb (bottom sheet on phones). Keyboard: ⌘K palette, single-key quick actions, Enter saves,
Escape closes. Motion < 200ms ease-out, disabled under `prefers-reduced-motion`.
