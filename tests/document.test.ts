import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DiagramDocumentError,
    type DiagramDocumentInput,
    cloneDiagramDocument,
    createDiagramDocument,
    parseDiagramDocument,
    serializeDiagramDocument,
} from '../src/core/document';
import { DIAGRAM_DOCUMENT_VERSION, type JsonObject } from '../src/core/model';
import { DiagramNode, Port } from '../src/diagram/types';
import {
    type DiagramRuntimeState,
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
    runtimeA.nodes.node.errors.runtime = { kind: 'runtime', message: 'Failed', pulse: 1 };
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

test('host-built documents report malformed elements with a path, like parsed ones do', () => {
    // The casts are the point: DiagramDocumentInput is a structural interface, so
    // a JavaScript host or a `JSON.parse(...) as DiagramDocumentInput` supplies
    // whatever it likes. A raw TypeError with no JSON path is not a usable answer.
    const create = (input: unknown) => () => createDiagramDocument(input as DiagramDocumentInput);

    assert.throws(create({ nodes: [null] }), (error: unknown) =>
        error instanceof DiagramDocumentError && error.path === '$.nodes[0]');
    assert.throws(create({ nodes: [{ id: 'a', name: 'A' }], links: [null] }), (error: unknown) =>
        error instanceof DiagramDocumentError && error.path === '$.links[0]');
    assert.throws(create({ nodes: 'not an array' }), (error: unknown) =>
        error instanceof DiagramDocumentError && error.path === '$.nodes');
    assert.throws(create({ nodes: [{ id: 'a', name: 'A', inPorts: {} }] }), (error: unknown) =>
        error instanceof DiagramDocumentError && error.path === '$.nodes[0].inPorts');
    assert.throws(create({ nodes: [{ id: 'a', name: 'A' }], links: [{ from: null, to: null }] }), (error: unknown) =>
        error instanceof DiagramDocumentError && error.path === '$.links[0].from');

    // A hole is not an object either, and map() would skip it into the result.
    assert.throws(create({ nodes: new Array(2) }), (error: unknown) =>
        error instanceof DiagramDocumentError && error.path === '$.nodes[0]');
    assert.throws(create({ nodes: [{ id: 'a', name: 'A' }], links: new Array(2) }), (error: unknown) =>
        error instanceof DiagramDocumentError && error.path === '$.links[0]');
});

test('the library\'s own node and port instances are accepted as document input', () => {
    // A host builds a scheme out of DiagramNode/Port, not object literals. These
    // are class instances, so a plain-prototype check would reject them -- but
    // metadata still has to be plain JSON, which is a different question.
    const port = new Port({ id: 'out', name: 'Out', type: 'Candle' });
    const node = new DiagramNode({ id: 'a', name: 'A', outPorts: [port] });

    const nodes = [node] as unknown as NonNullable<DiagramDocumentInput['nodes']>;
    const document = createDiagramDocument({ nodes });
    assert.equal(document.nodes[0].id, 'a');
    assert.equal(document.nodes[0].outPorts[0].id, 'out');

    assert.throws(
        () => createDiagramDocument({ metadata: { when: new Date() } as unknown as JsonObject }),
        /expected a JSON value/,
    );
});

test('an absent collection is absent whether it is undefined or null', () => {
    // Every other optional field reads through `?? []`, which treats null as
    // absent; the element collections have to agree.
    for (const input of [
        { nodes: null },
        { nodes: [{ id: 'a', name: 'A' }], links: null },
        { nodes: [{ id: 'a', name: 'A', inPorts: null, parameters: null }] },
    ]) {
        const document = createDiagramDocument(input as unknown as DiagramDocumentInput);
        assert.equal(document.nodes.length, input.nodes === null ? 0 : 1);
    }

    // A non-array that is not null is still a mistake worth reporting.
    assert.throws(
        () => createDiagramDocument({ nodes: 'nope' } as unknown as DiagramDocumentInput),
        (error: unknown) => error instanceof DiagramDocumentError && error.path === '$.nodes',
    );
});

test('a node runtime state without the errors map is tolerated, not a crash', () => {
    // Hosts persist runtime snapshots and build them by hand, and a snapshot
    // written before errors existed has no such field. Reading one must not throw.
    const legacy = {
        activeNodeId: null,
        globalError: null,
        nodes: { n1: { active: true, ports: { in: {}, out: {} } } },
    } as unknown as DiagramRuntimeState;

    const cloned = cloneDiagramRuntimeState(legacy);
    assert.deepEqual(cloned.nodes.n1.errors, {});
    assert.equal(cloned.nodes.n1.active, true);
});

test('an unrecognised port dynamicMode degrades instead of making the document unloadable', () => {
    // A scheme persisted before dynamicMode was a closed set can hold anything a
    // JavaScript host wrote. Refusing to load it would brick the document, and
    // every value other than "onConnect" already behaves identically.
    const source = serializeDiagramDocument(createDiagramDocument({
        nodes: [{ id: 'node', name: 'Node', inPorts: [{ id: 'in', name: 'In' }] }],
    })).replace('"dynamicMode":""', '"dynamicMode":"auto"');

    const document = parseDiagramDocument(source);
    assert.equal(document.nodes[0].inPorts[0].dynamicMode, '');

    // And what it accepts, it can serialize again.
    assert.deepEqual(parseDiagramDocument(serializeDiagramDocument(document)), document);

    // The known values still survive unchanged.
    for (const dynamicMode of ['', 'manual', 'onConnect'] as const) {
        const kept = createDiagramDocument({
            nodes: [{ id: 'node', name: 'Node', inPorts: [{ id: 'in', name: 'In', dynamicMode }] }],
        });
        assert.equal(kept.nodes[0].inPorts[0].dynamicMode, dynamicMode);
    }
});

test('a link keeps the style it was given and defaults to solid', () => {
    const document = createDiagramDocument({
        nodes: [
            { id: 'a', name: 'A', outPorts: [{ id: 'out', name: 'Out' }, { id: 'alt', name: 'Alt' }] },
            { id: 'b', name: 'B', inPorts: [{ id: 'in', name: 'In' }] },
        ],
        links: [
            { from: { nodeId: 'a', portId: 'out' }, to: { nodeId: 'b', portId: 'in' } },
            { from: { nodeId: 'a', portId: 'alt' }, to: { nodeId: 'b', portId: 'in' }, style: 'dashed' },
        ],
    });

    assert.equal(document.links[0].style, 'solid');
    assert.equal(document.links[1].style, 'dashed');
});

test('a link style survives a serialize and parse round trip', () => {
    const document = createDiagramDocument({
        nodes: [
            { id: 'a', name: 'A', outPorts: [{ id: 'out', name: 'Out' }] },
            { id: 'b', name: 'B', inPorts: [{ id: 'in', name: 'In' }] },
        ],
        links: [{ from: { nodeId: 'a', portId: 'out' }, to: { nodeId: 'b', portId: 'in' }, style: 'dashed' }],
    });

    const parsed = parseDiagramDocument(serializeDiagramDocument(document));

    assert.equal(parsed.links[0].style, 'dashed');
});

test('a link style outside the set is rejected', () => {
    assert.throws(() => createDiagramDocument({
        nodes: [
            { id: 'a', name: 'A', outPorts: [{ id: 'out', name: 'Out' }] },
            { id: 'b', name: 'B', inPorts: [{ id: 'in', name: 'In' }] },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        links: [{ from: { nodeId: 'a', portId: 'out' }, to: { nodeId: 'b', portId: 'in' }, style: 'wavy' as any }],
    }), /style/);
});

test('a zone keeps its bounds, name and colour, and defaults what it can', () => {
    const document = createDiagramDocument({
        zones: [
            { id: 'colo', name: 'Колокейшн', x: 10, y: 20, width: 300, height: 200, color: '#d8c79a' },
            { id: 'plain', name: 'Plain', x: 0, y: 0, width: 100, height: 50 },
        ],
    });

    assert.deepEqual(document.zones[0], {
        id: 'colo',
        name: 'Колокейшн',
        x: 10,
        y: 20,
        width: 300,
        height: 200,
        color: '#d8c79a',
        metadata: {},
    });
    assert.equal(document.zones[1].color, '');
});

test('zones survive a serialize and parse round trip', () => {
    const document = createDiagramDocument({
        zones: [{ id: 'colo', name: 'Colo', x: 5, y: 6, width: 70, height: 80, color: '#abcdef' }],
    });

    assert.deepEqual(parseDiagramDocument(serializeDiagramDocument(document)).zones, document.zones);
});

test('a document without zones still parses, and reports none', () => {
    const parsed = parseDiagramDocument(serializeDiagramDocument(createDiagramDocument({})));

    assert.deepEqual(parsed.zones, []);
});

test('a zone with a negative size is rejected', () => {
    assert.throws(
        () => createDiagramDocument({ zones: [{ id: 'z', name: 'Z', x: 0, y: 0, width: -1, height: 10 }] }),
        /width/,
    );
});

test('two zones cannot share an id', () => {
    assert.throws(() => createDiagramDocument({
        zones: [
            { id: 'z', name: 'One', x: 0, y: 0, width: 10, height: 10 },
            { id: 'z', name: 'Two', x: 0, y: 0, width: 10, height: 10 },
        ],
    }), /duplicate zone id/);
});
