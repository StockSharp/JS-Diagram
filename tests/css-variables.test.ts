import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCssVariables } from '../src/color';

/// A scheme may name a page token, var(--ss-red), where it would name a colour. A canvas cannot paint
/// that, so the reference is swapped for the token's value before anything is drawn.

const tokens: Record<string, string> = {
    '--ss-red': '#e0301e',
    '--ss-accent': 'var(--ss-red)',
    '--padded': '  #101010  ',
    '--loop-a': 'var(--loop-b)',
    '--loop-b': 'var(--loop-a)',
};
const lookup = (name: string): string => tokens[name] ?? '';

test('a plain colour passes through untouched', () => {
    assert.equal(resolveCssVariables('#123456', lookup), '#123456');
});

test('a reference is replaced by the trimmed token value', () => {
    assert.equal(resolveCssVariables('var(--ss-red)', lookup), '#e0301e');
    assert.equal(resolveCssVariables('var( --padded )', lookup), '#101010');
});

test('a token that names another token is followed', () => {
    assert.equal(resolveCssVariables('var(--ss-accent)', lookup), '#e0301e');
});

test('an unset token takes its fallback, which may itself be a reference', () => {
    assert.equal(resolveCssVariables('var(--missing, #abcdef)', lookup), '#abcdef');
    assert.equal(resolveCssVariables('var(--missing, var(--ss-red))', lookup), '#e0301e');
    assert.equal(resolveCssVariables('var(--missing, rgb(1, 2, 3))', lookup), 'rgb(1, 2, 3)');
});

test('references inside a larger value are all replaced', () => {
    assert.equal(
        resolveCssVariables('color-mix(in srgb, var(--ss-red) 40%, var(--missing, white))', lookup),
        'color-mix(in srgb, #e0301e 40%, white)');
});

test('nothing to fall back on, a cycle or a broken reference yields null', () => {
    assert.equal(resolveCssVariables('var(--missing)', lookup), null);
    assert.equal(resolveCssVariables('var(--loop-a)', lookup), null);
    assert.equal(resolveCssVariables('var(--ss-red', lookup), null);
});
