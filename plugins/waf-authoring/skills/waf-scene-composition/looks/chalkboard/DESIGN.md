# Chalkboard

> Drawn in chalk on a classroom board: a dark green board, soft chalk lines and chalk colours,
> for scenes that feel like a teacher sketching.

## Atmosphere

Friendly and familiar from the classroom. The board fills the stage; everything is drawn on it
with chalk-like strokes rather than filled solids.

## Colour

Use the tokens in `look.css`, never raw colours for the main roles:

- **Board** `--look-board` fills the stage, with a `--look-frame` wooden frame 16px wide.
- **Chalk** `--look-chalk` for outlines and most drawing; coloured chalks `--look-chalk-yellow`,
  `--look-chalk-blue`, `--look-chalk-pink` and `--look-chalk-green` for fills and accents.
- **The hero object** is drawn in `--look-chalk-yellow`; one hero per scene.
- **Text** `--look-chalk`, which stands out from the board.

## Shapes

SVG strokes 4–6px wide with `stroke-linecap: round`, slightly irregular (draw paths, not perfect
rectangles). Fills are light, around 35% opacity, like rubbed chalk. Objects stand on a chalk
ground line.

## Text

`--look-font`, at least 34px, sentence case, as if handwritten.

## Motion

Things appear as if being drawn: reveal strokes with `strokeDashoffset` from their length to 0
over 0.8–1.2 s with `power1.inOut`, then fade fills in. Settle to a still picture.
