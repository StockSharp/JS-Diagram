import assert from 'node:assert/strict';
import test from 'node:test';

import { Diagram, version, type DiagramNodeInit } from '../src/canvas-renderer';
import { createDiagramDocument } from '../src/core/document';
import { serializeDiagramViewState } from '../src/core/view-state';
import type { ContextMenuItemState } from '../src/diagram/api';

// The menu is a tree: most entries are commands, the export entry is a submenu. Tests that
// only care whether something is available flatten it back into one lookup, group ids included.
function commandStates(items: readonly ContextMenuItemState[]): Map<string, boolean> {
    const states = new Map<string, boolean>();
    for (const item of items) {
        if ('group' in item) {
            states.set(item.group, item.enabled);
            for (const child of item.commands) states.set(child.command, child.enabled);
        } else {
            states.set(item.command, item.enabled);
        }
    }
    return states;
}

class FakeCanvas {
    style: Record<string, string> = {};
    tabIndex = 0;
    width = 0;
    height = 0;
    removed = false;
    fillStyles: string[] = [];
    strokeStyles: string[] = [];
    drawnText: string[] = [];
    drawImageCount = 0;
    transforms: number[][] = [];
    private readonly listeners = new Map<string, Array<EventListenerOrEventListenerObject>>();

    private readonly context = new Proxy({
        globalAlpha: 1,
        measureText: (text: string) => ({ width: text.length * 7 }),
        setTransform: (...values: number[]) => { this.transforms.push(values); },
        drawImage: () => { this.drawImageCount += 1; },
        fillText: (text: string) => { this.drawnText.push(text); },
    }, {
        get(target, property) {
            if (property in target) return target[property as keyof typeof target];
            return () => undefined;
        },
        set: (target, property, value) => {
            (target as Record<PropertyKey, unknown>)[property] = value;
            if (property === 'fillStyle' && typeof value === 'string')
                this.fillStyles.push(value);
            if (property === 'strokeStyle' && typeof value === 'string')
                this.strokeStyles.push(value);
            return true;
        },
    });

    getContext(): CanvasRenderingContext2D {
        return this.context as unknown as CanvasRenderingContext2D;
    }
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        const handlers = this.listeners.get(type) ?? [];
        handlers.push(listener);
        this.listeners.set(type, handlers);
    }
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        const handlers = this.listeners.get(type);
        if (handlers === undefined) return;
        this.listeners.set(type, handlers.filter((handler) => handler !== listener));
    }
    listenerCount(): number {
        return [...this.listeners.values()].reduce((total, handlers) => total + handlers.length, 0);
    }
    dispatch(type: string, init: Record<string, unknown>): void {
        const event = { type, preventDefault: () => undefined, ...init } as unknown as Event;
        for (const listener of this.listeners.get(type) ?? []) {
            if (typeof listener === 'function') listener(event);
            else listener.handleEvent(event);
        }
    }
    getBoundingClientRect(): DOMRect {
        return { left: 0, top: 0, right: 800, bottom: 480, width: 800, height: 480, x: 0, y: 0, toJSON: () => ({}) };
    }
    setPointerCapture(): void {}
    focus(): void {}
    remove(): void { this.removed = true; }
}

class FakeElement {
    style: Record<string, string> = {};
    hidden = false;
    removed = false;
    disabled = false;
    type = '';
    className = '';
    title = '';
    innerHTML = '';
    textContent = '';
    readonly children: FakeElement[] = [];
    private readonly attributes = new Map<string, string>();
    private readonly listeners = new Map<string, Array<EventListenerOrEventListenerObject>>();

    setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
    getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
    appendChild<T extends FakeElement>(child: T): T {
        this.children.push(child);
        return child;
    }
    contains(node: unknown): boolean {
        return node === this || this.children.some((child) => child.contains(node));
    }
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        const handlers = this.listeners.get(type) ?? [];
        handlers.push(listener);
        this.listeners.set(type, handlers);
    }
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((handler) => handler !== listener));
    }
    dispatch(type: string, init: Record<string, unknown> = {}): void {
        const event = { type, target: this, preventDefault: () => undefined, ...init } as unknown as Event;
        for (const listener of this.listeners.get(type) ?? []) {
            if (typeof listener === 'function') listener(event);
            else listener.handleEvent(event);
        }
    }
    remove(): void { this.removed = true; }

    /** Every element in this subtree, so a test can look the menu up by its text. */
    descendants(): FakeElement[] {
        return this.children.flatMap((child) => [child, ...child.descendants()]);
    }
    /** The caption of a menu item. The submenu arrow lives in its own span and is not part of it. */
    text(): string {
        const label = this.children.find((child) => child.className === 'ssdiagram-context-menu-label');
        return label?.textContent ?? this.textContent;
    }
}

class FakeButton extends FakeElement {}

class FakeHost {
    clientWidth = 800;
    clientHeight = 480;
    style: Record<string, string> = {};
    parentElement: FakeHost | null = null;
    canvas: FakeCanvas | null = null;
    button: FakeButton | null = null;
    classList = { toggle: () => false, add: () => undefined };
    readonly children: Array<FakeCanvas | FakeElement> = [];
    appendChild<T extends FakeCanvas | FakeElement>(child: T): T {
        this.children.push(child);
        if (child instanceof FakeCanvas) this.canvas = child;
        else if (child instanceof FakeButton) this.button = child;
        return child;
    }
    /** The live menu panel, if the control has one open. */
    menu(): FakeElement | null {
        for (const child of this.children) {
            if (child instanceof FakeElement && !child.removed && child.className === 'ssdiagram-context-menu') return child;
        }
        return null;
    }
    getBoundingClientRect(): DOMRect {
        return { left: 0, top: 0, right: 800, bottom: 480, width: 800, height: 480, x: 0, y: 0, toJSON: () => ({}) };
    }
}

class FakeWindow {
    devicePixelRatio = 1;
    private readonly listeners = new Map<string, EventListener[]>();

