# Riwaq's glass material in 0.57 (issue #158)

Issue: https://github.com/ABADIOSA/riwaq/issues/158 (a tester, 2026-11-20; follow-up 2026-11-21 pointing at VyseTV). It asks for glass that looks more real: light gradients, reflections, a balance of transparency and blur, one consistent material, readable text. Flutter, the issue's second request, is assessed in [ISSUE-158-GLASS-FLUTTER.md](ISSUE-158-GLASS-FLUTTER.md) and not adopted.

## 1. Where 0.56.0 stood

One material for everything: `--glass-fill`, an edge, a sheen and a short shadow on buttons, chips, the wheel's discs and the Liquid Glass components. Dialogs used the same sheen over a stronger fill with an 18 px blur, and menus and notices only gained the blur. Three faults:

- **No hierarchy.** A button, a menu and a dialog were the same flat translucent rectangle at different sizes.
- **A dead selector.** `glass.css` blurred `.poster-actions-menu`, a class nothing has. A title's actions menu (right click on a card) never had its glass.
- **A blur per control.** Every row's scroll arrow carried `backdrop-filter: blur(8px)` (`styles.css`, older than the glass work): up to two blurred buttons a row, repainting with every scroll, against CLAUDE.md's performance rule.

## 2. The reference

- **The issue's screenshot** could not be opened from this environment: GitHub's attachment host is outside the session's network policy, as it was in 0.56.0. The issue text and both comments were read in full.
- **VyseTV** (https://gitlab.com/ayman707-ux/vysetv) is a GPL-3.0 Flutter app. Riwaq is MIT, so none of its code, artwork or assets was copied or used. Its public README and its five screenshots (`branding/screenshots/*.webp`) were studied for visual direction only. What they show:
  - near-black surfaces with clear steps between them;
  - a single warm accent used sparingly;
  - hairline-edged pills for chips and filters;
  - a primary action as a bright pill;
  - a filter sheet raised from the page by a deeper surface and a soft shadow;
  - the player's controls gathered in a translucent tray.

  The lesson taken is restraint: depth comes from steps in density and light, not from loud effects. Its look is not reproduced. Riwaq keeps its own identity (arches, khatam, the wheel) and its own palette system.

## 3. The material: three levels

Every value is a token on `.app` in `src/glass.css`. Consumers read tokens; nothing invents its own glass.

| Level | Used by | Fill | Blur | Light | Shadow |
| --- | --- | --- | --- | --- | --- |
| 1. Controls | secondary and danger buttons, choice chips, round tools, row arrows, the wheel's discs, Liquid Glass chips, badges and panels | `--glass-fill` (raised, 74%) | none | dome reflection, top lip, caustic | contact + ambient, 4–14 px |
| 2. Floating | a title's actions menu, prayer times, notices, the wheel's tooltips; the player's menu (kept opaque, below) | `--glass-float-fill` (panel, 90%) | 20 px | top dome measured in px, inner rim | contact + 18–44 px |
| 3. Dialogs | every `Modal` | `--glass-fill-strong` (panel, 90%) | 24 px over the backdrop's own 9 px | broad dome and a wash to 320 px | contact + 30–90 px |

Levels 2 and 3 also carry `--glass-grain`, a tiled noise at a few percent (an inline SVG `feTurbulence`, 160 px). Frosted glass has a grain, and Windows' Acrylic material uses the same idea. The tile is rasterised once; nothing moves.

### Light

Light falls from above and is centred, so it reads the same in Arabic and English and nothing needs mirroring:

- **Lip.** The top edge catches the light: `--glass-lip`, a 1 px inner highlight, brighter on hover (`--glass-lip-strong`).
- **Reflection.** A dome of light from above, with a soft but visible lower edge, ends in the top third of a control, above its text line (`--glass-sheen`). Dialogs and menus measure theirs in pixels, so a tall surface is lit at its head only.
- **Caustic.** A little light gathers at the foot, inside (`--glass-caustic`, a negative-spread inner shadow).
- **Thickness.** A faint shade sits along the foot's edge (`--glass-floor`).
- **Shadow.** It comes in two parts: where the glass touches the page (`--glass-contact`), and the soft light around it (`--glass-ambient`). This reads as elevation without the muddy single shadow 0.56.0 had.
- **Rim.** The rim is quieter than in 0.56.0 (text at 12% instead of 15%), so the lit top edge reads brighter than the sides.

### States

Each one is distinct; `scripts/test-ui-brand-glass.mjs` forces each pseudo-class and compares.

| State | Look |
| --- | --- |
| Rest | The level's light and shadow. |
| Hover | Brighter lip and rim, a 1 px lift, a longer shadow (now on unchosen chips too). |
| Pressed | Scale 0.97, the lip goes out, an inner shadow at the top, the shadow closes in (`--glass-shadow-press`). |
| Chosen | Lit by its own colour: an accent lip, the accent gathered at the foot and a faint accent glow. Written on the element, so a title page's own accent tints it. |
| Focus | The accent ring outside the edge, as before. |

### Over pictures and the video

The showcase's and the theater's buttons keep their dark picture fill (white text at 4.5:1 or more over any picture). They now take the same lip, caustic and two-part shadow.

The player's bar chips (`--bar-chip-shadow`) take the same light.

The player's menu is a floating surface over the video. It stays nearly opaque (`#0f1318f2`) because the HUD's window has no picture under it to blur, and a translucent menu would only let the video show through its words. It takes the level's lit top, inner rim and two-part shadow.

## 4. Fallbacks

| Condition | Result |
| --- | --- |
| Solid (`glass-solid`) | Every level opaque. No reflection, grain or blur. Dialogs and menus keep a plain elevation shadow. |
| Reduced transparency (Windows, browser) | Every level opaque. No reflection, grain or blur. Edges and shadows stay. |
| No `backdrop-filter` | Opaque fills, no blur. |
| Forced colours | System colours, no reflection, grain, shadow or blur. |
| Reduced motion | Unchanged from 0.56.0: the motion tokens go to 0. Nothing new animates; only transform, opacity, shadow and colour transition. |

## 5. Performance

Rules kept:

- No blur on a card, row, button or page surface.
- The row arrows' blur is removed: a denser fill (92%) keeps them readable over posters.
- Blur only on levels 2 and 3, which open on demand.
- No animated blur radius, no pointer-following light, no WebGL, no new dependency.

The measurement used `scripts/measure-ui-glass.mjs`, with v0.56.0 (`ecb397b`) against this branch, builds alternating run by run. The workload was Home with 100 catalogs of 60 titles, one row per catalog (101 rows, 2,444 cards drawn):

- the page scrolled top to bottom at 1,600 px/s, every frame's interval recorded;
- a title's menu and the profiles dialog opened and timed to their first painted frame;
- the renderer heap measured after GC.

Results are in VERIFICATION.md. The environment was headless Chromium on Linux with software compositing: frame times there are not a Windows GPU's.

## 6. Accessibility

Text contrast was measured from pixels by `scripts/fixtures/contrast.mjs`: each element is captured with and without its text, and the 5th percentile over its glyph pixels is kept.

| Surface | Dark | Light |
| --- | --- | --- |
| Secondary button | 13.29 | 17.81 |
| Title menu item | 11.70 | 15.00 |
| Dialog heading | 11.12 | 16.76 |
| Dialog text | 11.60 | 16.62 |

0.56.0's checks in `scripts/test-ui-feedback.mjs` (primary, secondary, choice, chosen, wheel label) still require 4.5:1. The grain and the reflections end above the text line or stay at a few percent.

## 7. Not done

- **Refraction or displacement of the backdrop.** No CSS primitive does it without per-frame SVG filters on every surface.
- **Pointer-tracking or animated highlights.** These cost motion and GPU and need reduced-motion handling.
- **A blur on controls.** Ruled out by the performance rule above.

All three remain possible later, each measured against the 100 × 60 Home first.
