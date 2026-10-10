# Bright flat

> Bold, flat and clear, like a modern children's app: strong solid colours, simple geometric
> shapes, no gradients and no shadows.

## Atmosphere

Cheerful and easy to read at a glance. Every object is a few flat shapes in solid colour, so the
scene stays clear on a small screen.

## Colour

Use the tokens in `look.css`, never raw colours for the main roles:

- **Sky** `--look-sky`; **sea** `--look-water`; **ground** `--look-ground`.
- **Foliage** `--look-leaf`, **wood and trunks** `--look-wood`.
- **The hero object** takes `--look-hero`; **a second focus**, if the scene needs one,
  `--look-accent`.
- **Glow** is a flat ring of `--look-glow` behind the hero, not a blur.
- **Text** `--look-ink` on `--look-paper`.

No gradients and no drop shadows: depth comes from overlapping flat shapes and darker tints of
the same colour.

## Shapes

Circles, rectangles and simple polygons with crisp edges; radius 8px at most. Objects sit on the
ground line exactly.

## Text

`--look-font`, bold, at least 32px, sentence case.

## Motion

Snappy and clear: entrances 0.4–0.5 s with `power3.out`, pops with `back.out(1.7)` for playful
beats only, everything settling to a still picture.
