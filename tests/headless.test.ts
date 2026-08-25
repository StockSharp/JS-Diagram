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
