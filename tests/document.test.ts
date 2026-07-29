import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DiagramDocumentError,
    cloneDiagramDocument,
    createDiagramDocument,
    parseDiagramDocument,
    serializeDiagramDocument,
} from '../src/core/document';
import { DIAGRAM_DOCUMENT_VERSION, type JsonObject } from '../src/core/model';
import {
    cloneDiagramRuntimeState,
    createDiagramNodeRuntimeState,
    createDiagramPortRuntimeState,
    createDiagramRuntimeState,
    createDiagramSelection,
    createDiagramViewState,
} from '../src/core/state';

function createCompleteDocument() {
    return createDiagramDocument({
        metadata: { strategyId: 'strategy-1', flags: ['paper', true] },
        nodes: [{
            id: 'source-1',
            typeId: 'source',
            name: 'Market data',
            description: 'Produces candles',
            groupName: 'Sources',
            x: 12.5,
            y: -8,
            color: '#102030',
            border: '#405060',
            icon: 'source.svg',
            message: 'Persistent host note',
            openAction: 'sourceSettings',
            outPorts: [{
                id: 'candles',
                name: 'Candles',
                description: 'Candle stream',
                type: 'Candle',
                maxLinks: 3,
                availableTypes: ['Candle', 'ICandleMessage'],
                isDynamic: true,
                dynamicMode: 'onConnect',
                isSibling: false,
                metadata: { socketKey: 42 },
            }],
            parameters: [{
                name: 'TimeFrame',
                displayName: 'Time frame',
                description: 'Candle interval',
                type: 'timespan',
                defaultValue: '00:01:00',
                options: ['00:01:00', '00:05:00'],
                min: null,
                max: null,
                displayOrder: 10,
                category: 'General',
                isBasic: true,
                editorType: 'TimeSpanEditor',
            }],
            paramValues: { TimeFrame: '00:05:00' },
            metadata: { hostPayload: { securityId: 'SBER@TQBR' } },
        }, {
            id: 'indicator-1',
            typeId: 'sma',
            name: 'SMA',
            inPorts: [{ id: 'source', name: 'Source', type: 'Candle' }],
        }],
        links: [{
            from: { nodeId: 'source-1', portId: 'candles' },
            to: { nodeId: 'indicator-1', portId: 'source' },
            metadata: { label: 'main feed' },
        }],
    });
}

test('creates a normalized versioned document with stable link identities', () => {
    const document = createCompleteDocument();

    assert.equal(document.version, DIAGRAM_DOCUMENT_VERSION);
    assert.equal(document.links[0].id, 'link_1');
    assert.equal(document.nodes[1].groupName, 'Common');
    assert.equal(document.nodes[1].x, 0);
    assert.deepEqual(document.nodes[1].inPorts[0].availableTypes, []);
    assert.deepEqual(document.nodes[1].metadata, {});
});

test('serializes and parses the complete document without sharing mutable data', () => {
    const original = createCompleteDocument();
    const parsed = parseDiagramDocument(serializeDiagramDocument(original));

    assert.deepEqual(parsed, original);
    parsed.nodes[0].outPorts[0].availableTypes.push('Changed');
    parsed.nodes[0].parameters[0].options.push('Changed');
    parsed.nodes[0].metadata.hostPayload = { changed: true };

    assert.deepEqual(original.nodes[0].outPorts[0].availableTypes, ['Candle', 'ICandleMessage']);
    assert.deepEqual(original.nodes[0].parameters[0].options, ['00:01:00', '00:05:00']);
    assert.deepEqual(original.nodes[0].metadata, { hostPayload: { securityId: 'SBER@TQBR' } });
    assert.deepEqual(cloneDiagramDocument(original), original);
});

test('rejects unsupported, duplicate and dangling document data with a path', () => {
    assert.throws(
        () => parseDiagramDocument({ version: 2, nodes: [], links: [], metadata: {} }),
        (error: unknown) => error instanceof DiagramDocumentError && error.path === '$.version',
    );
    assert.throws(
        () => createDiagramDocument({
            nodes: [{ id: 'same', name: 'One' }, { id: 'same', name: 'Two' }],
        }),
        /duplicate node id/,
    );
    assert.throws(
        () => createDiagramDocument({
            nodes: [{ id: 'source', name: 'Source', outPorts: [{ id: 'out', name: 'Out' }] }],
            links: [{
                from: { nodeId: 'source', portId: 'out' },
                to: { nodeId: 'missing', portId: 'in' },
            }],
        }),
        /unknown target node/,
    );
});

