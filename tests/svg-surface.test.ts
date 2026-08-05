import assert from 'node:assert/strict';
import test from 'node:test';

import { SvgSurface } from '../src/svg-surface';

/**
 * The surface exists so the renderer can draw vector output without a second renderer. What it has
 * to get right is the translation of canvas semantics into SVG -- and the parts that decide whether
 * a diagram looks correct are the two arc calls: arcTo rounds every node corner, arc draws every
 * port. Those are what these tests pin down, along with the state handling around them.
 */

function surface(width = 100, height = 100): SvgSurface {
    return new SvgSurface({ width, height });
}

function pathOf(svg: string): string {
    const match = /<path d="([^"]+)"/.exec(svg);
    assert.ok(match !== null, `no path in: ${svg}`);
    return match[1];
}

test('a document carries its size, its viewBox and an optional background', () => {
    const plain = surface(320, 180).toSvg();
    assert.match(plain, /width="320"/);
    assert.match(plain, /height="180"/);
    assert.match(plain, /viewBox="0 0 320 180"/);
    assert.doesNotMatch(plain, /<rect width="100%"/, 'no background was asked for');

    const filled = new SvgSurface({ width: 10, height: 10, background: '#123456' }).toSvg();
    assert.match(filled, /<rect width="100%" height="100%" fill="#123456"\/>/);
});

test('a rounded corner becomes a real arc, not a mitre', () => {
    // The shape roundRect draws: from the top edge, turn down the right-hand side with radius 4.
    const s = surface();
    s.beginPath();
    s.moveTo(10, 0);
    s.lineTo(20, 0);
    s.arcTo(30, 0, 30, 10, 4);
    s.stroke();

    const d = pathOf(s.toSvg());

    // Straight to the tangent point 4 short of the corner, then a quarter turn to 4 past it.
    assert.match(d, /L26 0/, `expected a line to the tangent point, got: ${d}`);
    assert.match(d, /A4 4 0 0 1 30 4/, `expected a clockwise quarter arc, got: ${d}`);
});

test('arcTo degenerates to a line when there is no corner to round', () => {
    const collinear = surface();
    collinear.beginPath();
    collinear.moveTo(0, 0);
    collinear.arcTo(10, 0, 20, 0, 5);   // straight through
    collinear.stroke();
    assert.match(pathOf(collinear.toSvg()), /^M0 0 L10 0$/);

    const noRadius = surface();
    noRadius.beginPath();
    noRadius.moveTo(0, 0);
    noRadius.arcTo(10, 0, 10, 10, 0);
    noRadius.stroke();
    assert.match(pathOf(noRadius.toSvg()), /^M0 0 L10 0$/);
});

test('a full circle is drawn as two arcs, because one cannot close on itself', () => {
    const s = surface();
    s.beginPath();
    s.arc(50, 50, 6, 0, Math.PI * 2);
    s.fill();

    const d = pathOf(s.toSvg());
    const arcs = d.match(/A6 6 /g) ?? [];

    assert.equal(arcs.length, 2, `a circle needs two arc segments, got: ${d}`);
    assert.match(d, /^M56 50/, `the circle starts at angle 0, got: ${d}`);
});

test('a half turn is one arc, and direction follows the counter-clockwise flag', () => {
    const cw = surface();
    cw.beginPath();
    cw.arc(0, 0, 10, 0, Math.PI);
    cw.stroke();
    assert.match(pathOf(cw.toSvg()), /A10 10 0 0 1 -10 0/);

    const ccw = surface();
    ccw.beginPath();
    ccw.arc(0, 0, 10, 0, Math.PI, true);
    ccw.stroke();
    assert.match(pathOf(ccw.toSvg()), /A10 10 0 0 0 -10 0/);
});

