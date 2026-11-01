# typesilk design

The material is a printed page: ink on paper, set large, with one colour for what
matters. Tokens live in [`src/tokens.css`](src/tokens.css), and `/design` on the live
site shows every token and component in every theme, rendered by the app's own code.

## Principles

1. **Type is the interface.** The test is set at headline size. Hierarchy comes from
   size and weight; figures are lining and tabular so numbers don't jitter.
2. **One colour for what matters.** `--accent` marks the caret, mistakes, records and
   the selected item. Nothing decorative gets colour.
3. **Hairlines between things.** Rows and sections are split by 1 px rules. Only overlays
   (command palette, text editor) get a surface and a shadow.
4. **Everything that moves, moves on a spring.** Moving things retarget one spring
   instead of starting a new animation, so speed carries over between keystrokes.
   Colour and hover changes fade quickly; nothing loops while you type.
5. **Numbers are measured.** Every figure comes from your keystrokes. No estimates, no
   decoration that looks like data.

## Colour

Six roles per theme (noir, paper, forest, klein). Contrast against `--bg`:

| Token | Use | noir | paper | forest | klein |
| --- | --- | --- | --- | --- | --- |
| `--ink` | typed text, primary text, values | 16.9 | 15.6 | 14.7 | 8.5 |
| `--muted` | secondary text, labels, the active word | 7.2 | 4.9 | 7.3 | 6.2 |
| `--dim` | untyped text, large quiet text | 3.6 | 3.2 | 4.2 | 3.6 |
| `--rule` | hairlines, never text | 1.3 | 1.3 | 1.3 | 1.4 |
| `--accent` | caret, mistakes, records, selection | 5.9 | 4.1 | 9.5 | 6.7 |

Text below 24 px uses `--muted` or `--ink`. `--dim` only works for the large test text
and placeholders, where 3:1 is enough.

## Type

- **Newsreader** (variable, optical sizes) for everything by default; **JetBrains Mono**
  as the alternative the reader can pick. `--face` switches both.
- Italic marks labels, captions and asides, never emphasis inside a sentence.
- Sizes: `--text-small` 0.86rem, `--text-label` 0.92rem, `--text-body` 1rem,
  `--text-lead` 1.5rem, `--text-title` 1.9rem; display sizes scale with the viewport.

## Space

`--space-1` 6 px, `--space-2` 14 px, `--space-3` 26 px, `--space-4` 44 px, and
`--edge` for the page margin, which grows with the window.

## Motion

| Token | What it is | Use |
| --- | --- | --- |
| `--spring` | stiffness 170, damping 22 | views, panels, anything that arrives |
| `--spring-snappy` | stiffness 300, damping 26 | underlines, highlights, things that follow |
| `--fast` | 160 ms | colour and hover changes |
| `--fade` | 280 ms | overlays fading in and out |
| `--theme` | 500 ms | switching themes |

Both springs are simulated in `src/spring.ts` and handed to CSS as `linear()` curves, so
CSS transitions, WAAPI and the per-frame springs in `src/stage.ts` all share the same
physics. `prefers-reduced-motion` turns movement off.

## Components

| Component | Where | Notes |
| --- | --- | --- |
| Segment | `src/ui.ts` | a row of words with an accent underline that slides on `--spring-snappy` |
| Toggle word | `src/ui.ts` | italic word, underlined in accent when on |
| Settings row | `src/ui.ts` | label, italic note, control on the right, hairline below |
| Stat row | results, profile | muted label left, tabular value right |
| Command palette | `src/palette.ts` | the one overlay with a surface; highlight slides between rows |
| Key heatmap | `src/heatmap.ts` | keyboard in the language's layout, accent strength = miss rate |
| Activity grid | `src/profile-view.ts` | 53 weeks × 7 days, four accent steps from the year's own quartiles |
| Result card | `src/card.ts` | 1200 × 630 canvas drawn from the live tokens |

## Don't

- No gradients, glows or shadows on content.
- No second accent colour, and no colour without meaning.
- No boxes around sections; use a hairline.
- No animation that runs on its own while someone is typing.
