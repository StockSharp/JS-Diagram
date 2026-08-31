import assert from 'node:assert/strict';
import test from 'node:test';

import { readableOutlineOn } from '../src/color';

/// What a socket's outline has to do is separate it from the canvas, and the canvas is the one
/// thing every socket on screen shares -- so the outline is measured against it. Picking per
/// socket fill instead would edge two neighbours differently and read as a mistake.

const DARK = '#3a3d45';
const LIGHT = '#c8ccd4';

test('a dark canvas takes the light outline', () => {
    assert.equal(readableOutlineOn('#0b0e11'), LIGHT, 'the designer canvas');
    assert.equal(readableOutlineOn('#1b1b1f'), LIGHT, 'the control default');
    assert.equal(readableOutlineOn('#000000'), LIGHT);
});

test('a light canvas takes the dark outline', () => {
    assert.equal(readableOutlineOn('#ffffff'), DARK);
    assert.equal(readableOutlineOn('#f5f7fa'), DARK, 'the light theme canvas');
    assert.equal(readableOutlineOn('#dcdcdc'), DARK);
});

test('the shorthand and rgb spellings are understood', () => {
    assert.equal(readableOutlineOn('#000'), LIGHT);
    assert.equal(readableOutlineOn('#fff'), DARK);
    assert.equal(readableOutlineOn('rgb(11, 14, 17)'), LIGHT);
});

test('a canvas it cannot read keeps the dark outline', () => {
    // The canvas shipped so far is dark, so a light outline is the likelier guess -- but a light
    // outline on a light canvas disappears, while a dark one on a dark canvas only looks thin.
    assert.equal(readableOutlineOn(''), DARK);
    assert.equal(readableOutlineOn('var(--diagram-bg)'), DARK);
});