    addEventListener(type: string, listener: EventListener): void {
        const handlers = this.listeners.get(type) ?? [];
        handlers.push(listener);
        this.listeners.set(type, handlers);
    }
    removeEventListener(type: string, listener: EventListener): void {
        const handlers = this.listeners.get(type) ?? [];
        this.listeners.set(type, handlers.filter((handler) => handler !== listener));
    }
    listenerCount(): number {
        return [...this.listeners.values()].reduce((total, handlers) => total + handlers.length, 0);
    }
    dispatch(type: string, init: Record<string, unknown>): void {
        const event = { type, preventDefault: () => undefined, ...init } as unknown as Event;
        for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
}

function installDom(): FakeWindow {
    const fakeWindow = new FakeWindow();
    const fakeDocument = Object.assign(new FakeElement(), {
        documentElement: {},
        createElement: (tag: string) => {
            if (tag === 'canvas') return new FakeCanvas();
            if (tag === 'button') return new FakeButton();
            if (tag === 'div' || tag === 'span') return new FakeElement();
            throw new Error(`Unexpected element: ${tag}`);
        },
    });
    Object.assign(globalThis, {
        window: fakeWindow,
        document: fakeDocument,
        requestAnimationFrame: () => 1,
        Image: class {},
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
    });
    return fakeWindow;
}

function makeDiagram(): { diagram: Diagram; host: FakeHost; fakeWindow: FakeWindow } {
    const fakeWindow = installDom();
    const host = new FakeHost();
    const diagram = new Diagram({ host: host as unknown as HTMLElement });
    return { diagram, host, fakeWindow };
}

const source: DiagramNodeInit = {
    id: 'source',
    name: 'Source',
    x: 10,
    y: 20,
    outPorts: [{ id: 'out', name: 'Value', type: 'number' }],
};
const sink: DiagramNodeInit = {
    id: 'sink',
    name: 'Sink',
    x: 300,
    y: 20,
    inPorts: [{ id: 'in', name: 'Value', type: 'number' }],
};

test('exports a stable package version', () => {
    assert.equal(version, '0.1.0');
});

test('load/save preserves the public graph model', () => {
    const { diagram } = makeDiagram();
    diagram.load([source, sink], [
        { from: 'source', fromPort: 'out', to: 'sink', toPort: 'in' },
    ]);

    const saved = diagram.save();
    assert.equal(saved.nodes.length, 2);
    assert.deepEqual(saved.links, [
        { from: 'source', fromPort: 'out', to: 'sink', toPort: 'in' },
    ]);
    assert.equal(saved.nodes[0].outPorts[0].type, 'number');
});

test('canvas preserves the complete versioned document without runtime errors', () => {
    const { diagram } = makeDiagram();
    const document = createDiagramDocument({
        metadata: { strategy: 'designer' },
        nodes: [{
            id: 'source',
            name: 'Source',
            description: 'Full source description',
            icon: 'source.svg',
            message: 'Persistent note',
            outPorts: [{
                id: 'out',
                name: 'Value',
                description: 'Output value',
                type: 'number',
                maxLinks: 2,
                availableTypes: ['number', 'decimal'],
                isDynamic: true,
                dynamicMode: 'onConnect',
                metadata: { hostPortId: 7 },
            }],
            paramValues: { Value: '10' },
            metadata: { hostNodeId: 42 },
        }, {
            id: 'sink',
            name: 'Sink',
            inPorts: [{ id: 'in', name: 'Value', type: 'number' }],
        }],
        links: [{
            id: 'value-link',
            from: { nodeId: 'source', portId: 'out' },
            to: { nodeId: 'sink', portId: 'in' },
            metadata: { hostLinkId: 9 },
        }],
    });

    diagram.loadDocument(document);
    diagram.setNodeError('source', 'Transient failure', { kind: 'load' });

    assert.deepEqual(diagram.saveDocument(), document);
    assert.equal(diagram.save().nodes[0].loadError, undefined);
});

test('canvas clipboard preserves complete node data', () => {
    const { diagram } = makeDiagram();
    diagram.load([{
        ...source,
        description: 'Full description',
        metadata: { hostNodeId: 42 },
        outPorts: [{
            id: 'out',
            name: 'Value',
            description: 'Full port description',
            type: 'number',
            availableTypes: ['number', 'decimal'],
            metadata: { hostPortId: 7 },
        }],
        paramValues: { Period: '20' },
    }], []);
    diagram.selectNodeById('source');
    diagram.copySelection();
    diagram.pasteSelection();

    const pasted = diagram.saveDocument().nodes.find((node) => node.id !== 'source');
    assert.notEqual(pasted, undefined);
    assert.equal(pasted!.description, 'Full description');
    assert.deepEqual(pasted!.metadata, { hostNodeId: 42 });
    assert.deepEqual(pasted!.outPorts[0].availableTypes, ['number', 'decimal']);
    assert.deepEqual(pasted!.outPorts[0].metadata, { hostPortId: 7 });
    assert.deepEqual(pasted!.paramValues, { Period: '20' });
});

test('link validation rejects incompatible port types', () => {
    const { diagram } = makeDiagram();
    diagram.load([
        source,
        { ...sink, inPorts: [{ id: 'in', name: 'Orders', type: 'order' }] },
    ], []);
    diagram.setLinkValidator(({ fromPort, toPort }) => fromPort.type === toPort.type);

    const added = diagram.addLink({ from: 'source', fromPort: 'out', to: 'sink', toPort: 'in' });

    assert.equal(added, false);
    assert.deepEqual(diagram.save().links, []);
});

test('link validation reports compatibility, duplicates and limits on both ends', () => {
    const { diagram } = makeDiagram();
    diagram.load([{
        id: 'source-a',
        name: 'Source A',
        outPorts: [{ id: 'out', name: 'Out', type: 'Decimal', maxLinks: 1 }],
    }, {
        id: 'source-b',
        name: 'Source B',
        outPorts: [{ id: 'out', name: 'Out', type: 'Decimal' }],
    }, {
        id: 'sink-a',
        name: 'Sink A',
        inPorts: [{ id: 'in', name: 'In', type: 'Number', availableTypes: ['Decimal'], maxLinks: 1 }],
    }, {
        id: 'sink-b',
        name: 'Sink B',
        inPorts: [{ id: 'in', name: 'In', type: 'Decimal' }],
    }], []);

    const first = { from: 'source-a', fromPort: 'out', to: 'sink-a', toPort: 'in' };
    assert.deepEqual(diagram.validateLink(first), { allowed: true, reason: 'allowed' });
    assert.equal(diagram.addLink(first), true);
    assert.deepEqual(diagram.validateLink(first), { allowed: false, reason: 'duplicate-link' });
    assert.deepEqual(diagram.validateLink({
        from: 'source-a', fromPort: 'out', to: 'sink-b', toPort: 'in',
    }), { allowed: false, reason: 'source-limit' });
    assert.deepEqual(diagram.validateLink({
        from: 'source-b', fromPort: 'out', to: 'sink-a', toPort: 'in',
    }), { allowed: false, reason: 'target-limit' });

    diagram.setLinkValidator(() => false);
    assert.deepEqual(diagram.validateLink({
        from: 'source-b', fromPort: 'out', to: 'sink-b', toPort: 'in',
    }), { allowed: false, reason: 'host-rejected' });
});

test('port limits independently control fan-in and fan-out and can change at runtime', () => {
    const { diagram } = makeDiagram();
    diagram.load([{
        id: 'source-a', name: 'Source A',
        outPorts: [{ id: 'out', name: 'Out', type: 'Decimal', maxLinks: 1 }],
    }, {
        id: 'source-b', name: 'Source B',
        outPorts: [{ id: 'out', name: 'Out', type: 'Decimal' }],
    }, {
        id: 'source-c', name: 'Source C',
        outPorts: [{ id: 'out', name: 'Out', type: 'Decimal' }],
    }, {
        id: 'sink-a', name: 'Sink A',
        inPorts: [{ id: 'in', name: 'In', type: 'Decimal', maxLinks: 1 }],
    }, {
        id: 'sink-b', name: 'Sink B',
        inPorts: [{ id: 'in', name: 'In', type: 'Decimal' }],
    }, {
        id: 'sink-c', name: 'Sink C',
        inPorts: [{ id: 'in', name: 'In', type: 'Decimal' }],
    }], []);

    const first = { from: 'source-a', fromPort: 'out', to: 'sink-a', toPort: 'in' };
    assert.equal(diagram.addLink(first), true);
    assert.deepEqual(diagram.validateLink({
        from: 'source-a', fromPort: 'out', to: 'sink-b', toPort: 'in',
    }), { allowed: false, reason: 'source-limit' });
    assert.deepEqual(diagram.validateLink({
        from: 'source-b', fromPort: 'out', to: 'sink-a', toPort: 'in',
    }), { allowed: false, reason: 'target-limit' });

    assert.equal(diagram.updatePort('source-a', 'out', 'out', { maxLinks: 0 }), true);
    assert.equal(diagram.updatePort('sink-a', 'in', 'in', { maxLinks: 0 }), true);
    assert.equal(diagram.addLink({
        from: 'source-a', fromPort: 'out', to: 'sink-b', toPort: 'in',
    }), true);
    assert.equal(diagram.addLink({
        from: 'source-b', fromPort: 'out', to: 'sink-a', toPort: 'in',
    }), true);
    assert.deepEqual(diagram.validateLink(first), { allowed: false, reason: 'duplicate-link' });

    assert.equal(diagram.updatePort('source-a', 'out', 'out', { maxLinks: 1 }), true);
    assert.equal(diagram.updatePort('sink-a', 'in', 'in', { maxLinks: 1 }), true);
    assert.equal(diagram.saveDocument().links.length, 3, 'lower limits must not delete existing links');
    assert.deepEqual(diagram.validateLink({
        from: 'source-c', fromPort: 'out', to: 'sink-a', toPort: 'in',
    }), { allowed: false, reason: 'target-limit' });
    assert.deepEqual(diagram.validateLink({
        from: 'source-a', fromPort: 'out', to: 'sink-c', toPort: 'in',
    }), { allowed: false, reason: 'source-limit' });

    diagram.undo();
    assert.deepEqual(diagram.validateLink({
        from: 'source-c', fromPort: 'out', to: 'sink-a', toPort: 'in',
    }), { allowed: true, reason: 'allowed' });
    diagram.undo();
    assert.deepEqual(diagram.validateLink({
        from: 'source-a', fromPort: 'out', to: 'sink-c', toPort: 'in',
    }), { allowed: true, reason: 'allowed' });
});

test('Any and Object ports accept every socket type', () => {
    const { diagram } = makeDiagram();
    diagram.load([{
        id: 'decimal', name: 'Decimal source',
        outPorts: [{ id: 'out', name: 'Out', type: 'Decimal' }],
    }, {
        id: 'any', name: 'Any source',
        outPorts: [{ id: 'out', name: 'Out', type: 'Any' }],
    }, {
        id: 'object', name: 'Object sink',
        inPorts: [{ id: 'in', name: 'In', type: 'Object' }],
    }, {
        id: 'candle', name: 'Candle sink',
        inPorts: [{ id: 'in', name: 'In', type: 'Candle' }],
    }, {
        id: 'available-object', name: 'Wildcard whitelist sink',
        inPorts: [{ id: 'in', name: 'In', type: 'Candle', availableTypes: ['System.Object'] }],
    }], []);

    assert.deepEqual(diagram.validateLink({
        from: 'decimal', fromPort: 'out', to: 'object', toPort: 'in',
    }), { allowed: true, reason: 'allowed' });
    assert.deepEqual(diagram.validateLink({
        from: 'any', fromPort: 'out', to: 'candle', toPort: 'in',
    }), { allowed: true, reason: 'allowed' });
    assert.deepEqual(diagram.validateLink({
        from: 'decimal', fromPort: 'out', to: 'available-object', toPort: 'in',
    }), { allowed: true, reason: 'allowed' });
    assert.deepEqual(diagram.validateLink({
        from: 'decimal', fromPort: 'out', to: 'candle', toPort: 'in',
    }), { allowed: false, reason: 'incompatible-type' });
});

test('changing a port type removes only incompatible links as one undoable edit', () => {
    const { diagram } = makeDiagram();
    diagram.load([{
        id: 'decimal', name: 'Decimal source',
        outPorts: [{ id: 'out', name: 'Out', type: 'Decimal' }],
    }, {
        id: 'candle', name: 'Candle source',
        outPorts: [{ id: 'out', name: 'Out', type: 'Candle' }],
    }, {
        id: 'sink', name: 'Object sink',
        inPorts: [{ id: 'in', name: 'In', type: 'Object' }],
    }], []);
    assert.equal(diagram.addLink({ from: 'decimal', fromPort: 'out', to: 'sink', toPort: 'in' }), true);
    assert.equal(diagram.addLink({ from: 'candle', fromPort: 'out', to: 'sink', toPort: 'in' }), true);

    assert.equal(diagram.updatePort('sink', 'in', 'in', { type: 'Decimal' }), true);
    assert.equal(diagram.findNode('sink')?.inPorts[0]?.type, 'Decimal');
    assert.deepEqual(diagram.saveDocument().links.map((link) => link.from.nodeId), ['decimal']);

    diagram.undo();
    assert.equal(diagram.findNode('sink')?.inPorts[0]?.type, 'Object');
    assert.deepEqual(diagram.saveDocument().links.map((link) => link.from.nodeId), ['decimal', 'candle']);

    diagram.redo();
    assert.equal(diagram.findNode('sink')?.inPorts[0]?.type, 'Decimal');
    assert.deepEqual(diagram.saveDocument().links.map((link) => link.from.nodeId), ['decimal']);
});

test('replacing a node port schema removes links that no longer match its types', () => {
    const { diagram } = makeDiagram();
    diagram.load([{
        id: 'source', name: 'Decimal source',
        outPorts: [{ id: 'out', name: 'Out', type: 'Decimal' }],
    }, {
        id: 'sink', name: 'Object sink',
        inPorts: [{ id: 'in', name: 'In', type: 'Object' }],
    }], [{ from: 'source', fromPort: 'out', to: 'sink', toPort: 'in' }]);

    assert.equal(diagram.setNodePorts('sink', [{ id: 'in', name: 'In', type: 'Candle' }], []), true);
    assert.equal(diagram.saveDocument().links.length, 0);

    diagram.undo();
    assert.equal(diagram.findNode('sink')?.inPorts[0]?.type, 'Object');
    assert.equal(diagram.saveDocument().links.length, 1);
});

test('relink preserves identity and metadata and is one reversible action', () => {
    const { diagram } = makeDiagram();
    diagram.load([{
        id: 'source', name: 'Source', outPorts: [{ id: 'out', name: 'Out', type: 'number' }],
    }, {
        id: 'sink-a', name: 'Sink A', inPorts: [{ id: 'in', name: 'In', type: 'number' }],
    }, {
        id: 'sink-b', name: 'Sink B', inPorts: [{ id: 'in', name: 'In', type: 'number' }],
    }], [{
        id: 'stable-link',
        from: 'source', fromPort: 'out', to: 'sink-a', toPort: 'in',
        metadata: { hostLinkId: 42 },
    }]);
    const events: string[] = [];
    diagram.on('linkRelinked', ({ link, previous }) => events.push(`${previous.to}->${link.to}`));

    assert.deepEqual(diagram.relink('stable-link', {
        from: 'source', fromPort: 'out', to: 'sink-b', toPort: 'in',
    }), { allowed: true, reason: 'allowed' });
    let link = diagram.saveDocument().links[0];
    assert.equal(link.id, 'stable-link');
    assert.equal(link.to.nodeId, 'sink-b');
    assert.deepEqual(link.metadata, { hostLinkId: 42 });

    diagram.undo();
    link = diagram.saveDocument().links[0];
    assert.equal(link.to.nodeId, 'sink-a');
    diagram.redo();
    assert.equal(diagram.saveDocument().links[0].to.nodeId, 'sink-b');
    assert.deepEqual(events, ['sink-a->sink-b', 'sink-b->sink-a', 'sink-a->sink-b']);

    assert.deepEqual(diagram.relink('stable-link', {
        from: 'source', fromPort: 'missing', to: 'sink-a', toPort: 'in',
    }), { allowed: false, reason: 'missing-port' });
    assert.equal(diagram.saveDocument().links[0].to.nodeId, 'sink-b');
    assert.deepEqual(diagram.relink('unknown', {
        from: 'source', fromPort: 'out', to: 'sink-a', toPort: 'in',
    }), { allowed: false, reason: 'missing-link' });
});

test('selected link endpoint can be dragged to another compatible port', () => {
    const { diagram, host, fakeWindow } = makeDiagram();
    diagram.load([{
        id: 'source', name: 'Source', x: 20, y: 50,
        outPorts: [{ id: 'out', name: 'Out', type: 'number' }],
    }, {
        id: 'source-b', name: 'Source B', x: 20, y: 210,
        outPorts: [{ id: 'out', name: 'Out', type: 'number' }],
    }, {
        id: 'sink-a', name: 'Sink A', x: 300, y: 20,
        inPorts: [{ id: 'in', name: 'In', type: 'number' }],
    }, {
        id: 'sink-b', name: 'Sink B', x: 300, y: 180,
        inPorts: [{ id: 'in', name: 'In', type: 'number' }],
    }], [{ id: 'stable-link', from: 'source', fromPort: 'out', to: 'sink-a', toPort: 'in' }]);
    diagram.selectLinkById('stable-link');

    const renderer = diagram as unknown as {
        findNode(id: string): {
            inPorts: Array<{ cx: number; cy: number }>;
            outPorts: Array<{ cx: number; cy: number }>;
        } | undefined;
        toScreen(x: number, y: number): [number, number];
    };
    const oldPort = renderer.findNode('sink-a')!.inPorts[0];
    const newPort = renderer.findNode('sink-b')!.inPorts[0];
    const [oldX, oldY] = renderer.toScreen(oldPort.cx, oldPort.cy);
    const [newX, newY] = renderer.toScreen(newPort.cx, newPort.cy);
    host.canvas!.dispatch('pointerdown', {
        clientX: oldX, clientY: oldY, pointerId: 1, pointerType: 'mouse', button: 0,
        shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    });
    host.canvas!.dispatch('pointermove', { clientX: newX, clientY: newY });
    fakeWindow.dispatch('pointerup', { clientX: newX, clientY: newY, shiftKey: false });

    assert.equal(diagram.saveDocument().links[0].to.nodeId, 'sink-b');
    diagram.undo();
    assert.equal(diagram.saveDocument().links[0].to.nodeId, 'sink-a');

    const oldSource = renderer.findNode('source')!.outPorts[0];
    const newSource = renderer.findNode('source-b')!.outPorts[0];
    const [oldSourceX, oldSourceY] = renderer.toScreen(oldSource.cx, oldSource.cy);
    const [newSourceX, newSourceY] = renderer.toScreen(newSource.cx, newSource.cy);
    host.canvas!.dispatch('pointerdown', {
        clientX: oldSourceX, clientY: oldSourceY, pointerId: 2, pointerType: 'mouse', button: 0,
        shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    });
    host.canvas!.dispatch('pointermove', { clientX: newSourceX, clientY: newSourceY });
    fakeWindow.dispatch('pointerup', { clientX: newSourceX, clientY: newSourceY, shiftKey: false });
    assert.equal(diagram.saveDocument().links[0].from.nodeId, 'source-b');
    diagram.undo();
    assert.equal(diagram.saveDocument().links[0].from.nodeId, 'source');
});

test('a connected input can be rewired in one drag without preselecting its link', () => {
    const { diagram, host, fakeWindow } = makeDiagram();
    diagram.load([{
        id: 'source', name: 'Source', x: 20, y: 50,
        outPorts: [{ id: 'out', name: 'Out', type: 'number' }],
    }, {
        id: 'sink-a', name: 'Sink A', x: 300, y: 20,
        inPorts: [{ id: 'in', name: 'In', type: 'number' }],
    }, {
        id: 'sink-b', name: 'Sink B', x: 300, y: 180,
        inPorts: [{ id: 'in', name: 'In', type: 'number' }],
    }], [{ id: 'stable-link', from: 'source', fromPort: 'out', to: 'sink-a', toPort: 'in' }]);

    const renderer = diagram as unknown as {
        findNode(id: string): { inPorts: Array<{ cx: number; cy: number }> } | undefined;
        toScreen(x: number, y: number): [number, number];
    };
    const oldPort = renderer.findNode('sink-a')!.inPorts[0];
    const newPort = renderer.findNode('sink-b')!.inPorts[0];
    const [oldX, oldY] = renderer.toScreen(oldPort.cx, oldPort.cy);
    const [newX, newY] = renderer.toScreen(newPort.cx, newPort.cy);
    host.canvas!.dispatch('pointerdown', {
        clientX: oldX, clientY: oldY, pointerId: 1, pointerType: 'mouse', button: 0,
        shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    });
    host.canvas!.dispatch('pointermove', { clientX: newX, clientY: newY });
    fakeWindow.dispatch('pointerup', { clientX: newX, clientY: newY, shiftKey: false });

    assert.equal(diagram.saveDocument().links[0].to.nodeId, 'sink-b');
    assert.deepEqual(diagram.getSelection().linkIds, ['stable-link']);
});

test('direct output drags preserve single-link and multi-link port policies', () => {
    const setup = (maxLinks: number) => {
        const fixture = makeDiagram();
        fixture.diagram.load([{
            id: 'source-a', name: 'Source A', x: 20, y: 20,
            outPorts: [{ id: 'out', name: 'Out', type: 'number', maxLinks }],
        }, {
            id: 'source-b', name: 'Source B', x: 20, y: 180,
            outPorts: [{ id: 'out', name: 'Out', type: 'number' }],
        }, {
            id: 'sink-a', name: 'Sink A', x: 320, y: 20,
            inPorts: [{ id: 'in', name: 'In', type: 'number' }],
        }, {
            id: 'sink-b', name: 'Sink B', x: 320, y: 180,
            inPorts: [{ id: 'in', name: 'In', type: 'number' }],
        }], [{ id: 'stable-link', from: 'source-a', fromPort: 'out', to: 'sink-a', toPort: 'in' }]);
        return fixture;
    };
    const portPosition = (diagram: Diagram, nodeId: string, direction: 'inPorts' | 'outPorts') => {
        const renderer = diagram as unknown as {
            findNode(id: string): Record<typeof direction, Array<{ cx: number; cy: number }>> | undefined;
            toScreen(x: number, y: number): [number, number];
        };
        const port = renderer.findNode(nodeId)![direction][0];
        return renderer.toScreen(port.cx, port.cy);
    };
    const drag = (
        fixture: ReturnType<typeof setup>,
        from: [number, number],
        to: [number, number],
    ) => {
        fixture.host.canvas!.dispatch('pointerdown', {
            clientX: from[0], clientY: from[1], pointerId: 1, pointerType: 'mouse', button: 0,
            shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
        });
        fixture.host.canvas!.dispatch('pointermove', { clientX: to[0], clientY: to[1] });
        fixture.fakeWindow.dispatch('pointerup', { clientX: to[0], clientY: to[1], shiftKey: false });
    };

    const single = setup(1);
    drag(single, portPosition(single.diagram, 'source-a', 'outPorts'),
        portPosition(single.diagram, 'sink-b', 'inPorts'));
    assert.equal(single.diagram.saveDocument().links.length, 1);
    assert.equal(single.diagram.saveDocument().links[0].to.nodeId, 'sink-a');

    const multi = setup(0);
    drag(multi, portPosition(multi.diagram, 'source-a', 'outPorts'),
        portPosition(multi.diagram, 'sink-b', 'inPorts'));
    assert.equal(multi.diagram.saveDocument().links.length, 2);
    assert.ok(multi.diagram.saveDocument().links.some((link) => link.to.nodeId === 'sink-a'));
    assert.ok(multi.diagram.saveDocument().links.some((link) => link.to.nodeId === 'sink-b'));
});

test('dynamic input anchors grow typed siblings and prune them with the link', () => {
    const { diagram } = makeDiagram();
    diagram.load([{
        id: 'source-a', name: 'Source A',
        outPorts: [{ id: 'out', name: 'Out', type: 'Decimal' }],
    }, {
        id: 'source-b', name: 'Source B',
        outPorts: [{ id: 'out', name: 'Out', type: 'Decimal' }],
    }, {
        id: 'target', name: 'Target',
        inPorts: [{
            id: 'values', name: 'Value', type: 'Number', availableTypes: ['Decimal'],
            isDynamic: true, dynamicMode: 'onConnect', metadata: { socketKind: 'variadic' },
        }],
    }], []);

    assert.equal(diagram.addLink({
        id: 'dynamic-1', from: 'source-a', fromPort: 'out', to: 'target', toPort: 'values',
        metadata: { hostLinkId: 1 },
    }), true);
    let document = diagram.saveDocument();
    let target = document.nodes.find((node) => node.id === 'target')!;
    assert.deepEqual(target.inPorts.map((port) => port.id), ['values', 'values_1']);
    assert.deepEqual(target.inPorts[1], {
        id: 'values_1',
        name: 'Value 1',
        description: '',
        type: 'Decimal',
        maxLinks: 1,
        availableTypes: ['Decimal'],
        isDynamic: false,
        dynamicMode: '',
        isSibling: true,
        metadata: { socketKind: 'variadic' },
    });
    assert.equal(document.links[0].id, 'dynamic-1');
    assert.equal(document.links[0].to.portId, 'values_1');
    assert.deepEqual(document.links[0].metadata, { hostLinkId: 1 });

    diagram.undo();
    document = diagram.saveDocument();
    assert.equal(document.links.length, 0);
    assert.deepEqual(document.nodes.find((node) => node.id === 'target')!.inPorts.map((port) => port.id), ['values']);
    diagram.redo();
    assert.equal(diagram.saveDocument().links[0].to.portId, 'values_1');

    assert.equal(diagram.addLink({
        id: 'dynamic-2', from: 'source-b', fromPort: 'out', to: 'target', toPort: 'values',
    }), true);
    document = diagram.saveDocument();
    assert.deepEqual(document.nodes.find((node) => node.id === 'target')!.inPorts.map((port) => port.id),
        ['values', 'values_1', 'values_2']);
    const first = document.links.find((link) => link.id === 'dynamic-1')!;
    diagram.removeLink({
        id: first.id,
        from: first.from.nodeId,
        fromPort: first.from.portId,
        to: first.to.nodeId,
        toPort: first.to.portId,
    });
    document = diagram.saveDocument();
    assert.deepEqual(document.nodes.find((node) => node.id === 'target')!.inPorts.map((port) => port.id),
        ['values', 'values_2']);
    assert.deepEqual(document.links.map((link) => link.id), ['dynamic-2']);
    diagram.undo();
    assert.deepEqual(diagram.saveDocument().links.map((link) => link.id), ['dynamic-1', 'dynamic-2']);
    assert.ok(diagram.saveDocument().nodes.find((node) => node.id === 'target')!.inPorts
        .some((port) => port.id === 'values_1'));

    diagram.removeDiagramNode('source-a');
    document = diagram.saveDocument();
    assert.deepEqual(document.links.map((link) => link.id), ['dynamic-2']);
    assert.deepEqual(document.nodes.find((node) => node.id === 'target')!.inPorts.map((port) => port.id),
        ['values', 'values_2']);
    diagram.undo();
    document = diagram.saveDocument();
    assert.ok(document.nodes.some((node) => node.id === 'source-a'));
    assert.deepEqual(document.links.map((link) => link.id), ['dynamic-1', 'dynamic-2']);
    assert.deepEqual(document.nodes.find((node) => node.id === 'target')!.inPorts.map((port) => port.id),
        ['values', 'values_1', 'values_2']);
});

test('relinking to and from a dynamic anchor owns the sibling lifecycle', () => {
    const { diagram } = makeDiagram();
    diagram.load([{
        id: 'source', name: 'Source', outPorts: [{ id: 'out', name: 'Out', type: 'number' }],
    }, {
        id: 'regular', name: 'Regular', inPorts: [{ id: 'in', name: 'In', type: 'number' }],
    }, {
        id: 'dynamic', name: 'Dynamic', inPorts: [{
            id: 'items', name: 'Item', type: 'number', isDynamic: true, dynamicMode: 'onConnect',
        }],
    }], [{ id: 'link', from: 'source', fromPort: 'out', to: 'regular', toPort: 'in' }]);

    assert.deepEqual(diagram.relink('link', {
        from: 'source', fromPort: 'out', to: 'dynamic', toPort: 'items',
    }), { allowed: true, reason: 'allowed' });
    assert.equal(diagram.saveDocument().links[0].to.portId, 'items_1');
    assert.deepEqual(diagram.saveDocument().nodes.find((node) => node.id === 'dynamic')!.inPorts
        .map((port) => port.id), ['items', 'items_1']);
    diagram.undo();
    assert.equal(diagram.saveDocument().links[0].to.nodeId, 'regular');
    assert.deepEqual(diagram.saveDocument().nodes.find((node) => node.id === 'dynamic')!.inPorts
        .map((port) => port.id), ['items']);
    diagram.redo();

    assert.deepEqual(diagram.relink('link', {
        from: 'source', fromPort: 'out', to: 'regular', toPort: 'in',
    }), { allowed: true, reason: 'allowed' });
    assert.equal(diagram.saveDocument().links[0].to.nodeId, 'regular');
    assert.deepEqual(diagram.saveDocument().nodes.find((node) => node.id === 'dynamic')!.inPorts
        .map((port) => port.id), ['items']);
    diagram.undo();
    assert.equal(diagram.saveDocument().links[0].to.portId, 'items_1');
});

test('mutations participate in undo and redo', () => {
    const { diagram } = makeDiagram();
    diagram.load([source], []);
    const events: Array<{ canUndo: boolean; canRedo: boolean }> = [];
    diagram.on('undoStackChanged', (event) => events.push(event));

    diagram.addDiagramNode(sink);
    assert.equal(diagram.save().nodes.length, 2);
    assert.equal(diagram.canUndo(), true);

    diagram.undo();
    assert.deepEqual(diagram.save().nodes.map((node) => node.id), ['source']);
    assert.equal(diagram.canRedo(), true);

    diagram.redo();
    assert.deepEqual(diagram.save().nodes.map((node) => node.id), ['source', 'sink']);
    assert.ok(events.length >= 3);
});

test('grid snapping keeps a dragged group rigid and records one undo action', () => {
    const { diagram, host, fakeWindow } = makeDiagram();
    diagram.load([{
        id: 'a', name: 'A', x: 13, y: 17,
    }, {
        id: 'b', name: 'B', x: 57, y: 65,
    }], []);
    diagram.setGridSnap(true, 10);
    diagram.selectNodesById(['a', 'b']);

    const renderer = diagram as unknown as {
        findNode(id: string): { x: number; y: number; w: number; h: number } | undefined;
        toScreen(x: number, y: number): [number, number];
    };
    const b = renderer.findNode('b')!;
    const [startX, startY] = renderer.toScreen(b.x + b.w / 2, b.y + b.h / 2);
    host.canvas!.dispatch('pointerdown', {
        clientX: startX, clientY: startY, pointerId: 1, pointerType: 'mouse', button: 0,
        shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    });
    host.canvas!.dispatch('pointermove', { clientX: startX + 7, clientY: startY + 9 });
    fakeWindow.dispatch('pointerup', { clientX: startX + 7, clientY: startY + 9, shiftKey: false });

    assert.deepEqual(diagram.saveDocument().nodes.map(({ x, y }) => [x, y]), [[16, 22], [60, 70]]);
    diagram.undo();
    assert.deepEqual(diagram.saveDocument().nodes.map(({ x, y }) => [x, y]), [[13, 17], [57, 65]]);
    diagram.redo();
    assert.deepEqual(diagram.saveDocument().nodes.map(({ x, y }) => [x, y]), [[16, 22], [60, 70]]);
});

test('arrow keys nudge the selection using the configured grid step', () => {
    const { diagram, host } = makeDiagram();
    diagram.load([{ id: 'node', name: 'Node', x: 13, y: 17 }], []);
    diagram.selectNodesById(['node']);
    diagram.setGridSnap(true, 10);

    host.canvas!.dispatch('keydown', { key: 'ArrowRight', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false });
    host.canvas!.dispatch('keydown', { key: 'ArrowDown', shiftKey: true, ctrlKey: false, metaKey: false, altKey: false });
    assert.deepEqual([diagram.findNode('node')!.x, diagram.findNode('node')!.y], [23, 67]);
    diagram.undo();
    assert.deepEqual([diagram.findNode('node')!.x, diagram.findNode('node')!.y], [23, 17]);
    diagram.undo();
    assert.deepEqual([diagram.findNode('node')!.x, diagram.findNode('node')!.y], [13, 17]);

    diagram.setGridSnap(false);
    host.canvas!.dispatch('keydown', { key: 'ArrowLeft', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false });
    assert.equal(diagram.findNode('node')!.x, 12);
    diagram.setReadOnly(true);
    host.canvas!.dispatch('keydown', { key: 'ArrowLeft', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false });
    assert.equal(diagram.findNode('node')!.x, 12);
    assert.throws(() => diagram.setGridSnap(true, 0), /grid size/);
});

test('port removal and cascaded links are one reversible transaction', () => {
    const { diagram } = makeDiagram();
    diagram.load([source, sink], [
        { id: 'value-link', from: 'source', fromPort: 'out', to: 'sink', toPort: 'in' },
    ]);

    assert.equal(diagram.removePort('sink', 'in', 'in'), true);
    assert.equal(diagram.saveDocument().nodes[1].inPorts.length, 0);
    assert.equal(diagram.saveDocument().links.length, 0);

    diagram.undo();
    assert.equal(diagram.saveDocument().nodes[1].inPorts[0].id, 'in');
    assert.equal(diagram.saveDocument().links[0].id, 'value-link');

    diagram.redo();
    assert.equal(diagram.saveDocument().nodes[1].inPorts.length, 0);
    assert.equal(diagram.saveDocument().links.length, 0);
});

test('selection snapshot supports multiple nodes, ports and stable link ids', () => {
    const { diagram } = makeDiagram();
    diagram.load([source, sink], [{
        id: 'value-link',
        from: 'source',
        fromPort: 'out',
        to: 'sink',
        toPort: 'in',
    }]);
    const snapshots: ReturnType<Diagram['getSelection']>[] = [];
    diagram.on('selectionChanged', (selection) => snapshots.push(selection));

    diagram.selectNodesById(['source', 'sink']);
    assert.deepEqual(diagram.getSelection().nodeIds, ['source', 'sink']);
    assert.equal(diagram.getSelection().primaryNodeId, 'sink');

    diagram.selectPortById('source', 'out', 'out');
    assert.deepEqual(diagram.getSelection().port, {
        nodeId: 'source',
        portId: 'out',
        direction: 'out',
    });

    diagram.selectLinkById('value-link');
    assert.deepEqual(diagram.getSelection().nodeIds, []);
    assert.deepEqual(diagram.getSelection().linkIds, ['value-link']);
    assert.equal(diagram.getSelection().port, null);
    assert.ok(snapshots.length >= 3);
});

test('read-only mode keeps inspection, selection and copy without allowing edits', () => {
    const { diagram, host } = makeDiagram();
    diagram.load([{ ...source, openAction: 'open' }], []);
    diagram.moveNode('source', 20, 30);
    diagram.setReadOnly(true);
    const node = diagram.findNode('source')!;
    const [x, y] = (diagram as unknown as { toScreen(x: number, y: number): [number, number] })
        .toScreen(node.x + node.w / 2, node.y + node.h / 2);
    let contexts = 0;
    let opened = 0;
    diagram.on('contextMenu', () => { contexts += 1; });
    diagram.on('nodeOpen', () => { opened += 1; });

    host.canvas!.dispatch('pointerdown', {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: x,
        clientY: y,
    });
    host.canvas!.dispatch('pointermove', { clientX: x + 100, clientY: y + 100 });
    host.canvas!.dispatch('contextmenu', { clientX: x, clientY: y });
    host.canvas!.dispatch('dblclick', { clientX: x, clientY: y });

    assert.deepEqual(diagram.getSelection().nodeIds, ['source']);
    assert.equal(diagram.findNode('source')?.x, 20);
    assert.equal(diagram.findNode('source')?.y, 30);
    assert.equal(contexts, 1);
    assert.equal(opened, 1);
    assert.equal(diagram.canUndo(), false);

    diagram.copySelection();
    diagram.pasteSelection();
    assert.equal(diagram.save().nodes.length, 1);
    diagram.setReadOnly(false);
    diagram.pasteSelection();
    assert.equal(diagram.save().nodes.length, 2);
});

test('opening the context menu drops the hover under it, tooltip and all', () => {
    const { diagram, host } = makeDiagram();
    diagram.load([source, sink], []);

    const hovers: boolean[] = [];
    diagram.on('nodeHover', ({ hovering }) => hovers.push(hovering));

    // Settle on a node: this is what arms the delayed tooltip.
    const node = diagram.findNode('source');
    assert.ok(node !== undefined);
    // Through worldToView: loading centres the diagram, so the node's world coordinates do not
    // land anywhere near it on screen.
    const [nodeX, nodeY] = diagram.worldToView(node.x + node.w / 2, node.y + node.h / 2);
    host.canvas?.dispatch('pointermove', { clientX: nodeX, clientY: nodeY });
    assert.deepEqual(hovers, [true], 'the pointer should be hovering the node');

    // The menu appears under a cursor that has not moved, and a stationary cursor gets no
    // boundary event, so nothing else will tell the canvas its hover ended. Left alone, the
    // pending tooltip fires 400ms later and draws through the open menu.
    host.canvas?.dispatch('contextmenu', { clientX: nodeX, clientY: nodeY });
    assert.deepEqual(hovers, [true, false], 'the hover survived the menu opening');
});

/** Theme background of a diagram under test, deliberately distinct from any export override. */
const THEME_BACKGROUND = '#102030';
const EXPORT_BACKGROUND = '#abcdef';

const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

const mouse = (clientX: number, clientY: number, button: number): Record<string, unknown> => ({
    clientX, clientY, button, pointerId: 1, pointerType: 'mouse',
    shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
});

const rightButton = (clientX: number, clientY: number): Record<string, unknown> => ({
    clientX, clientY, button: 2, pointerId: 1, pointerType: 'mouse',
    shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
});

test('a right-button drag across a node body leaves the node where it was', () => {
    const { diagram, host, fakeWindow } = makeDiagram();
    diagram.load([source, sink], []);

    const node = diagram.findNode('source')!;
    const start = { x: node.x, y: node.y };
    const [vx, vy] = diagram.worldToView(node.x + node.w / 2, node.y + node.h / 2);

    // Right button pressed on the body, dragged 120x60 screen px (scale is 1 after the fit).
    // The trailing contextmenu is the real desktop sequence: Windows raises it on release, after
    // pointerup has already committed the drag, so the menu cannot take the movement back.
    host.canvas!.dispatch('pointerdown', rightButton(vx, vy));
    host.canvas!.dispatch('pointermove', { clientX: vx + 120, clientY: vy + 60 });
    fakeWindow.dispatch('pointerup', rightButton(vx + 120, vy + 60));
    host.canvas!.dispatch('contextmenu', rightButton(vx + 120, vy + 60));

    assert.deepEqual(
        { x: node.x, y: node.y, undoEntry: diagram.canUndo() },
        { x: start.x, y: start.y, undoEntry: false },
        'a non-primary (right) button must not drag a node: the node moved and/or a "drag" entry '
        + 'was pushed onto the undo stack by a gesture that only meant to open a context menu',
    );
});

test('destroy removes the owned canvas', () => {
    const { diagram, host, fakeWindow } = makeDiagram();
    assert.ok((host.canvas?.listenerCount() ?? 0) > 0);
    assert.ok(fakeWindow.listenerCount() > 0);
    diagram.destroy();
    diagram.destroy();
    assert.equal(host.canvas?.removed, true);
    assert.equal(host.canvas?.listenerCount(), 0);
    assert.equal(fakeWindow.listenerCount(), 0);
});

test('overview derives a light palette from the canvas theme', () => {
    const { diagram, host } = makeDiagram();
    diagram.load([source, sink], []);
    diagram.setTheme({ background: '#f5f7fa', gridColor: '#e2e8f0' });

    (diagram as unknown as { drawOverview(): void }).drawOverview();

    assert.ok(host.canvas?.fillStyles.includes('rgba(255,255,255,0.94)'));
    assert.ok(host.canvas?.fillStyles.includes('rgba(217,119,6,0.10)'));
});

test('double-click is emitted only for nodes with an open action', () => {
    const { diagram, host } = makeDiagram();
    diagram.load([
        { ...source, id: 'open', openAction: 'indicatorSettings' },
        { ...sink, id: 'plain' },
    ], []);
    const opened: string[] = [];
    diagram.on('nodeOpen', ({ node }) => opened.push(node.id));

    const internals = diagram as unknown as {
        findNode(id: string): { x: number; y: number; w: number; h: number; outPorts: Array<{ cx: number; cy: number }> } | undefined;
        toScreen(x: number, y: number): [number, number];
    };
    const open = internals.findNode('open')!;
    const [openX, openY] = internals.toScreen(open.x + open.w / 2, open.y + open.h / 2);
    host.canvas!.dispatch('dblclick', { clientX: openX, clientY: openY });

    const plain = internals.findNode('plain')!;
    const [plainX, plainY] = internals.toScreen(plain.x + plain.w / 2, plain.y + plain.h / 2);
    host.canvas!.dispatch('dblclick', { clientX: plainX, clientY: plainY });
    const [portX, portY] = internals.toScreen(open.outPorts[0].cx, open.outPorts[0].cy);
    host.canvas!.dispatch('dblclick', { clientX: portX, clientY: portY });

    assert.deepEqual(opened, ['open']);
});

test('screenshots copy the viewport or render full content without changing editor state', () => {
    const { diagram, host } = makeDiagram();
    diagram.load([{
        id: 'source', name: 'Source', x: -100, y: 40,
        outPorts: [{ id: 'out', name: 'Out', type: 'number' }],
    }, {
        id: 'sink', name: 'Sink', x: 260, y: 180,
        inPorts: [{ id: 'in', name: 'In', type: 'number' }],
    }], [{ from: 'source', fromPort: 'out', to: 'sink', toPort: 'in' }]);
    diagram.setViewState({ zoom: 1.4, panX: 65, panY: -25, overviewVisible: true });
    diagram.selectNodeById('source');
    diagram.setNodeError('source', 'Transient failure', { animate: false });
    const beforeView = diagram.getViewState();
    const beforeRuntime = diagram.getRuntimeState();
    const beforeSelection = diagram.getSelection();
    let viewEvents = 0;
    diagram.on('viewChanged', () => { viewEvents += 1; });

    const viewport = diagram.takeScreenshot() as unknown as FakeCanvas;
    assert.notEqual(viewport, host.canvas);
    assert.equal(viewport.width, host.canvas!.width);
    assert.equal(viewport.height, host.canvas!.height);
    assert.equal(viewport.drawImageCount, 1);

    const content = diagram.takeScreenshot({
        scope: 'content',
        pixelRatio: 2,
        padding: 20,
        background: '#abcdef',
        includeGrid: false,
        includeOverview: false,
        includeSelection: false,
        includeRuntimeState: false,
    }) as unknown as FakeCanvas;
    assert.ok(content.width > 0 && content.height > 0);
    assert.equal(content.width % 2, 0);
    assert.equal(content.height % 2, 0);
    assert.ok(content.fillStyles.includes('#abcdef'));
    assert.deepEqual(diagram.getViewState(), beforeView);
    assert.deepEqual(diagram.getRuntimeState(), beforeRuntime);
    assert.deepEqual(diagram.getSelection(), beforeSelection);
    assert.equal(viewEvents, 0);
    assert.throws(() => diagram.takeScreenshot({ scope: 'content', pixelRatio: 0 }), /pixelRatio/);
});

test('socket clicks expose mouse actions without starting links on right-click', () => {
    const { diagram, host, fakeWindow } = makeDiagram();
    diagram.load([source, sink], []);
    const renderer = diagram as unknown as {
        findNode(id: string): {
            inPorts: Array<{ cx: number; cy: number }>;
            outPorts: Array<{ cx: number; cy: number }>;
        } | undefined;
        toScreen(x: number, y: number): [number, number];
    };
    const sourcePort = renderer.findNode('source')!.outPorts[0];
    const sinkPort = renderer.findNode('sink')!.inPorts[0];
    const [sourceX, sourceY] = renderer.toScreen(sourcePort.cx, sourcePort.cy);
    const [sinkX, sinkY] = renderer.toScreen(sinkPort.cx, sinkPort.cy);
    const clicks: Array<{ action: string; ctrlKey: boolean; nodeId: string; portId: string }> = [];
    let contextPort: string | null = null;
    diagram.on('portClicked', ({ action, ctrlKey, node, port }) => {
        clicks.push({ action, ctrlKey, nodeId: node.id, portId: port.id });
    });
    diagram.on('contextMenu', ({ port }) => { contextPort = port?.port.id ?? null; });

    host.canvas!.dispatch('pointerdown', {
        clientX: sourceX, clientY: sourceY, pointerId: 1, pointerType: 'mouse', button: 2,
        ctrlKey: true, shiftKey: false, altKey: false, metaKey: false,
    });
    host.canvas!.dispatch('pointermove', { clientX: sinkX, clientY: sinkY });
    fakeWindow.dispatch('pointerup', { clientX: sinkX, clientY: sinkY, shiftKey: false });
    assert.equal(diagram.saveDocument().links.length, 0);
    host.canvas!.dispatch('contextmenu', { clientX: sourceX, clientY: sourceY });
    assert.equal(contextPort, 'out');

    host.canvas!.dispatch('pointerdown', {
        clientX: sourceX, clientY: sourceY, pointerId: 2, pointerType: 'mouse', button: 0,
        ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    });
    host.canvas!.dispatch('pointermove', { clientX: sinkX, clientY: sinkY });
    fakeWindow.dispatch('pointerup', { clientX: sinkX, clientY: sinkY, shiftKey: false });
    assert.equal(diagram.saveDocument().links.length, 1);
    assert.deepEqual(clicks, [{
        action: 'rightClick', ctrlKey: true, nodeId: 'source', portId: 'out',
    }, {
        action: 'leftClick', ctrlKey: false, nodeId: 'source', portId: 'out',
    }]);
});

test('runtime debugger state renders without entering document history', () => {
    const { diagram, host } = makeDiagram();
    diagram.load([source], []);
    const before = diagram.saveDocument();
    const node = diagram.findNode('source')!;
    const port = node.outPorts[0];
    const events: string[] = [];
    diagram.on('runtimeStateChanged', ({ state }) => {
        events.push(state.activeNodeId ?? state.globalError?.kind ?? 'idle');
    });

    assert.equal(diagram.setActiveNode('source'), true);
    assert.equal(diagram.setActiveNode('missing'), false);
    assert.equal(diagram.setPortRuntimeState('source', 'out', 'out', {
        active: true,
        selected: true,
        breakpoint: true,
        breakpointActive: true,
        value: '42.5',
        error: 'Socket calculation failed.',
    }), true);
    assert.equal(diagram.setPortRuntimeState('source', 'out', 'missing', { active: true }), false);
    diagram.setGlobalError('The strategy is encrypted.', 'encrypted');

    const snapshot = diagram.getRuntimeState();
    assert.equal(snapshot.activeNodeId, 'source');
    assert.equal(snapshot.nodes.source.ports.out.out.value, '42.5');
    assert.equal(snapshot.globalError?.kind, 'encrypted');
    snapshot.nodes.source.ports.out.out.value = 'mutated outside';
    assert.equal(diagram.getRuntimeState().nodes.source.ports.out.out.value, '42.5');
    assert.deepEqual(diagram.saveDocument(), before);
    assert.equal(diagram.canUndo(), false);

    const internals = diagram as unknown as {
        draw(): void;
        drawTooltip(): void;
        drawGlobalError(): void;
        hoverPort: { node: typeof node; port: typeof port } | null;
        tipShow: boolean;
        cursor: { x: number; y: number };
    };
    internals.draw();
    assert.ok(host.canvas!.fillStyles.includes('#ffd1dc'));
    assert.ok(host.canvas!.strokeStyles.includes('#f6465d'));
    assert.ok(host.canvas!.drawnText.includes('The strategy is encrypted.'));

    diagram.setGlobalError(null);
    internals.hoverPort = { node, port };
    internals.tipShow = true;
    internals.cursor = { x: 30, y: 30 };
    internals.drawTooltip();
    assert.ok(host.canvas!.drawnText.includes('Value: 42.5'));
    assert.ok(host.canvas!.drawnText.includes('Socket calculation failed.'));
    assert.ok(events.length >= 3);

    diagram.clearRuntimeState();
    assert.deepEqual(diagram.getRuntimeState(), { activeNodeId: null, nodes: {}, globalError: null });
    assert.deepEqual(diagram.saveDocument(), before);
});

test('hovering a node highlights every connected wire like the desktop control', () => {
    const { diagram, host } = makeDiagram();
    diagram.load([source, sink], [
        { from: 'source', fromPort: 'out', to: 'sink', toPort: 'in' },
    ]);
    const internals = diagram as unknown as {
        draw(): void;
        hoverNode: ReturnType<typeof diagram.findNode>;
    };
    host.canvas!.strokeStyles.length = 0;
    internals.hoverNode = diagram.findNode('source');
    internals.draw();

    assert.ok(host.canvas!.strokeStyles.includes('#cfe3ff'));
});

test('runtime errors flash the border and expose tooltip text', () => {
    const { diagram, host } = makeDiagram();
    diagram.load([{ ...source, id: 'failed' }], []);
    const node = diagram.findNode('failed')!;

    assert.equal(diagram.setNodeError('failed', 'Calculation failed.'), true);
    assert.equal(node.runtimeError, 'Calculation failed.');
    assert.notEqual(node.errorFlashStart, null);

    node.errorFlashStart = performance.now() - 2000;
    const internals = diagram as unknown as {
        draw(): void;
        drawTooltip(): void;
        hoverNode: typeof node;
        tipShow: boolean;
        cursor: { x: number; y: number };
    };
    internals.draw();
    assert.equal(node.errorFlashStart, null);
    assert.ok(host.canvas!.strokeStyles.includes('#f6465d'));

    internals.hoverNode = node;
    internals.tipShow = true;
    internals.cursor = { x: 20, y: 20 };
    internals.drawTooltip();
    assert.ok(host.canvas!.drawnText.includes('Calculation failed.'));

    assert.equal(diagram.clearNodeError('failed'), true);
    assert.equal(node.runtimeError, '');
});

test('load errors use a red background and expose tooltip text', () => {
    const { diagram, host } = makeDiagram();
    diagram.load([{ ...source, id: 'damaged', loadError: 'Saved scheme is damaged.' }], []);
    const node = diagram.findNode('damaged')!;

    assert.equal(node.loadError, 'Saved scheme is damaged.');
    const internals = diagram as unknown as {
        draw(): void;
        drawTooltip(): void;
        hoverNode: typeof node;
        tipShow: boolean;
        cursor: { x: number; y: number };
    };
    internals.draw();
    assert.ok(host.canvas!.fillStyles.includes('#7d2632'));
    assert.ok(host.canvas!.strokeStyles.includes('#f6465d'));

    internals.hoverNode = node;
    internals.tipShow = true;
    internals.cursor = { x: 20, y: 20 };
    internals.drawTooltip();
    assert.ok(host.canvas!.drawnText.includes('Saved scheme is damaged.'));

    assert.equal(diagram.clearNodeError('damaged', 'load'), true);
    assert.equal(node.loadError, '');
});

test('complete StockSharpDiagram API loads through the public entry point', async () => {
    installDom();
    const {
        DiagramNode,
        Node,
        Port,
        StockSharpCatalog,
        StockSharpDiagram,
    } = await import('../src/index');

    const catalog = new StockSharpCatalog();
    catalog.addNodeType(new Node({
        id: 'source-type',
        name: 'Source',
        outPorts: [{ id: 'value', name: 'Value', type: 'Decimal' }],
    }));

    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog,
    });
    diagram.load([
        new DiagramNode({
            id: 'high-level',
            typeId: 'source-type',
            name: 'High-level source',
            outPorts: [{ id: 'value', name: 'Value', type: 'Decimal' }],
            x: 25,
            y: 40,
        }),
    ], []);

