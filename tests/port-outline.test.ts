import assert from 'node:assert/strict';
import test from 'node:test';

import { createDiagramDocument } from '../src/core/document';
import { renderDiagramSvg } from '../src/headless';

/**
 * A socket is a small square drawn against the canvas, and its fill is the host's -- StockSharp
 * sends #000000 for Any. One fixed outline therefore has to lose at one end: a dark outline
 * around a black socket on a dark canvas leaves nothing to see. The outline follows the canvas,
 * so every socket on a given canvas is edged the same way and none of them disappears into it.
 */

const DARK_OUTLINE = '#3a3d45';
const LIGHT_OUTLINE = '#c8ccd4';

const document = createDiagramDocument({
    nodes: [{
        id: 'n', typeId: 't', name: 'N', x: 10, y: 20,
        outPorts: [{ id: 'out', name: 'V', type: 'number' }],
    }],
    links: [],
});

function outlines(background: string): string[] {
    const svg = renderDiagramSvg(document, { background });
    return [...svg.matchAll(/stroke="([^"]+)"/g)].map((m) => m[1]);
}

test('a dark canvas edges its sockets in light ink', () => {
    const drawn = outlines('#0b0e11');

    assert.ok(drawn.includes(LIGHT_OUTLINE), `no light socket outline in ${JSON.stringify([...new Set(drawn)])}`);
    assert.ok(!drawn.includes(DARK_OUTLINE), 'a dark outline on a dark canvas is the thing being fixed');
});

test('a light canvas edges them in dark ink', () => {
    const drawn = outlines('#ffffff');

    assert.ok(drawn.includes(DARK_OUTLINE), `no dark socket outline in ${JSON.stringify([...new Set(drawn)])}`);
    assert.ok(!drawn.includes(LIGHT_OUTLINE), 'a light outline on a light canvas would vanish');
});
