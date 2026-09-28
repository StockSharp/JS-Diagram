import assert from 'node:assert/strict';
import test from 'node:test';

import { createDiagramDocument } from '../src/core/document';
import { renderDiagramSvg } from '../src/headless';

/**
 * Drawing a diagram where there is no browser. The picture is what a server has to hand to a chat, an
 * e-mail or a report, and none of those can run the control -- so the same renderer has to work with
 * nothing underneath it.
 */

/** Whether the process had a DOM before anything was drawn -- captured before the first render. */
const CLEAN = !('document' in globalThis);

const document = createDiagramDocument({
    nodes: [
        { id: 'source', typeId: 'candles', name: 'Candles', x: 10, y: 20, outPorts: [{ id: 'out', name: 'Value', type: 'number' }] },
        { id: 'sink', typeId: 'order', name: 'Order', x: 300, y: 20, inPorts: [{ id: 'in', name: 'Value', type: 'number' }] },
    ],
    links: [{ id: 'l1', from: { nodeId: 'source', portId: 'out' }, to: { nodeId: 'sink', portId: 'in' } }],
});

test('a document becomes an svg with no browser present', () => {
    const svg = renderDiagramSvg(document);

    assert.match(svg, /^<svg\b/);
    assert.match(svg, /<\/svg>$/);

    // The picture carries what the document said, not an empty frame.
    assert.match(svg, /Candles/);
    assert.match(svg, /Order/);
});

test('the drawing leaves no globals behind', () => {
    // Measured against the state this process started in, not against the state the previous test left:
    // a renderer that squats on globalThis would otherwise hide behind its own leak.
    assert.ok(CLEAN, 'this test only says something in a process that has no DOM of its own');

    renderDiagramSvg(document);

    assert.equal('document' in globalThis, false, 'the stubs outlived the drawing they were for');
});

test('an engine without a clock still draws', () => {
    // An embedded engine -- the kind a server runs JS in -- has no performance.now(). The drawing reads it
    // to advance animation, and a still picture has none to advance.
    const clock = (globalThis as { performance?: unknown }).performance;
    delete (globalThis as { performance?: unknown }).performance;

    try {
        assert.match(renderDiagramSvg(document), /Candles/);
    } finally {
        (globalThis as { performance?: unknown }).performance = clock;
    }
});

test('a string document is accepted as it arrives from the wire', () => {
    const svg = renderDiagramSvg(JSON.stringify(document));

    assert.match(svg, /Candles/);
});

test('the frame follows the content and the caller can pad it', () => {
    const tight = renderDiagramSvg(document, { padding: 0 });
    const padded = renderDiagramSvg(document, { padding: 80 });

    const width = (svg: string): number => Number(/width="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? '0');

    assert.ok(width(tight) > 0, 'a diagram with two nodes cannot be zero wide');
    assert.ok(width(padded) > width(tight), 'padding has to reach the frame');
});

// An architecture drawing rendered on a server has to carry the same second lines, labels and zones as
// the one on the page.
test('a subtitle, a link label and a zone all reach the headless picture', () => {
    const drawing = createDiagramDocument({
        nodes: [
            { id: 'gate', name: 'Gateway', subtitle: 'FIX / REST', x: 0, y: 0, outPorts: [{ id: 'out', name: 'Out' }] },
            { id: 'core', name: 'Matching', x: 400, y: 0, inPorts: [{ id: 'in', name: 'In' }] },
        ],
        links: [{ from: { nodeId: 'gate', portId: 'out' }, to: { nodeId: 'core', portId: 'in' }, label: 'SBE' }],
        zones: [{ id: 'colo', name: 'Colocation', x: -300, y: -200, width: 1200, height: 600 }],
    });

    const svg = renderDiagramSvg(drawing, { padding: 0 });
    assert.match(svg, />FIX \/ REST<\/text>/);
    assert.match(svg, />SBE<\/text>/);
    assert.match(svg, />Colocation<\/text>/);

    const width = Number(/<svg[^>]*width="([\d.]+)"/.exec(svg)?.[1]);
    const height = Number(/<svg[^>]*height="([\d.]+)"/.exec(svg)?.[1]);
    assert.ok(width >= 1200 && height >= 600, `the frame is ${width}x${height} and cuts the zone off`);
});

test('a subtitle makes the node, and so the picture, taller', () => {
    const plain = renderDiagramSvg(createDiagramDocument({ nodes: [{ id: 'a', name: 'A' }] }), { padding: 0 });
    const titled = renderDiagramSvg(createDiagramDocument({ nodes: [{ id: 'a', name: 'A', subtitle: 'second line' }] }), { padding: 0 });

    const height = (svg: string): number => Number(/<svg[^>]*height="([\d.]+)"/.exec(svg)?.[1] ?? '0');
    assert.ok(height(titled) > height(plain), `${height(titled)} is not taller than ${height(plain)}`);
});