    assert.equal(diagram.save().nodes[0].name, 'High-level source');
    assert.equal(diagram.updatePort('high-level', 'out', 'value', {
        type: 'Object', maxLinks: 2, availableTypes: ['Any'],
    }), true);
    assert.deepEqual(diagram.save().nodes[0].outPorts[0], new Port({
        id: 'value', name: 'Value', type: 'Object', maxLinks: 2, availableTypes: ['Any'],
    }));
    diagram.undo();
    assert.equal(diagram.save().nodes[0].outPorts[0].type, 'Decimal');
    assert.equal(diagram.save().nodes.length, 1);
});

test('fullscreen button requests host layout changes and reflects acknowledged state', async () => {
    installDom();
    const { StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const host = new FakeHost();
    const previousPosition = host.style.position;
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
        showFullscreenButton: false,
    });

    assert.equal(diagram.isFullscreenButtonVisible(), false);
    assert.equal(host.button?.hidden, true);
    assert.equal(host.button?.style.display, 'none');
    assert.equal(host.button?.getAttribute('data-ssdiagram-fullscreen-button'), '');
    assert.equal(host.style.position, 'relative');

    diagram.setFullscreenButtonVisible(true);
    assert.equal(diagram.isFullscreenButtonVisible(), true);
    assert.equal(host.button?.hidden, false);
    assert.equal(host.button?.style.display, 'inline-flex');

    const button = host.button!;
    const requests: boolean[] = [];
    const changes: boolean[] = [];
    diagram.on('fullscreenRequested', ({ fullscreen }) => requests.push(fullscreen));
    diagram.on('fullscreenChanged', ({ fullscreen }) => changes.push(fullscreen));

    button.dispatch('click');
    assert.deepEqual(requests, [true]);
    assert.deepEqual(changes, []);
    assert.equal(diagram.isFullscreen(), false);
    assert.equal(button.getAttribute('aria-pressed'), 'false');

    diagram.setFullscreenState(true);
    assert.deepEqual(changes, [true]);
    assert.equal(diagram.isFullscreen(), true);
    assert.match(button.className, /is-active/);
    assert.equal(button.getAttribute('aria-label'), 'Exit fullscreen');
    assert.equal(button.getAttribute('aria-pressed'), 'true');

    button.dispatch('click');
    assert.deepEqual(requests, [true, false]);
    assert.equal(diagram.isFullscreen(), true);

    diagram.setFullscreenState(false);
    assert.deepEqual(changes, [true, false]);
    assert.equal(diagram.isFullscreen(), false);
    assert.doesNotMatch(button.className, /is-active/);
    assert.equal(button.getAttribute('aria-label'), 'Enter fullscreen');
    assert.equal(button.getAttribute('aria-pressed'), 'false');

    diagram.destroy();
    assert.equal(button.removed, true);
    assert.equal(host.style.position, previousPosition);
});