test('arc joins an open subpath with a straight segment, as canvas does', () => {
    const s = surface();
    s.beginPath();
    s.moveTo(0, 0);
    s.arc(20, 0, 5, 0, Math.PI / 2);
    s.stroke();

    assert.match(pathOf(s.toSvg()), /^M0 0 L25 0 A5 5/, 'the leading line to the arc start is missing');
});

test('stroke and fill carry the current style, and dashes survive', () => {
    const s = surface();
    s.strokeStyle = '#ff0000';
    s.lineWidth = 2.5;
    s.lineCap = 'round';
    s.setLineDash([4, 2]);
    s.beginPath();
    s.moveTo(0, 0);
    s.lineTo(10, 10);
    s.stroke();

    const svg = s.toSvg();
    assert.match(svg, /stroke="#ff0000"/);
    assert.match(svg, /stroke-width="2.5"/);
    assert.match(svg, /stroke-linecap="round"/);
    assert.match(svg, /stroke-dasharray="4 2"/);
    assert.match(svg, /fill="none"/, 'a stroked path must not be filled');
});

test('save and restore unwind style, dash and transform together', () => {
    const s = surface();
    s.fillStyle = '#111111';
    s.save();
    s.fillStyle = '#222222';
    s.setLineDash([1, 1]);
    s.translate(5, 5);
    s.restore();

    s.fillRect(0, 0, 1, 1);

    const svg = s.toSvg();
    assert.match(svg, /fill="#111111"/, 'the fill colour did not come back');
    assert.doesNotMatch(svg, /transform=/, 'the transform did not come back');
});

test('a transform is baked into the element rather than left to nesting', () => {
    const s = surface();
    s.setTransform(2, 0, 0, 2, 10, 20);
    s.fillRect(0, 0, 5, 5);

    assert.match(s.toSvg(), /<rect x="0" y="0" width="5" height="5" fill="[^"]*" transform="matrix\(2 0 0 2 10 20\)"\/>/);
});

test('alpha becomes opacity, and only when it is not opaque', () => {
    const opaque = surface();
    opaque.fillRect(0, 0, 1, 1);
    assert.doesNotMatch(opaque.toSvg(), /opacity=/);

    const faded = surface();
    faded.globalAlpha = 0.5;
    faded.fillRect(0, 0, 1, 1);
    assert.match(faded.toSvg(), /opacity="0.5"/);
});

test('text keeps the canvas font string and maps alignment to SVG', () => {
    const s = surface();
    s.font = '600 12px Inter, sans-serif';
    s.textAlign = 'center';
    s.textBaseline = 'middle';
    s.fillStyle = '#eeeeee';
    s.fillText('GateMD', 40, 20);

    const svg = s.toSvg();
    assert.match(svg, /style="font:600 12px Inter, sans-serif"/);
    assert.match(svg, /text-anchor="middle"/);
    assert.match(svg, /dominant-baseline="central"/);
    assert.match(svg, />GateMD<\/text>/);
});

test('markup in a label cannot escape into the document', () => {
    const s = surface();
    s.fillText('<script>&"x"', 0, 0);

    const svg = s.toSvg();
    assert.match(svg, /&lt;script&gt;&amp;&quot;x&quot;/);
    assert.doesNotMatch(svg, /<script>/);
});

test('an empty path emits nothing at all', () => {
    const s = surface();
    s.beginPath();
    s.stroke();
    s.fill();

    assert.doesNotMatch(s.toSvg(), /<path/);
});

test('clearRect is a no-op, because a document is built up rather than painted over', () => {
    const s = surface();
    s.fillRect(0, 0, 10, 10);
    s.clearRect(0, 0, 10, 10);

    assert.equal((s.toSvg().match(/<rect /g) ?? []).length, 1, 'clearRect must not add or remove anything');
});

test('measureText falls back to an estimate rather than zero when no context is available', () => {
    const s = surface();
    s.font = '12px sans-serif';

    const width = s.measureText('GateMD').width;
    assert.ok(width > 0, 'a zero width would stack every label at one point');
});
