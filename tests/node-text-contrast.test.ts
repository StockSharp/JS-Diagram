import assert from 'node:assert/strict';
import test from 'node:test';

import { readableTextOn } from '../src/color';

/// A node's fill comes from the scheme, not from the theme, so it can be
/// anything. The title drawn on it has to stay legible either way — a fixed
/// dark title vanishes the moment a node is filled dark.
test('a light body keeps a dark title', () => {
    assert.equal(readableTextOn('#d7d7d7'), '#1b1b1b');
    assert.equal(readableTextOn('#ffffff'), '#1b1b1b');
    assert.equal(readableTextOn('#ff4d18'), '#1b1b1b');
});

test('a dark body gets a light title', () => {
    assert.equal(readableTextOn('#0b0e11'), '#f5f5f5');
    assert.equal(readableTextOn('#1b1b1f'), '#f5f5f5');
    assert.equal(readableTextOn('#2b3139'), '#f5f5f5');
});

test('the shorthand and rgb spellings are understood', () => {
    assert.equal(readableTextOn('#fff'), '#1b1b1b');
    assert.equal(readableTextOn('#000'), '#f5f5f5');
    assert.equal(readableTextOn('rgb(11, 14, 17)'), '#f5f5f5');
    assert.equal(readableTextOn('rgba(255, 255, 255, 0.9)'), '#1b1b1b');
});

test('a colour it cannot read keeps the title dark', () => {
    // Unreadable is not a reason to flip: every node shipped so far is light,
    // and guessing light text on them would be the worse failure.
    assert.equal(readableTextOn(''), '#1b1b1b');
    assert.equal(readableTextOn('var(--node-fill)'), '#1b1b1b');
});