test('the fullscreen button speaks the language the host asked for', async () => {
    // The only text the control shows a reader. A host that renders in another language has to be able
    // to say so, or an otherwise translated page carries one English tooltip.
    installDom();
    const { StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
        fullscreenLabels: { enter: 'Развернуть', exit: 'Свернуть' },
    });

    const button = host.button!;
    assert.equal(button.getAttribute('aria-label'), 'Развернуть');

    diagram.setFullscreenState(true);
    assert.equal(button.getAttribute('aria-label'), 'Свернуть');

    // Changed after the fact -- a page that switches language without reloading.
    diagram.setFullscreenLabels({ enter: 'Enter fullscreen', exit: 'Exit fullscreen' });
    assert.equal(button.getAttribute('aria-label'), 'Exit fullscreen');

    diagram.setFullscreenState(false);
    assert.equal(button.getAttribute('aria-label'), 'Enter fullscreen');

    diagram.destroy();
});

test('high-level move and zoom methods update the real canvas state', async () => {
    installDom();
    const {
        DiagramNode,
        StockSharpCatalog,
        StockSharpDiagram,
    } = await import('../src/index');
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    diagram.load([new DiagramNode({ id: 'node', name: 'Node', x: 10, y: 20 })], []);

    diagram.moveNode('node', 150, -25);
    diagram.setZoom(1.75);

    assert.equal(diagram.getViewState().zoom, 1.75);
    assert.equal(diagram.save().nodes[0].x, 150);
    assert.equal(diagram.save().nodes[0].y, -25);
    const image = diagram.takeScreenshot({ scope: 'content', pixelRatio: 1 });
    assert.ok(image.width > 0 && image.height > 0);
});