test('rejects non-JSON host metadata instead of corrupting persistence', () => {
    const metadata = { callback: () => undefined } as unknown as JsonObject;
    assert.throws(() => createDiagramDocument({ metadata }), /expected a JSON value/);

    const dateMetadata = { createdAt: new Date() } as unknown as JsonObject;
    assert.throws(() => createDiagramDocument({ metadata: dateMetadata }), /expected a JSON value/);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assert.throws(
        () => createDiagramDocument({ metadata: circular as JsonObject }),
        /circular JSON value/,
    );
});

test('runtime, view and selection state have independent fresh defaults', () => {
    const runtimeA = createDiagramRuntimeState();
    const runtimeB = createDiagramRuntimeState();
    const selectionA = createDiagramSelection();
    const selectionB = createDiagramSelection();

    runtimeA.nodes.node = createDiagramNodeRuntimeState();
    runtimeA.nodes.node.active = true;
    runtimeA.nodes.node.error = { kind: 'runtime', message: 'Failed', pulse: 1 };
    runtimeA.nodes.node.ports.out.value = createDiagramPortRuntimeState();
    selectionA.nodeIds.push('node');

    assert.deepEqual(runtimeB, { activeNodeId: null, nodes: {}, globalError: null });
    assert.deepEqual(selectionB.nodeIds, []);
    assert.deepEqual(createDiagramViewState(), {
        zoom: 1,
        panX: 0,
        panY: 0,
        overviewVisible: true,
    });

    const cloned = cloneDiagramRuntimeState(runtimeA);
    cloned.nodes.node.active = false;
    cloned.nodes.node.ports.out.value.value = 'changed';
    assert.equal(runtimeA.nodes.node.active, true);
    assert.equal(runtimeA.nodes.node.ports.out.value.value, null);
});

test('a "__proto__" key in host JSON stays data and never becomes a prototype', () => {
    const source = JSON.stringify({
        version: DIAGRAM_DOCUMENT_VERSION,
        nodes: [{
            id: 'node-1',
            typeId: 'node',
            name: 'Node',
            description: '',
            groupName: 'Common',
            x: 0,
            y: 0,
            color: '#d7d7d7',
            border: '#8c8c8c',
            icon: '',
            message: '',
            openAction: '',
            inPorts: [],
            outPorts: [],
            parameters: [],
            // Computed keys, not plain "__proto__:" -- in an object literal that
            // form sets the prototype instead of creating the key JSON carries.
            paramValues: { ['__proto__']: 'value' },
            metadata: {},
        }],
        links: [],
        metadata: { ['__proto__']: { injected: true }, keep: 1 },
    });

    const document = parseDiagramDocument(source);

    // The prototype must be untouched and the key must survive as ordinary data.
    assert.equal(Object.getPrototypeOf(document.metadata), Object.prototype);
    assert.equal((document.metadata as { injected?: unknown }).injected, undefined);
    assert.deepEqual(Object.keys(document.metadata).sort(), ['__proto__', 'keep']);
    assert.deepEqual(document.nodes[0].paramValues.__proto__, 'value');

    // Whatever parse accepts, serialize and clone must accept as well.
    const roundTripped = parseDiagramDocument(serializeDiagramDocument(document));
    assert.deepEqual(roundTripped, document);
    assert.deepEqual(cloneDiagramDocument(document), document);
});

test('a nested "__proto__" key is preserved instead of being silently dropped', () => {
    // Written through JSON.parse, not an object literal: in a literal the
    // "__proto__" key sets the prototype, which is exactly what JSON does not do.
    const metadata = JSON.parse('{"inner":{"__proto__":{"x":9},"kept":true}}') as JsonObject;
    const document = createDiagramDocument({ metadata });

    const inner = document.metadata.inner as JsonObject;
    assert.equal(Object.getPrototypeOf(inner), Object.prototype);
    assert.deepEqual(Object.keys(inner).sort(), ['__proto__', 'kept']);
    assert.deepEqual(parseDiagramDocument(serializeDiagramDocument(document)), document);
});
