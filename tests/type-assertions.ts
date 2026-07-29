// Compile-time tests. There is nothing to execute here: each @ts-expect-error
// asserts that a misuse of the public API is REJECTED, and TypeScript reports an
// unused directive if the error it expects ever disappears. This file is checked
// by `npm run typecheck` (tsconfig.test.json) and deliberately does not match the
// tests/*.test.ts glob that the runtime suite is bundled from.
import type { StockSharpCatalog } from '../src/diagram/catalog';
import type { StockSharpPalette } from '../src/diagram/palette';
import type { StockSharpDiagram } from '../src/diagram/stocksharp-diagram';
import { Port } from '../src/diagram/types';

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

// --- dynamicMode is a closed set --------------------------------------------
// The renderer compares it with ===, so a value outside the set silently means
// "do nothing" rather than "grow a sibling on connect".
new Port({ id: 'p', name: 'P', isDynamic: true, dynamicMode: 'onConnect' });
new Port({ id: 'p', name: 'P', dynamicMode: 'manual' });
new Port({ id: 'p', name: 'P', dynamicMode: '' });
// @ts-expect-error - wrong case
new Port({ id: 'p', name: 'P', isDynamic: true, dynamicMode: 'onconnect' });
// @ts-expect-error - not a mode at all
new Port({ id: 'p', name: 'P', dynamicMode: 'whatever you like' });

// --- state snapshots are read-only ------------------------------------------
// These getters return detached copies, so a mutation is silently discarded.
// The type has to say so rather than inviting a read-modify-write that no-ops.
// @ts-expect-error - the selection snapshot is not a way to change the selection
diagram.getSelection().nodeIds.push('node');
// @ts-expect-error - nor is it assignable field by field
diagram.getSelection().primaryNodeId = 'node';
// @ts-expect-error - the runtime snapshot is not a way to activate a node
diagram.getRuntimeState().activeNodeId = 'node';
// @ts-expect-error - the view snapshot is not a way to zoom
diagram.getViewState().zoom = 2;
// @ts-expect-error - permissions change through setInteractionPermissions
diagram.getInteractionPermissions().paste = false;

// Round-tripping a snapshot back through its setter still has to compile.
diagram.setRuntimeState(diagram.getRuntimeState());
diagram.setViewState(diagram.getViewState());
diagram.setInteractionPermissions(diagram.getInteractionPermissions());
diagram.setFullscreenLabels(diagram.getFullscreenLabels());

// The snapshot has to be read-only all the way down, including through optional
// object properties -- the node error slots are exactly that shape.
// @ts-expect-error - an optional nested object is still part of the snapshot
diagram.getRuntimeState().nodes.n1.errors.runtime!.message = 'deep write';
// @ts-expect-error - a Record nested in a Record is too
diagram.getRuntimeState().nodes.n1.ports.in.p1.value = 'deep write';
// @ts-expect-error - and a nullable one
diagram.getRuntimeState().globalError!.message = 'deep write';

// Event payloads carry the same detached copies the getters return, so they are
// snapshots too -- otherwise the read-only rule stops at the first subscriber.
diagram.on('selectionChanged', (selection) => {
    // @ts-expect-error - the payload is a snapshot, not a way to change the selection
    selection.nodeIds.push('node');
});
diagram.on('runtimeStateChanged', ({ state }) => {
    // @ts-expect-error - nor a way to activate a node
    state.activeNodeId = 'node';
});
diagram.on('viewChanged', (view) => {
    // @ts-expect-error - nor a way to zoom
    view.zoom = 2;
});