test('high-level view settings persist separately and report viewport changes', async () => {
    installDom();
    const {
        DiagramViewStateError,
        StockSharpCatalog,
        StockSharpDiagram,
    } = await import('../src/index');
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    const changes: Array<{ zoom: number; panX: number; panY: number; overviewVisible: boolean }> = [];
    diagram.on('viewChanged', (state) => changes.push(state));
    diagram.setViewState({ zoom: 1.5, panX: -80, panY: 25, overviewVisible: false });

    const persisted = diagram.saveViewState();
    diagram.setViewState({ zoom: 1, panX: 0, panY: 0, overviewVisible: true });
    diagram.loadViewState(persisted);
    assert.deepEqual(diagram.getViewState(), {
        zoom: 1.5, panX: -80, panY: 25, overviewVisible: false,
    });
    assert.equal(JSON.parse(persisted).version, 1);
    assert.deepEqual(changes.at(-1), diagram.getViewState());

    const before = diagram.getViewState();
    assert.throws(() => diagram.loadViewState({
        version: 1,
        view: { zoom: 'invalid', panX: 0, panY: 0, overviewVisible: true },
    }), DiagramViewStateError);
    assert.deepEqual(diagram.getViewState(), before);
});

test('interactive panning emits one settled viewChanged event', () => {
    const { diagram, host, fakeWindow } = makeDiagram();
    const views: Array<{ panX: number; panY: number }> = [];
    diagram.on('viewChanged', ({ panX, panY }) => views.push({ panX, panY }));

    host.canvas!.dispatch('pointerdown', {
        clientX: 100, clientY: 100, pointerId: 1, pointerType: 'mouse', button: 1,
        shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
    });
    host.canvas!.dispatch('pointermove', { clientX: 145, clientY: 125 });
    fakeWindow.dispatch('pointerup', { clientX: 145, clientY: 125, shiftKey: false });

    assert.deepEqual(views, [{ panX: 45, panY: 25 }]);
});

test('high-level persistent edits use canvas history without capturing runtime errors', async () => {
    installDom();
    const {
        DiagramNode,
        StockSharpCatalog,
        StockSharpDiagram,
    } = await import('../src/index');
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    diagram.load([new DiagramNode({ id: 'node', name: 'Node' })], []);
    diagram.setNodeError('node', 'Runtime failure');

    diagram.setNodeParamValue('node', 'Period', '20');
    assert.equal(diagram.canUndo(), true);
    assert.deepEqual(diagram.save().nodes[0].paramValues, { Period: '20' });

    diagram.undo();
    assert.deepEqual(diagram.save().nodes[0].paramValues, {});
    assert.equal(diagram.getRuntimeState().nodes.node.errors.runtime?.message, 'Runtime failure');

    diagram.redo();
    assert.deepEqual(diagram.save().nodes[0].paramValues, { Period: '20' });
    assert.equal(diagram.getRuntimeState().nodes.node.errors.runtime?.message, 'Runtime failure');
});

test('high-level transaction groups property edits and rolls them back on failure', async () => {
    installDom();
    const {
        DiagramNode,
        StockSharpCatalog,
        StockSharpDiagram,
    } = await import('../src/index');
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    diagram.load([new DiagramNode({ id: 'node', name: 'Node' })], []);

    const result = diagram.transaction('update properties', () => {
        diagram.setNodeName('node', 'Configured node');
        diagram.setNodeParamValue('node', 'Period', '20');
        return 42;
    });
    assert.equal(result, 42);
    assert.equal(diagram.save().nodes[0].name, 'Configured node');
    assert.deepEqual(diagram.save().nodes[0].paramValues, { Period: '20' });

    diagram.undo();
    assert.equal(diagram.save().nodes[0].name, 'Node');
    assert.deepEqual(diagram.save().nodes[0].paramValues, {});
    diagram.redo();
    assert.equal(diagram.save().nodes[0].name, 'Configured node');
    assert.deepEqual(diagram.save().nodes[0].paramValues, { Period: '20' });

    assert.throws(() => diagram.transaction('broken properties', () => {
        diagram.setNodeName('node', 'Half applied');
        diagram.setNodeParamValue('node', 'Period', '50');
        throw new Error('host validation failed');
    }), /host validation failed/);
    assert.equal(diagram.save().nodes[0].name, 'Configured node');
    assert.deepEqual(diagram.save().nodes[0].paramValues, { Period: '20' });
});

test('context command registry executes built-ins and leaves host actions typed', async () => {
    installDom();
    const {
        DiagramNode,
        Link,
        StockSharpCatalog,
        StockSharpDiagram,
    } = await import('../src/index');
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    diagram.load([
        new DiagramNode({
            id: 'source',
            name: 'Source',
            openAction: 'settings',
            outPorts: [{ id: 'out', name: 'Out' }],
        }),
        new DiagramNode({
            id: 'sink',
            name: 'Sink',
            inPorts: [{ id: 'in', name: 'In' }],
        }),
    ], [new Link({ outNode: 'source', outPort: 'out', inNode: 'sink', inPort: 'in' })]);
    diagram.selectNodes(['source']);

    const states = commandStates(diagram.getContextCommands());
    assert.equal(states.get('copy'), true);
    assert.equal(states.get('delete'), true);
    assert.equal(states.get('open'), true);
    assert.equal(states.get('paste'), false);

    const executed: string[] = [];
    const properties: string[] = [];
    diagram.on('contextCommand', ({ command }) => executed.push(command));
    diagram.on('nodeProperties', ({ nodes }) => properties.push(nodes[0].id));
    assert.equal(diagram.executeContextCommand('copy'), true);
    assert.equal(diagram.executeContextCommand('properties'), true);
    assert.deepEqual(executed, ['copy', 'properties']);
    assert.deepEqual(properties, ['source']);
    assert.equal(commandStates(diagram.getContextCommands()).get('paste'), true);

    const linkId = diagram.saveDocument().links[0].id;
    diagram.selectLink(linkId);
    assert.equal(diagram.executeContextCommand('delete'), true);
    assert.equal(diagram.saveDocument().links.length, 0);
    diagram.undo();
    assert.equal(diagram.saveDocument().links[0].id, linkId);

    diagram.setReadOnly(true);
    diagram.selectNodes(['source']);
    const readOnlyStates = commandStates(diagram.getContextCommands());
    assert.equal(readOnlyStates.get('copy'), true);
    assert.equal(readOnlyStates.get('open'), true);
    assert.equal(readOnlyStates.get('delete'), false);
    assert.equal(readOnlyStates.get('paste'), false);
});

test('system clipboard transfers a lossless document and pastes as one transaction', async () => {
    installDom();
    const {
        StockSharpCatalog,
        StockSharpDiagram,
        createDiagramDocument,
        parseDiagramDocument,
    } = await import('../src/index');
    let clipboardText = '';
    const clipboard = {
        readText: async () => clipboardText,
        writeText: async (value: string) => { clipboardText = value; },
    };
    const sourceHost = new FakeHost();
    const sourceDiagram = new StockSharpDiagram({
        div: sourceHost as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
        clipboard,
    });
    sourceDiagram.loadDocument(createDiagramDocument({
        nodes: [{
            id: 'source',
            name: 'Source',
            outPorts: [{ id: 'out', name: 'Out', metadata: { hostPortId: 1 } }],
            paramValues: { Period: '20' },
            metadata: { hostNodeId: 2 },
        }, {
            id: 'sink',
            name: 'Sink',
            inPorts: [{ id: 'in', name: 'In' }],
        }],
        links: [{
            id: 'original-link',
            from: { nodeId: 'source', portId: 'out' },
            to: { nodeId: 'sink', portId: 'in' },
            metadata: { hostLinkId: 3 },
        }],
    }));
    sourceDiagram.selectNodes(['source', 'sink']);
    assert.equal(await sourceDiagram.copySelectionToClipboard(), true);
    assert.equal(parseDiagramDocument(clipboardText).nodes.length, 2);

    const targetHost = new FakeHost();
    const targetDiagram = new StockSharpDiagram({
        div: targetHost as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
        clipboard,
    });
    assert.equal(await targetDiagram.pasteSelectionFromClipboard(), true);

    const pasted = targetDiagram.saveDocument();
    assert.equal(pasted.nodes.length, 2);
    assert.equal(pasted.links.length, 1);
    assert.deepEqual(pasted.nodes[0].metadata, { hostNodeId: 2 });
    assert.deepEqual(pasted.nodes[0].outPorts[0].metadata, { hostPortId: 1 });
    assert.deepEqual(pasted.nodes[0].paramValues, { Period: '20' });
    assert.deepEqual(pasted.links[0].metadata, { hostLinkId: 3 });

    targetDiagram.undo();
    assert.equal(targetDiagram.saveDocument().nodes.length, 0);
    assert.equal(targetDiagram.saveDocument().links.length, 0);
});

test('high-level versioned document API preserves host metadata', async () => {
    installDom();
    const {
        StockSharpCatalog,
        StockSharpDiagram,
        createDiagramDocument,
    } = await import('../src/index');
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    const document = createDiagramDocument({
        metadata: { owner: 'Designer' },
        nodes: [{
            id: 'node',
            name: 'Node',
            outPorts: [{ id: 'out', name: 'Out', metadata: { socket: 1 } }],
            metadata: { element: 2 },
        }],
    });

    diagram.loadDocument(document);

    assert.deepEqual(diagram.saveDocument(), document);
});

test('failed document load keeps the current scheme and exposes a global load error', async () => {
    installDom();
    const {
        StockSharpCatalog,
        StockSharpDiagram,
        createDiagramDocument,
    } = await import('../src/index');
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    const valid = createDiagramDocument({ nodes: [{ id: 'safe', name: 'Safe scheme' }] });
    diagram.loadDocument(valid);
    const before = diagram.saveDocument();
    const failures: string[] = [];
    diagram.on('documentLoadFailed', ({ message }) => failures.push(message));

    assert.throws(() => diagram.loadDocument('{ broken json'), /JSON/i);
    assert.deepEqual(diagram.saveDocument(), before);
    assert.equal(diagram.getRuntimeState().globalError?.kind, 'load');
    assert.equal(failures.length, 1);
    diagram.loadDocument(valid);
    assert.equal(diagram.getRuntimeState().globalError, null);
});

test('high-level host receives opt-in nodeOpen', async () => {
    installDom();
    const {
        DiagramNode,
        Node,
        StockSharpCatalog,
        StockSharpDiagram,
    } = await import('../src/index');

    const catalog = new StockSharpCatalog();
    catalog.addNodeType(new Node({
        id: 'indicator',
        name: 'Indicator',
        openAction: 'indicatorSettings',
    }));
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({ div: host as unknown as HTMLElement, catalog });
    diagram.load([new DiagramNode({
        id: 'indicator-1',
        typeId: 'indicator',
        name: 'SMA (20)',
        openAction: 'indicatorSettings',
        x: 50,
        y: 50,
    })], []);

    const opened: string[] = [];
    diagram.on('nodeOpen', ({ nodes }) => opened.push(nodes[0].openAction));
    diagram.selectNodes(['indicator-1']);
    assert.equal(diagram.executeContextCommand('open'), true);
    assert.deepEqual(opened, ['indicatorSettings']);
});

test('high-level host can apply and clear runtime node errors', async () => {
    installDom();
    const {
        DiagramNode,
        StockSharpCatalog,
        StockSharpDiagram,
    } = await import('../src/index');

    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    diagram.load([new DiagramNode({
        id: 'failed',
        name: 'Order Builder',
        x: 50,
        y: 50,
        outPorts: [{ id: 'orders', name: 'Orders', type: 'Order' }],
    })], []);

    assert.equal(diagram.setNodeError('failed', 'Calculation failed.'), true);
    assert.equal(diagram.getRuntimeState().nodes.failed.errors.runtime?.message, 'Calculation failed.');
    let runtimeEvents = 0;
    diagram.on('runtimeStateChanged', () => { runtimeEvents += 1; });
    assert.equal(diagram.setActiveNode('failed'), true);
    assert.equal(diagram.setPortRuntimeState('failed', 'out', 'orders', {
        breakpoint: true, value: 'Buy 1',
    }), true);
    diagram.setGlobalError('Debugger paused.', 'locked');
    assert.equal(diagram.getRuntimeState().nodes.failed.ports.out.orders.value, 'Buy 1');
    assert.equal(diagram.getRuntimeState().globalError?.kind, 'locked');
    assert.ok(runtimeEvents >= 3);
    assert.equal(diagram.clearNodeError('failed'), true);
    assert.deepEqual(diagram.getRuntimeState().nodes.failed.errors, {});
    diagram.clearRuntimeState();
    assert.deepEqual(diagram.getRuntimeState(), { activeNodeId: null, nodes: {}, globalError: null });
});

