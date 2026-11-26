# FleetMind design spec: Baltic Amber

The approved look for the whole product. Visual reference: `design/reference/control-centre.reference.html`
(a design mock-up, not production code; copy its look, not its code). Online canvas:
https://claude.ai/artifact/PyTvJwL8Be7j9UcfNCw8co

## Principles
- Map-first control centre, like Uber/Bolt; polish like Linear/Stripe; Apple-level attention to detail.
- One brand colour: amber. Quiet neutrals everywhere else. No pine green, no gradients as decoration.
- Floating frosted-glass panels over a full-screen map.
- Subtle, smooth motion that always means something. Respect "reduce motion".
- Every screen answers "what needs me right now?". Decisions and actions, not just data.
- Light mode by default, dark mode toggle, both first-class.

## Type
- Font: **Manrope** (Google Fonts), weights 400/500/600/700/800. Nothing else.
- Sizes: 13 (notes), 14-15 (body), 20 (panel titles, 800), 22-26 (key numbers, 800, letter-spacing -0.4px).

## Colour tokens
| Token | Light | Dark |
|---|---|---|
| map background | #ECEDEF | #141517 |
| water | #D5E1EA | #1A2530 |
| park | #DFE8DD | #18221B |
| main road | #FFFFFF | #2A2C30 |
| minor road | #F6F6F7 | #202225 |
| map label | #80848B | #7C8088 |
| glass panel | rgba(255,255,255,0.74) + blur 22px saturate 170% | rgba(30,31,34,0.72) + same blur |
| glass border | rgba(255,255,255,0.75) | rgba(255,255,255,0.08) |
| panel shadow | 0 1px 2px rgba(24,25,28,.06), 0 12px 32px rgba(24,25,28,.10) | 0 1px 2px rgba(0,0,0,.4), 0 16px 40px rgba(0,0,0,.45) |
| text | #18191C | #F1EFEA |
| muted text | #5E6168 | #A2A5AB |
| line / border | rgba(24,25,28,0.12) | rgba(255,255,255,0.14) |
| chip / subtle fill | rgba(24,25,28,0.05) | rgba(255,255,255,0.07) |
| **amber (brand, primary buttons)** | #F2A42B with text #1C1408 | #FFB547 with text #1C1408 |
| amber text | #8F5400 | #FFC46B |
| amber tint | #FCEBCB | rgba(255,181,71,0.16) |
| status good (on schedule) | #1F9D6B | #3BC48A |
| status watch (needs watching) | #7C5CE0 | #9C82FF |
| status act (act now) | #D93A3A | #FF5C5C |

Amber is the brand, so "needs watching" is violet, never amber.

## Vehicles on the map
- Soft 3D top-down icons (exact SVG symbols `truck` and `van` in the reference file). Keep them as they are.
- Colours: diesel truck #2E3035 (dark mode #5C616B), diesel van #F7F7F5, electric truck amber, electric van #F6D49A.
- Each icon rotates to its real heading and glides smoothly between GPS updates (interpolate position and heading).
- Status = soft halo under the icon (good / watch / act colours at ~15% fill). Act now = gentle red pulse.
- Moving vehicles leave a short fading amber trail behind them.
- Selecting a vehicle draws its route in amber (animated stroke, ~1.6 s).

## Layout of the control centre
- Full-screen map (MapLibre; OpenFreeMap or TomTom tiles styled with the map tokens above).
- Top bar (glass, 22px radius): logo, search/command bar with Ctrl K, 4 key numbers, light/dark toggle, avatar.
- Left panel "Needs you" (360px): only decisions for a human; one clear button each.
- Right panel "Your AI team" (320px): Atlas (lead, amber avatar), Dina, Max, Ruta, Leo, each with a live one-line status; animated dots while working.
- Bottom sheet (Bolt-style, 26px radius, grab handle) for the selected vehicle: icon, plate, badges (Recommended, Arrives on time), driver, distance, hours left, ETA vs deadline, buttons; one full-width amber primary action.
- Phone width: panels stack under the map.

## Components
- Radius: 22-26 panels, 14-16 rows and buttons, 999 pills. Buttons at least 44px tall.
- One amber primary button per panel. Secondary buttons use the chip fill.
- Badges: soft tint background + darker text of the same hue, sentence case.
- Copy: sentence case, plain verbs ("Send LV-T03 to collect the load"), no ALL CAPS labels.
