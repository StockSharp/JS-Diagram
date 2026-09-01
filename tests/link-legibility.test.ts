import assert from 'node:assert/strict';
import test from 'node:test';

import { cappedLightness, legibleOn } from '../src/color';

/// A socket type's colour is the host's: StockSharp sends #000000 for Any and near-white for
/// Side. Drawn as a wire it has to be seen against the canvas, and a canvas is either end of
/// the range too — so the colour is moved into the band the canvas leaves room for, keeping
/// its hue.

test('a black type is lifted off a dark canvas', () => {
    const drawn = legibleOn('#000000', '#0b0e11');

    assert.notEqual(drawn.toLowerCase(), '#000000');
    assert.ok(/^hsl/.test(drawn), `expected an hsl colour, got ${drawn}`);
});

test('a near-white type is brought down onto a light canvas', () => {
    const drawn = legibleOn('#f5f5dc', '#f5f7fa');

    assert.ok(/^hsl/.test(drawn), `expected an hsl colour, got ${drawn}`);
    const lightness = Number(/,\s*([\d.]+)%\)$/.exec(drawn)?.[1]);
    assert.ok(lightness <= 45, `still too light for a light canvas: ${drawn}`);
});

test('a colour already in the band is left alone', () => {
    // Nothing to fix means nothing to change: the hue a host chose stays exactly as chosen.
    assert.equal(legibleOn('hsl(202, 72%, 58%)', '#0b0e11'), 'hsl(202, 72%, 58%)');
});

test('a hue survives being moved', () => {
    const drawn = legibleOn('#00008b', '#0b0e11');
    const hue = Number(/^hsl\(([\d.]+)/.exec(drawn)?.[1]);

    assert.ok(Math.abs(hue - 240) < 1, `navy should stay navy, got ${drawn}`);
});

test('a colour it cannot read is passed through untouched', () => {
    assert.equal(legibleOn('var(--wire)', '#0b0e11'), 'var(--wire)');
});

/// The ceiling a light theme sets has to reach the colours the host supplies, which arrive as
/// hex — it used to understand only the hsl() the control invents for unknown types, so a
/// light theme darkened its own hues and left the host's palette untouched.
test('the lightness ceiling reaches a hex colour', () => {
    const capped = cappedLightness('#f5f5dc', 0.42);
    const lightness = Number(/,\s*([\d.]+)%\)$/.exec(capped)?.[1]);

    assert.ok(lightness !== undefined && lightness <= 42, `not capped: ${capped}`);
});

test('a colour already under the ceiling is untouched', () => {
    assert.equal(cappedLightness('hsl(202, 72%, 30%)', 0.42), 'hsl(202, 72%, 30%)');
    assert.equal(cappedLightness('#101010', 0.42), '#101010');
});

test('the ceiling passes through what it cannot read', () => {
    assert.equal(cappedLightness('var(--wire)', 0.42), 'var(--wire)');
});