test('high-level load errors remain transient', async () => {
    installDom();
    const {
        DiagramNode,
        StockSharpCatalog,
        StockSharpDiagram,
    } = await import('../src/index');

    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    diagram.load([new DiagramNode({
        id: 'damaged',
        name: 'Slow SMA',
        x: 50,
        y: 50,
    })], [], {
        nodeErrors: { damaged: 'Period could not be restored.' },
    });

    assert.equal(
        diagram.getRuntimeState().nodes.damaged.errors.load?.message,
        'Period could not be restored.',
    );
    assert.equal(diagram.save().nodes[0].message, '');
});

test('high-level load/save preserves the complete Designer node contract', async () => {
    installDom();
    const {
        DiagramNode,
        Link,
        StockSharpCatalog,
        StockSharpDiagram,
    } = await import('../src/index');

    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    const node = new DiagramNode({
        id: 'indicator-1',
        typeId: 'indicator',
        name: 'SMA (20)',
        description: 'Simple moving average',
        groupName: 'Indicators',
        icon: 'data:image/svg+xml;base64,PHN2Zy8+',
        openAction: 'indicatorSettings',
        color: '#102030',
        border: '#405060',
        x: 125.5,
        y: -42.25,
        inPorts: [{
            id: 'source',
            name: 'Source',
            description: 'Input values',
            type: 'Decimal',
            maxLinks: 1,
            availableTypes: ['Decimal', 'Double'],
            isDynamic: true,
            dynamicMode: 'onConnect',
            isSibling: true,
        }],
        outPorts: [{
            id: 'result',
            name: 'Result',
            description: 'Calculated value',
            type: 'Decimal',
            maxLinks: 2,
        }],
        parameters: [{
            name: 'Period',
            displayName: 'Period',
            description: 'Number of values',
            type: 'number',
            defaultValue: '20',
            options: ['10', '20', '50'],
            min: 1,
            max: 1000,
            displayOrder: 10,
            category: 'General',
            isBasic: true,
            editorType: 'Int32Editor',
        }],
        paramValues: { Period: '34' },
    });

    diagram.load([node], [new Link({
        outNode: 'indicator-1',
        outPort: 'result',
        inNode: 'indicator-1',
        inPort: 'source',
    })]);

    const saved = diagram.save();
    assert.equal(saved.nodes.length, 1);
    assert.deepEqual(saved.nodes[0], node);
    assert.deepEqual(saved.links[0], new Link({
        outNode: 'indicator-1',
        outPort: 'result',
        inNode: 'indicator-1',
        inPort: 'source',
    }));
});

test('a node keeps its load error when a runtime error is reported on top of it', () => {
    const { diagram } = makeDiagram();
    diagram.load([{ ...source, id: 'damaged', loadError: 'Saved scheme is damaged.' }], []);
    const node = diagram.findNode('damaged')!;

    assert.equal(diagram.setNodeError('damaged', 'Division by zero.'), true);
    assert.equal(node.loadError, 'Saved scheme is damaged.');
    assert.equal(node.runtimeError, 'Division by zero.');

    // Both kinds have to survive in the serializable state, otherwise the very
    // next state write projects the missing one away.
    const state = diagram.getRuntimeState();
    assert.equal(state.nodes.damaged.errors.load?.message, 'Saved scheme is damaged.');
    assert.equal(state.nodes.damaged.errors.runtime?.message, 'Division by zero.');

    // setActiveNode goes through getRuntimeState -> mutate -> setRuntimeState
    // internally, so the round-trip is not something the host has to ask for.
    assert.equal(diagram.setActiveNode('damaged'), true);
    assert.equal(node.loadError, 'Saved scheme is damaged.');
    assert.equal(node.runtimeError, 'Division by zero.');

    diagram.setRuntimeState(diagram.getRuntimeState());
    assert.equal(node.loadError, 'Saved scheme is damaged.');
    assert.equal(node.runtimeError, 'Division by zero.');

    // Clearing one kind leaves the other in place.
    assert.equal(diagram.clearNodeError('damaged', 'runtime'), true);
    assert.equal(node.runtimeError, '');
    assert.equal(node.loadError, 'Saved scheme is damaged.');
    assert.equal(diagram.getRuntimeState().nodes.damaged.errors.load?.message, 'Saved scheme is damaged.');
    assert.equal(diagram.getRuntimeState().nodes.damaged.errors.runtime, undefined);
});

