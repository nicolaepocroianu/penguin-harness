# Storybook

> Warm, soft and rounded, like a picture book read aloud: gentle colours, round shapes, a soft
> shadow under everything that stands on the ground.

## Atmosphere

A calm, cosy world for young children. Nothing sharp, nothing harsh. Shapes are round and
slightly plump, edges are soft, and light comes from the top left.

## Colour

Use the tokens in `look.css`, never raw colours for the main roles:

- **Sky** `--look-sky-top` fading to `--look-sky-bottom`; **sea** `--look-water`; **ground**
  `--look-ground`, with `--look-ground-shade` for its lower edge.
- **Foliage** `--look-leaf`, **wood and trunks** `--look-wood`.
- **The hero object** (the one the scene is about) takes `--look-hero`; one hero per scene.
- **Glow and sparkle** `--look-glow`, only around the hero.
- **Text** `--look-ink` on `--look-paper`; outlines `--look-outline` at 3px.

## Shapes

- Rounded rectangles (radius 12–24px) and circles; no sharp corners.
- A soft oval shadow (`--look-shadow`) under every object that stands on the ground.
- Outlines are drawn on objects, not on scenery.

## Text

`--look-font`, at least 32px, sentence case, on a `--look-paper` label with rounded corners when
it sits over a busy picture.

## Motion

Slow and gentle: entrances 0.6–0.8 s with `power2.out`, ambient sway with `sine.inOut` over 3 s
or more. The hero may bounce once, softly (`back.out(1.4)`).
