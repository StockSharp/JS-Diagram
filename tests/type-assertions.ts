// Compile-time tests. There is nothing to execute here: each @ts-expect-error
// asserts that a misuse of the public API is REJECTED, and TypeScript reports an
// unused directive if the error it expects ever disappears. This file is checked
// by `npm run typecheck` (tsconfig.test.json) and deliberately does not match the
// tests/*.test.ts glob that the runtime suite is bundled from.
import type { StockSharpCatalog } from '../src/diagram/catalog';
import type { StockSharpPalette } from '../src/diagram/palette';
import type { StockSharpDiagram } from '../src/diagram/stocksharp-diagram';

declare const diagram: StockSharpDiagram;
declare const catalog: StockSharpCatalog;
declare const palette: StockSharpPalette;

// --- event names are a closed set -------------------------------------------
// A subscription to a name that does not exist can never fire, so it has to be a
// compile error rather than a silent no-op.

// @ts-expect-error - misspelled event name
diagram.on('zoomChangedd', () => undefined);
// @ts-expect-error - wrong case
diagram.on('nodeadded', () => undefined);
// @ts-expect-error - not a name at all
diagram.on(123, () => undefined);
// @ts-expect-error - misspelled event name
diagram.off('nodeAdd', () => undefined);
// @ts-expect-error - misspelled event name
catalog.on('portTypesChangd', () => undefined);
// @ts-expect-error - misspelled event name
palette.on('nodeActivatd', () => undefined);

// Real names stay usable, and their payloads keep their types.
diagram.on('nodeAdded', (payload) => payload.nodes.length);
diagram.on('zoomChanged', (payload) => payload.zoom.toFixed(2));
catalog.on('portTypesChanged', (payload) => payload.length);
palette.on('nodeActivated', (payload) => payload.node.name.length);

// @ts-expect-error - payload of a known event is typed, not unknown
diagram.on('nodeAdded', (payload: { nope: string }) => payload.nope);