test('every context command in the public union is actually offered by the menu', async () => {
    installDom();
    const { StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const diagram = new StockSharpDiagram({
        div: new FakeHost() as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });

    // Registration alone is no longer enough: the menu is laid out separately so a
    // submenu can exist, so a command can now be registered and still never offered.
    // Walking the tree is what proves both halves line up.
    const offered: string[] = [];
    for (const item of diagram.getContextCommands()) {
        if ('group' in item) offered.push(...item.commands.map(({ command }) => command));
        else offered.push(item.command);
    }

    assert.deepEqual(offered.slice().sort(), [
        'copy', 'cut', 'delete', 'exportDocument', 'exportPng', 'exportSvg',
        'help', 'open', 'overview', 'paste', 'properties', 'redo', 'undo',
    ]);
    assert.equal(new Set(offered).size, offered.length, 'a command listed twice would run from two menu entries');
});

test('the export submenu offers document, png and svg, and leaves the work to the host', async () => {
    installDom();
    const { DiagramNode, StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const diagram = new StockSharpDiagram({
        div: new FakeHost() as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    diagram.load([new DiagramNode({ id: 'source', name: 'Source' })], []);

    const submenu = diagram.getContextCommands().find((item) => 'group' in item && item.group === 'export');
    assert.ok(submenu !== undefined && 'group' in submenu, 'the export submenu is missing from the menu');
    assert.deepEqual(submenu.commands.map(({ command }) => command), ['exportDocument', 'exportPng', 'exportSvg']);
    assert.equal(submenu.enabled, true);

    // Same contract as properties: the control reports the request and produces nothing
    // itself, because only the host knows where the file is supposed to end up.
    const formats: string[] = [];
    const commands: string[] = [];
    diagram.on('exportRequested', ({ format }) => formats.push(format));
    diagram.on('contextCommand', ({ command }) => commands.push(command));

    const before = JSON.stringify(diagram.saveDocument());
    assert.equal(diagram.executeContextCommand('exportDocument'), true);
    assert.equal(diagram.executeContextCommand('exportPng'), true);
    assert.equal(diagram.executeContextCommand('exportSvg'), true);

    assert.deepEqual(formats, ['document', 'png', 'svg']);
    assert.deepEqual(commands, ['exportDocument', 'exportPng', 'exportSvg']);
    assert.equal(JSON.stringify(diagram.saveDocument()), before, 'asking for an export must not change the diagram');
});

test('an empty diagram has nothing to export, and refuses rather than firing a request', async () => {
    installDom();
    const { DiagramNode, StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const diagram = new StockSharpDiagram({
        div: new FakeHost() as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });

    let requests = 0;
    diagram.on('exportRequested', () => { requests += 1; });

    const empty = commandStates(diagram.getContextCommands());
    assert.equal(empty.get('exportPng'), false);
    assert.equal(empty.get('export'), false, 'a submenu whose every item is dead should not invite a click');

    // A greyed item a host sends back anyway must still do nothing, or the disabled
    // state is only a suggestion and the host becomes responsible for enforcing it.
    assert.equal(diagram.executeContextCommand('exportPng'), false);
    assert.equal(requests, 0);

    diagram.load([new DiagramNode({ id: 'source', name: 'Source' })], []);
    const filled = commandStates(diagram.getContextCommands());
    assert.equal(filled.get('export'), true);
    assert.equal(filled.get('exportDocument'), true);
    assert.equal(filled.get('exportSvg'), true);
});

test('export survives read-only, because exporting only reads', async () => {
    installDom();
    const { DiagramNode, StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const diagram = new StockSharpDiagram({
        div: new FakeHost() as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    diagram.load([new DiagramNode({ id: 'source', name: 'Source' })], []);
    diagram.selectNodes(['source']);
    diagram.setReadOnly(true);

    const states = commandStates(diagram.getContextCommands());
    assert.equal(states.get('exportDocument'), true);
    assert.equal(states.get('exportPng'), true);
    assert.equal(states.get('export'), true);
    // The contrast that proves read-only actually took hold.
    assert.equal(states.get('delete'), false);
});

function menuItems(menu: FakeElement): FakeElement[] {
    return menu.descendants().filter((element) => element.className === 'ssdiagram-context-menu-item');
}

function menuItem(menu: FakeElement, text: string): FakeElement {
    const found = menuItems(menu).find((element) => element.text() === text);
    if (found === undefined) {
        throw new Error(`No menu item "${text}". Present: ${menuItems(menu).map((e) => e.text()).join(' | ')}`);
    }
    return found;
}

test('right-clicking opens the control own menu and picking an item runs the command', async () => {
    installDom();
    const { DiagramNode, StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    diagram.load([new DiagramNode({ id: 'source', name: 'Source', x: 40, y: 40 })], []);
    diagram.selectNodes(['source']);

    assert.equal(host.menu(), null, 'nothing should be on screen before the click');
    host.canvas?.dispatch('contextmenu', { clientX: 60, clientY: 60 });

    const menu = host.menu();
    assert.ok(menu !== null, 'right-click left the browser menu suppressed and put nothing in its place');
    assert.deepEqual(
        menuItems(menu).map((item) => item.text()),
        ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Open', 'Delete',
            'Export as', 'Scheme', 'PNG image', 'SVG image', 'Overview', 'Properties', 'Help'],
    );

    const executed: string[] = [];
    diagram.on('contextCommand', ({ command }) => executed.push(command));
    menuItem(menu, 'Copy').dispatch('click');

    assert.deepEqual(executed, ['copy']);
    assert.equal(host.menu(), null, 'the menu should close once something was picked');
});

test('the built-in menu opens the export submenu and reports the chosen format', async () => {
    installDom();
    const { DiagramNode, StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    diagram.load([new DiagramNode({ id: 'source', name: 'Source', x: 40, y: 40 })], []);
    host.canvas?.dispatch('contextmenu', { clientX: 60, clientY: 60 });

    const menu = host.menu();
    assert.ok(menu !== null);
    const submenu = menu.descendants().find((element) => element.className === 'ssdiagram-context-menu-submenu');
    assert.ok(submenu !== undefined, 'the export entry has no submenu');
    assert.equal(submenu.style.display, 'none', 'a submenu should stay shut until it is pointed at');

    menuItem(menu, 'Export as').dispatch('pointerenter');
    assert.equal(submenu.style.display, 'block');

    const formats: string[] = [];
    diagram.on('exportRequested', ({ format }) => formats.push(format));
    menuItem(menu, 'SVG image').dispatch('click');

    assert.deepEqual(formats, ['svg']);
    assert.equal(host.menu(), null);
});

test('the export submenu stays open while the pointer moves onto it', async () => {
    installDom();
    const { DiagramNode, StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    diagram.load([new DiagramNode({ id: 'source', name: 'Source', x: 40, y: 40 })], []);
    host.canvas?.dispatch('contextmenu', { clientX: 60, clientY: 60 });

    const menu = host.menu();
    assert.ok(menu !== null);
    const submenu = menu.descendants().find((element) => element.className === 'ssdiagram-context-menu-submenu');
    assert.ok(submenu !== undefined);

    menuItem(menu, 'Export as').dispatch('pointerenter');
    assert.equal(submenu.style.display, 'block');

    // Reaching an item means the pointer crosses into the submenu. If entering an item shut
    // the panel it sits in, the submenu would vanish under the pointer and drop it onto the
    // canvas -- which is what happens when submenu items are wired like top-level ones.
    menuItem(menu, 'PNG image').dispatch('pointerenter');
    assert.equal(submenu.style.display, 'block', 'the submenu closed itself as soon as it was pointed at');

    const formats: string[] = [];
    diagram.on('exportRequested', ({ format }) => formats.push(format));
    menuItem(menu, 'PNG image').dispatch('click');
    assert.deepEqual(formats, ['png']);
});

test('moving back to a plain item shuts the export submenu', async () => {
    installDom();
    const { DiagramNode, StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    diagram.load([new DiagramNode({ id: 'source', name: 'Source', x: 40, y: 40 })], []);
    host.canvas?.dispatch('contextmenu', { clientX: 60, clientY: 60 });

    const menu = host.menu();
    assert.ok(menu !== null);
    const submenu = menu.descendants().find((element) => element.className === 'ssdiagram-context-menu-submenu');
    assert.ok(submenu !== undefined);

    menuItem(menu, 'Export as').dispatch('pointerenter');
    assert.equal(submenu.style.display, 'block');
    menuItem(menu, 'Copy').dispatch('pointerenter');
    assert.equal(submenu.style.display, 'none', 'an open submenu should not outlive the pointer leaving it');
});

test('the menu uses host translations supplied after the bundle was loaded', async () => {
    installDom();
    // The order that loses if the bundle is snapshotted at import: script tag first, host
    // translations second. It is also the only order a host can manage for a lazily loaded
    // chunk, so it has to be the one that works.
    (globalThis.window as unknown as { __designerI18n?: Record<string, string> }).__designerI18n = {
        copy: 'Копировать',
        ctxDelete: 'Удалить',
        ctxExportAs: 'Экспортировать как',
        ctxExportSvg: 'Изображение SVG',
        ctxOpen: '',
    };

    const { DiagramNode, StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    diagram.load([new DiagramNode({ id: 'source', name: 'Source', x: 40, y: 40 })], []);
    host.canvas?.dispatch('contextmenu', { clientX: 60, clientY: 60 });

    const menu = host.menu();
    assert.ok(menu !== null);
    const labels = menuItems(menu).map((item) => item.text());

    assert.ok(labels.includes('Копировать'), `copy was not translated: ${labels.join(' | ')}`);
    assert.ok(labels.includes('Удалить'), 'delete has no key of its own in the diagram menu section');
    assert.ok(labels.includes('Экспортировать как'), 'the submenu title was not translated');
    assert.ok(labels.includes('Изображение SVG'), 'a submenu item was not translated');
    // An incomplete export leaves keys present but blank. A blank menu entry is worse than
    // an untranslated one, so an empty string counts as missing.
    assert.ok(labels.includes('Open'), 'an empty translation blanked the item instead of falling back');
    // Untouched keys keep the English fallback.
    assert.ok(labels.includes('Paste'));
});

test('overview is a toggle, and the menu reports its state rather than offering two entries', async () => {
    installDom();
    const { StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });

    const overview = (): { enabled: boolean; checked?: boolean } => {
        const item = diagram.getContextCommands().find((entry) => !('group' in entry) && entry.command === 'overview');
        assert.ok(item !== undefined && !('group' in item), 'overview is missing from the menu');
        return item;
    };

    assert.equal(diagram.getViewState().overviewVisible, true);
    assert.equal(overview().checked, true, 'the state has to travel with the command, or a menu cannot tick it');
    assert.equal(overview().enabled, true);

    assert.equal(diagram.executeContextCommand('overview'), true);
    assert.equal(diagram.getViewState().overviewVisible, false);
    assert.equal(overview().checked, false);

    // Toggling back is the same command: two show/hide entries would leave one dead at all times.
    assert.equal(diagram.executeContextCommand('overview'), true);
    assert.equal(diagram.getViewState().overviewVisible, true);
    assert.equal(overview().checked, true);

    // Commands that do not toggle carry no state at all, so a menu can tell them apart.
    const copy = diagram.getContextCommands().find((entry) => !('group' in entry) && entry.command === 'copy');
    assert.ok(copy !== undefined && !('group' in copy));
    assert.equal(copy.checked, undefined);
});

test('the built-in menu ticks the overview entry and keeps the captions aligned', async () => {
    installDom();
    const { StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });

    host.canvas?.dispatch('contextmenu', { clientX: 60, clientY: 60 });
    let menu = host.menu();
    assert.ok(menu !== null);
    const tick = (item: FakeElement): string =>
        item.children.find((child) => child.className === 'ssdiagram-context-menu-check')?.textContent ?? '(no gutter)';

    assert.equal(tick(menuItem(menu, 'Overview')), '✓');
    // Every row gets the gutter, otherwise the ticked one would sit further in than the rest.
    assert.equal(tick(menuItem(menu, 'Copy')), '');
    assert.equal(menuItem(menu, 'Overview').getAttribute('aria-checked'), 'true');
    assert.equal(menuItem(menu, 'Copy').getAttribute('role'), 'menuitem');
    assert.equal(menuItem(menu, 'Overview').getAttribute('role'), 'menuitemcheckbox');

    menuItem(menu, 'Overview').dispatch('click');
    assert.equal(diagram.getViewState().overviewVisible, false);

    host.canvas?.dispatch('contextmenu', { clientX: 60, clientY: 60 });
    menu = host.menu();
    assert.ok(menu !== null);
    assert.equal(tick(menuItem(menu, 'Overview')), '');
    assert.equal(menuItem(menu, 'Overview').getAttribute('aria-checked'), 'false');
});

test('the fullscreen button follows the same bundle as the menu', async () => {
    installDom();
    const bundle = (globalThis.window as unknown as { __designerI18n?: Record<string, string> });
    bundle.__designerI18n = { fullscreenEnter: '进入全屏', fullscreenExit: '退出全屏' };

    const { StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });

    // The whole point of one bundle: a page that translated the menu should not have to name
    // this button separately through a second mechanism.
    assert.equal(diagram.getFullscreenLabels().enter, '进入全屏');
    assert.equal(host.button?.title, '进入全屏');

    // Drawn once, so it needs telling when the language moves; the menu does not.
    bundle.__designerI18n = { fullscreenEnter: 'Vollbild' };
    diagram.refreshLabels();
    assert.equal(host.button?.title, 'Vollbild');

    // An explicit label still wins -- that is what an embedded diagram's data-diagram-fullscreen
    // becomes, and a per-instance choice must not be overridden by a page-wide default.
    diagram.setFullscreenLabels({ enter: 'Expand', exit: 'Collapse' });
    assert.equal(host.button?.title, 'Expand');
    diagram.refreshLabels();
    assert.equal(host.button?.title, 'Expand', 'a refresh must not discard the explicit label');
});

test('a greyed item in the built-in menu is inert, not merely grey', async () => {
    installDom();
    const { StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    host.canvas?.dispatch('contextmenu', { clientX: 60, clientY: 60 });

    const menu = host.menu();
    assert.ok(menu !== null);
    const paste = menuItem(menu, 'Paste');
    assert.equal(paste.disabled, true, 'an empty clipboard should leave paste disabled');

    let executed = 0;
    diagram.on('contextCommand', () => { executed += 1; });
    paste.dispatch('click');

    assert.equal(executed, 0);
    assert.ok(host.menu() !== null, 'a dead item should not even dismiss the menu');
});

test('a host that draws its own menu turns ours off and still gets the event', async () => {
    installDom();
    const { StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
        showContextMenu: false,
    });

    let requests = 0;
    diagram.on('contextMenuRequested', () => { requests += 1; });
    host.canvas?.dispatch('contextmenu', { clientX: 60, clientY: 60 });

    assert.equal(diagram.isContextMenuEnabled(), false);
    assert.equal(host.menu(), null, 'the built-in menu was switched off');
    assert.equal(requests, 1, 'switching the menu off must not cost the host its event');

    // And back on again, because a host may only want its own menu some of the time.
    diagram.setContextMenuEnabled(true);
    host.canvas?.dispatch('contextmenu', { clientX: 60, clientY: 60 });
    assert.ok(host.menu() !== null);
    assert.equal(requests, 2);
});

test('the built-in menu is dismissed by a click elsewhere and by destroy', async () => {
    installDom();
    const { StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const owner = globalThis.document as unknown as FakeElement;
    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });

    host.canvas?.dispatch('contextmenu', { clientX: 60, clientY: 60 });
    const menu = host.menu();
    assert.ok(menu !== null);

    // A press inside the menu is a press on the way to picking something.
    owner.dispatch('pointerdown', { target: menuItem(menu, 'Copy') });
    assert.ok(host.menu() !== null, 'pressing inside the menu closed it');

    owner.dispatch('pointerdown', { target: host.canvas });
    assert.equal(host.menu(), null, 'a press outside should dismiss the menu');

    host.canvas?.dispatch('contextmenu', { clientX: 60, clientY: 60 });
    assert.ok(host.menu() !== null);
    diagram.destroy();
    assert.equal(host.menu(), null, 'destroy left a menu behind');
});

test('a submenu label is not a command', async () => {
    installDom();
    const { DiagramNode, StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const diagram = new StockSharpDiagram({
        div: new FakeHost() as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    diagram.load([new DiagramNode({ id: 'source', name: 'Source' })], []);

    let fired = 0;
    diagram.on('contextCommand', () => { fired += 1; });

    // 'export' names a submenu. TypeScript keeps it out of ContextCommand, but a host
    // in plain JavaScript can still send it back, and clicking a submenu label must not
    // be mistaken for choosing one of the items inside it.
    assert.equal(diagram.executeContextCommand('export' as never), false);
    assert.equal(fired, 0);
});

test('registerAll keeps class-based actions working', async () => {
    const { DiagramActionRegistry } = await import('../src/index');
    class Undo {
        calls = 0;
        canExecute(): boolean { return true; }
        execute(): void { this.calls += 1; }
    }
    const undo = new Undo();
    const registry = new DiagramActionRegistry<'undo', void>();

    // A spread would copy the own fields and drop the prototype methods, so the
    // registration would type-check and then throw on the first use.
    registry.registerAll({ undo });

    assert.equal(registry.canExecute('undo', undefined), true);
    assert.equal(registry.execute('undo', undefined), true);
    assert.equal(undo.calls, 1);
    assert.deepEqual(registry.states(undefined), [{ id: 'undo', enabled: true }]);
});

test('mutators report whether they found their target instead of returning void', async () => {
    installDom();
    const { DiagramNode, Port, StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const diagram = new StockSharpDiagram({
        div: new FakeHost() as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    diagram.load([new DiagramNode({
        id: 'node',
        name: 'Node',
        inPorts: [{ id: 'in', name: 'In', type: 'Candle' }],
    })], []);

    const port = new Port({ id: 'extra', name: 'Extra', type: 'Candle' });
    assert.equal(diagram.addPort('node', 'in', port), true);
    assert.equal(diagram.addPort('missing', 'in', port), false);
    assert.equal(diagram.removePort('node', 'in', 'extra'), true);
    assert.equal(diagram.removePort('missing', 'in', 'extra'), false);
    assert.equal(diagram.updatePortType('node', 'in', 'in', 'Decimal'), true);
    assert.equal(diagram.updatePortType('missing', 'in', 'in', 'Decimal'), false);
    assert.equal(diagram.setNodePorts('node', [], []), true);
    assert.equal(diagram.setNodePorts('missing', [], []), false);
    assert.equal(diagram.updateNode('node', { name: 'Renamed' }), true);
    assert.equal(diagram.updateNode('missing', { name: 'Renamed' }), false);
    assert.equal(diagram.setNodeMessage('node', 'Note'), true);
    assert.equal(diagram.setNodeMessage('missing', 'Note'), false);
    assert.equal(diagram.setNodeParamValue('node', 'Period', '20'), true);
    assert.equal(diagram.setNodeParamValue('missing', 'Period', '20'), false);
    assert.equal(diagram.setNodeName('node', 'Renamed again'), true);
    assert.equal(diagram.setNodeName('missing', 'Renamed again'), false);
});

test('the catalog hands out copies of its node types, never the stored ones', async () => {
    const { Node, StockSharpCatalog } = await import('../src/index');
    const catalog = new StockSharpCatalog();
    catalog.addNodeType(new Node({
        id: 'indicator',
        name: 'Indicator',
        inPorts: [{ id: 'source', name: 'Source', type: 'Candle' }],
    }));

    const first = catalog.getNodeType('indicator')!;
    first.name = 'HIJACKED';
    first.inPorts.length = 0;

    const second = catalog.getNodeType('indicator')!;
    assert.equal(second.name, 'Indicator');
    assert.equal(second.inPorts.length, 1);
    assert.notEqual(second, first);

    const listed = catalog.getNodeTypes()[0];
    listed.name = 'ALSO HIJACKED';
    assert.equal(catalog.getNodeTypes()[0].name, 'Indicator');

    // The instance handed to addNodeType is copied too, so a caller that keeps
    // editing its own object cannot reach into the catalog.
    const source = new Node({ id: 'later', name: 'Later' });
    catalog.addNodeType(source);
    source.name = 'MUTATED AFTER ADD';
    assert.equal(catalog.getNodeType('later')!.name, 'Later');
});

test('the catalog copies a plain node definition too, not just a Node instance', async () => {
    const { Port, StockSharpCatalog } = await import('../src/index');
    const catalog = new StockSharpCatalog();
    const port = new Port({ id: 'in', name: 'In', type: 'Candle' });
    const parameters = [{
        name: 'Period', displayName: 'Period', description: '', type: 'number',
        defaultValue: '20', options: [], min: null, max: null,
        displayOrder: 0, category: '', isBasic: true, editorType: '',
    }];

    catalog.addNodeType({ id: 'indicator', name: 'Indicator', inPorts: [port], parameters });
    port.name = 'MUTATED';
    parameters[0].defaultValue = 'MUTATED';
    parameters.push({ ...parameters[0], name: 'Extra' });

    const stored = catalog.getNodeType('indicator')!;
    assert.equal(stored.inPorts[0].name, 'In');
    assert.equal(stored.parameters.length, 1);
    assert.equal(stored.parameters[0].defaultValue, '20');
});

test('a dashed link survives loading a document and saving it back', () => {
    const { diagram } = makeDiagram();

    diagram.loadDocument(createDiagramDocument({
        nodes: [
            { id: 'a', name: 'A', outPorts: [{ id: 'out', name: 'Out' }] },
            { id: 'b', name: 'B', inPorts: [{ id: 'in', name: 'In' }] },
        ],
        links: [{ from: { nodeId: 'a', portId: 'out' }, to: { nodeId: 'b', portId: 'in' }, style: 'dashed' }],
    }));

    assert.equal(diagram.saveDocument().links[0].style, 'dashed');
});

test('zones survive loading a document and saving it back', () => {
    const { diagram } = makeDiagram();

    diagram.loadDocument(createDiagramDocument({
        nodes: [{ id: 'a', name: 'A' }],
        zones: [{ id: 'colo', name: 'Colocation', x: -20, y: -20, width: 400, height: 260, color: '#d8c79a' }],
    }));

    assert.deepEqual(diagram.saveDocument().zones, [{
        id: 'colo',
        name: 'Colocation',
        x: -20,
        y: -20,
        width: 400,
        height: 260,
        color: '#d8c79a',
        metadata: {},
    }]);
});

function documentWithZone(): ReturnType<typeof createDiagramDocument> {
    return createDiagramDocument({
        nodes: [{ id: 'a', name: 'A' }],
        zones: [{ id: 'colo', name: 'Colocation', x: -20, y: -20, width: 400, height: 260, color: '#d8c79a' }],
    });
}

// Zones are only ever assigned by loadDocument(); clear() resets nodes, links, selection,
// metadata, runtime state and history but not zones, and the legacy load(nodes, links) path goes
// through the same clear(). So the zones of a document that was thrown away keep being drawn and,
// worse, are written into every later saveDocument().
test('clear() and load() drop the zones of the previous document instead of writing them into the next saveDocument()', async () => {
    const { diagram } = makeDiagram();

    diagram.loadDocument(documentWithZone());
    diagram.clear();
    const afterClear = diagram.saveDocument().zones.map((zone) => zone.id);

    diagram.loadDocument(documentWithZone());
    diagram.load([source, sink], []);
    const afterLegacyLoad = diagram.saveDocument().zones.map((zone) => zone.id);

    installDom();
    const { StockSharpCatalog, StockSharpDiagram } = await import('../src/index');
    const facade = new StockSharpDiagram({
        div: new FakeHost() as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });

    facade.loadDocument(documentWithZone());
    facade.clear();
    const afterFacadeClear = facade.saveDocument().zones.map((zone) => zone.id);

    facade.loadDocument(documentWithZone());
    facade.load([], []);
    const afterFacadeLoad = facade.saveDocument().zones.map((zone) => zone.id);

    assert.deepEqual(
        { afterClear, afterLegacyLoad, afterFacadeClear, afterFacadeLoad },
        { afterClear: [], afterLegacyLoad: [], afterFacadeClear: [], afterFacadeLoad: [] },
        'every zone id listed above belongs to a document that was already discarded: it survived clear()/load() '
        + 'and was persisted by the next saveDocument() into an unrelated strategy',
    );
});

test('loading a document without zones clears the ones already on the canvas', () => {
    const { diagram } = makeDiagram();

    diagram.loadDocument(createDiagramDocument({
        zones: [{ id: 'colo', name: 'Colocation', x: 0, y: 0, width: 100, height: 100 }],
    }));
    diagram.loadDocument(createDiagramDocument({ nodes: [{ id: 'a', name: 'A' }] }));

    assert.deepEqual(diagram.saveDocument().zones, []);
});

test('a document with a duplicate zone id is rejected on the way in, not on the way out', () => {
    const { diagram } = makeDiagram();
    const duplicate = JSON.stringify({
        version: 1,
        nodes: [],
        links: [],
        zones: [
            { id: 'z1', name: 'One', x: 0, y: 0, width: 100, height: 80, color: '', metadata: {} },
            { id: 'z1', name: 'Two', x: 0, y: 120, width: 100, height: 80, color: '', metadata: {} },
        ],
        metadata: {},
    });

    // The builder has always refused this, so a file the parser accepts is one the very next
    // saveDocument() -- which rebuilds through the builder -- cannot write. That asymmetry is the
    // bug: the strategy opens, draws, and can never be saved again.
    let built: Error | null = null;
    try {
        createDiagramDocument({ zones: [
            { id: 'z1', name: 'One', x: 0, y: 0, width: 100, height: 80 },
            { id: 'z1', name: 'Two', x: 0, y: 120, width: 100, height: 80 },
        ] });
    } catch (error) {
        built = error instanceof Error ? error : new Error(String(error));
    }
    assert.ok(built !== null, 'createDiagramDocument is supposed to reject a duplicate zone id');

    let parsed: Error | null = null;
    try {
        diagram.loadDocument(duplicate);
    } catch (error) {
        parsed = error instanceof Error ? error : new Error(String(error));
    }

    assert.ok(
        parsed !== null,
        `the parser accepted a duplicate zone id that the builder rejects with "${built.message}": `
        + 'the document loads and then cannot be saved',
    );
    assert.match(parsed.message, /duplicate zone id/);
});

test('copy/paste keeps a link style, the way load/save already does', () => {
    const { diagram } = makeDiagram();
    diagram.loadDocument(createDiagramDocument({
        nodes: [
            { id: 'a', name: 'A', outPorts: [{ id: 'out', name: 'Out' }] },
            { id: 'b', name: 'B', inPorts: [{ id: 'in', name: 'In' }] },
        ],
        links: [{ from: { nodeId: 'a', portId: 'out' }, to: { nodeId: 'b', portId: 'in' }, style: 'dashed' }],
    }));
    // Control: the style is in the model to begin with, and the clipboard is built from the same
    // saveDocument() shape, so it is carried across -- only the rebuild can lose it.
    assert.equal(diagram.saveDocument().links[0].style, 'dashed', 'the fixture link is not dashed');

    diagram.selectNodesById(['a', 'b']);
    diagram.copySelection();
    diagram.pasteSelection();

    const styles = diagram.saveDocument().links.map((link) => link.style);
    assert.equal(styles.length, 2, 'paste should have produced a second link');
    assert.deepEqual(
        styles,
        ['dashed', 'dashed'],
        'the pasted link came back solid: pasteDocument rebuilds links without their style',
    );
});

test('clear() reports the selection it drops through selectionChanged', () => {
    const { diagram } = makeDiagram();
    diagram.load([source, sink], []);
    diagram.selectNodesById(['source']);
    assert.deepEqual(diagram.getSelection().nodeIds, ['source'], 'setup: the node must be selected before clear()');

    const events: Array<{ nodeIds: readonly string[]; primaryNodeId: string | null }> = [];
    diagram.on('selectionChanged', (selection) => events.push(selection));
    diagram.clear();

    assert.deepEqual(
        { selectionEvents: events.length, lastPayload: events[events.length - 1] ?? null },
        { selectionEvents: 1, lastPayload: { nodeIds: [], linkIds: [], port: null, primaryNodeId: null, primaryLinkId: null } },
        'clear() empties selectedNode/selectedNodes/selectedLink/selectedPort, so it owes exactly one '
        + 'selectionChanged carrying the now-empty selection — every other selection mutation emits one. '
        + 'Zero events mean a property panel keeps showing a node from the discarded document.',
    );
});

test('setZoom() and setViewState() reject non-finite numbers with RangeError instead of poisoning the transform', () => {
    const { diagram } = makeDiagram();

    let zoomError: unknown = null;
    try { diagram.setZoom(Number.NaN); } catch (error) { zoomError = error; }
    const afterZoom = diagram.getViewState();

    let viewError: unknown = null;
    try {
        diagram.setViewState({ zoom: 1.5, panX: Number.NaN, panY: 12, overviewVisible: true });
    } catch (error) { viewError = error; }
    const afterView = diagram.getViewState();

    // The sibling numeric input of the same file, quoted by the audit as the house rule.
    let nudgeError: unknown = null;
    try { diagram.nudgeSelection(Number.NaN, 0); } catch (error) { nudgeError = error; }

    let serializable = true;
    try { serializeDiagramViewState(afterZoom); } catch { serializable = false; }

    assert.deepEqual(
        {
            setZoomThrewRangeError: zoomError instanceof RangeError,
            viewFiniteAfterSetZoom: Number.isFinite(afterZoom.zoom)
                && Number.isFinite(afterZoom.panX) && Number.isFinite(afterZoom.panY),
            viewStateStillSerializable: serializable,
            setViewStateThrewRangeError: viewError instanceof RangeError,
            panFiniteAfterSetViewState: Number.isFinite(afterView.panX) && Number.isFinite(afterView.panY),
            siblingNudgeThrewRangeError: nudgeError instanceof RangeError,
        },
        {
            setZoomThrewRangeError: true,
            viewFiniteAfterSetZoom: true,
            viewStateStillSerializable: true,
            setViewStateThrewRangeError: true,
            panFiniteAfterSetViewState: true,
            siblingNudgeThrewRangeError: true,
        },
        'setZoom(NaN)/setViewState({panX: NaN}) must throw RangeError like nudgeSelection does, and must '
        + 'leave scale/offX/offY finite. A false here means clamp() let NaN through: the transform is '
        + 'poisoned for good, hit-tests and viewChanged carry NaN, and saveViewState() can no longer '
        + 'serialize the viewport.',
    );
});

test('Ctrl+Z obeys enableUndo(false) and, when allowed, announces itself as undoRequested', async () => {
    installDom();
    const { DiagramNode, StockSharpCatalog, StockSharpDiagram } = await import('../src/index');

    const host = new FakeHost();
    const diagram = new StockSharpDiagram({
        div: host as unknown as HTMLElement,
        catalog: new StockSharpCatalog(),
    });
    diagram.load([new DiagramNode({ id: 'node', name: 'Node', x: 40, y: 60 })], []);

    const pressCtrlZ = (): void => {
        host.canvas!.dispatch('keydown', {
            key: 'z', code: 'KeyZ', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false,
        });
    };

    // One undoable step, then the host takes undo away: the menu and the API already refuse it.
    diagram.moveNode('node', 140, 160);
    assert.deepEqual(
        [diagram.getNodeBounds('node')!.x, diagram.getNodeBounds('node')!.y], [140, 160],
        'setup: the node must actually have moved, or a later reading of 40,60 would prove nothing',
    );
    diagram.enableUndo(false);
    assert.equal(diagram.canUndo(), false, 'setup: enableUndo(false) must already make the API refuse undo');
    pressCtrlZ();
    const blocked = diagram.getNodeBounds('node')!;

    // A fresh undoable step so the second half is not trivially satisfied by an empty stack.
    diagram.enableUndo(true);
    diagram.moveNode('node', 240, 260);
    const undoRequests: unknown[] = [];
    diagram.on('undoRequested', (snapshot) => undoRequests.push(snapshot));
    pressCtrlZ();

    assert.deepEqual(
        { positionAfterBlockedCtrlZ: [blocked.x, blocked.y], undoRequestedEvents: undoRequests.length },
        { positionAfterBlockedCtrlZ: [140, 160], undoRequestedEvents: 1 },
        'Ctrl+Z on the canvas must go through the facade: it must be refused while enableUndo(false) '
        + '(node stays at 140,160) and must emit undoRequested once when undo is allowed. A moved-back '
        + 'node means the keyboard bypassed enableUndo; zero events mean a host listening for undo '
        + 'never learns about keyboard undo.',
    );
});

test('a plain click on a node emits no nodeMoved event', () => {
    const { diagram, host, fakeWindow } = makeDiagram();
    diagram.load([source, sink], []);

    const node = diagram.findNode('source')!;
    const [vx, vy] = diagram.worldToView(node.x + node.w / 2, node.y + node.h / 2);

    const moved: string[] = [];
    diagram.on('nodeMoved', (payload) => { moved.push(payload.node.id); });

    // Press and release on the same pixel: a selection click, no displacement whatsoever.
    host.canvas!.dispatch('pointerdown', mouse(vx, vy, 0));
    fakeWindow.dispatch('pointerup', { ...mouse(vx, vy, 0) });

    assert.deepEqual(
        { movedEvents: moved, x: node.x, y: node.y },
        { movedEvents: [], x: 10, y: 20 },
        'a click that displaces nothing must not report a move: nodeMoved fired for a node that '
        + 'stayed at its exact coordinates, so host dirty-tracking marks the document changed on '
        + 'every selection click',
    );
});

test('holding the left mouse button opens no context menu and keeps the drag undoable', async () => {
    const { diagram, host, fakeWindow } = makeDiagram();
    diagram.load([source, sink], []);

    const node = diagram.findNode('source')!;
    const start = { x: node.x, y: node.y };
    const [vx, vy] = diagram.worldToView(node.x + node.w / 2, node.y + node.h / 2);

    const menus: Array<{ x: number; y: number }> = [];
    diagram.on('contextMenu', (payload) => { menus.push({ x: payload.x, y: payload.y }); });

    // Precise positioning: press, nudge 5 px (inside the 7 px long-press tolerance), hold.
    host.canvas!.dispatch('pointerdown', mouse(vx, vy, 0));
    host.canvas!.dispatch('pointermove', { clientX: vx + 5, clientY: vy });
    await wait(700); // past the 550 ms long-press delay
    fakeWindow.dispatch('pointerup', { ...mouse(vx + 5, vy, 0) });

    assert.deepEqual(
        { contextMenus: menus.length, x: node.x, y: node.y, undoEntry: diagram.canUndo() },
        { contextMenus: 0, x: start.x + 5, y: start.y, undoEntry: true },
        'a held LEFT mouse button must not raise the touch long-press menu: the menu opened, '
        + 'wiped the in-progress drag, and the 5 px displacement it left behind never reached '
        + 'history, so Ctrl+Z cannot undo it',
    );
});

test('a port covered by another node body loses the hit test to that body', () => {
    const { diagram, host, fakeWindow } = makeDiagram();
    // "cover" is loaded second, so it is the topmost node and its body hides the out port of "under".
    diagram.load([{
        id: 'under', name: 'Under', x: 10, y: 20,
        outPorts: [{ id: 'out', name: 'Out', type: 'number' }],
    }, {
        id: 'cover', name: 'Cover', x: 170, y: 0,
    }], []);

    const under = diagram.findNode('under')!;
    const cover = diagram.findNode('cover')!;
    const port = under.outPorts[0];
    assert.ok(
        port.cx >= cover.x && port.cx <= cover.x + cover.w
        && port.cy >= cover.y && port.cy <= cover.y + cover.h,
        `setup error, not the finding: the port (${port.cx}, ${port.cy}) is not inside the cover `
        + `body (${cover.x}..${cover.x + cover.w}, ${cover.y}..${cover.y + cover.h})`,
    );

    const [vx, vy] = diagram.worldToView(port.cx, port.cy);
    const portClicks: string[] = [];
    diagram.on('portClicked', (payload) => { portClicks.push(`${payload.node.id}.${payload.port.id}`); });

    host.canvas!.dispatch('pointerdown', mouse(vx, vy, 0));
    fakeWindow.dispatch('pointerup', { ...mouse(vx, vy, 0) });

    const selection = diagram.getSelection();
    assert.deepEqual(
        { selected: selection.nodeIds, port: selection.port, portClicks },
        { selected: ['cover'], port: null, portClicks: [] },
        'a click on visible pixels of the top node must hit that node: the occluded port of the '
        + 'node underneath won the hit test, so the selection and portClicked went to something '
        + 'the user cannot see',
    );
});

test('a double click on a link leaves the viewport untouched', () => {
    const { diagram, host } = makeDiagram();
    diagram.load([source, sink], [{ id: 'l1', from: 'source', fromPort: 'out', to: 'sink', toPort: 'in' }]);
    // Move away from the fit so a stray zoomToFit() is visible in the view state.
    diagram.setZoom(0.5);
    const before = diagram.getViewState();

    // Midway between the two sockets: clear of both bodies and of both port circles.
    const from = diagram.findNode('source')!.outPorts[0];
    const to = diagram.findNode('sink')!.inPorts[0];
    const [vx, vy] = diagram.worldToView((from.cx + to.cx) / 2, (from.cy + to.cy) / 2);

    let overLink = false;
    diagram.on('linkHover', (payload) => { overLink = payload.hovering; });
    host.canvas!.dispatch('pointermove', { clientX: vx, clientY: vy });
    assert.ok(overLink, 'setup error, not the finding: the chosen point is not on the link');

    host.canvas!.dispatch('dblclick', { clientX: vx, clientY: vy });

    assert.deepEqual(
        diagram.getViewState(),
        before,
        'a double click on a link must not re-fit the view: dblclick treated the link as empty '
        + 'space and ran zoomToFit(), rewriting the zoom and pan the user had set',
    );
});

test('takeSvg paints the requested export background instead of the live theme one', () => {
    installDom();
    const host = new FakeHost();
    const diagram = new Diagram({
        host: host as unknown as HTMLElement,
        background: THEME_BACKGROUND,
    });
    diagram.load([source, sink], [{ from: 'source', fromPort: 'out', to: 'sink', toPort: 'in' }]);

    // The raster export is the reference implementation: it swaps opts.background for the duration
    // of the draw, so the theme colour never reaches the output.
    const raster = diagram.takeScreenshot({ background: EXPORT_BACKGROUND }) as unknown as FakeCanvas;
    assert.ok(raster.fillStyles.includes(EXPORT_BACKGROUND),
        `reference: takeScreenshot({background}) must fill with ${EXPORT_BACKGROUND}, painted ${JSON.stringify(raster.fillStyles.slice(0, 4))}`);
    assert.ok(!raster.fillStyles.includes(THEME_BACKGROUND),
        `reference: takeScreenshot({background}) must not fall back to the theme colour ${THEME_BACKGROUND}`);

    const svg = diagram.takeSvg({ background: EXPORT_BACKGROUND });
    // The underlay SvgSurface writes first, then the frame-sized rect draw() paints on top of it.
    const underlay = /<rect width="100%" height="100%" fill="([^"]+)"\/>/.exec(svg);
    const frame = /<rect x="0" y="0" width="800" height="480" fill="([^"]+)"/.exec(svg);

    assert.ok(underlay !== null && frame !== null,
        `setup: the export should have both an underlay and the frame draw() fills, got: ${svg.slice(0, 300)}`);
    assert.equal(frame[1], EXPORT_BACKGROUND,
        `takeSvg({background}) repainted the live theme background over the requested export background: the `
        + `option reaches only the SvgSurface underlay (${underlay[1]}), and draw() then covers the whole frame `
        + `with an opaque rect of the theme colour -- so raster and vector exports of the same options come out `
        + 'different colours');
});
