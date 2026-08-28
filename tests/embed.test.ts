import assert from 'node:assert/strict';
import test from 'node:test';

import {
    destroyRenderedDiagram,
    renderAll,
    renderFromSource,
    renderScheme,
    type DiagramEmbedScheme,
} from '../src/embed';

class FakeClassList {
    private readonly values = new Set<string>();
    add(...values: string[]): void { values.forEach((value) => this.values.add(value)); }
    remove(...values: string[]): void { values.forEach((value) => this.values.delete(value)); }
    contains(value: string): boolean { return this.values.has(value); }
    toggle(value: string, force?: boolean): boolean {
        const next = force ?? !this.values.has(value);
        if (next) this.values.add(value); else this.values.delete(value);
        return next;
    }
}

class FakeCanvas {
    readonly style: Record<string, string> = {};
    parentElement: FakeHost | null = null;
    tabIndex = 0;
    width = 0;
    height = 0;
    private readonly listeners = new Map<string, EventListenerOrEventListenerObject[]>();
    private readonly context = new Proxy({
        globalAlpha: 1,
        measureText: (text: string) => ({ width: text.length * 7 }),
        setTransform: () => undefined,
    }, {
        get(target, property) {
            if (property in target) return target[property as keyof typeof target];
            return () => undefined;
        },
        set(target, property, value) {
            (target as Record<PropertyKey, unknown>)[property] = value;
            return true;
        },
    });

    getContext(): CanvasRenderingContext2D { return this.context as unknown as CanvasRenderingContext2D; }
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
    }
    getBoundingClientRect(): DOMRect {
        return { left: 0, top: 0, right: 800, bottom: 480, width: 800, height: 480, x: 0, y: 0, toJSON: () => ({}) };
    }
    setPointerCapture(): void {}
    focus(): void {}
    remove(): void {
        if (this.parentElement === null) return;
        const index = this.parentElement.children.indexOf(this);
        if (index >= 0) this.parentElement.children.splice(index, 1);
        this.parentElement = null;
    }
}

class FakeButton {
    readonly style: Record<string, string> = {};
    parentElement: FakeHost | null = null;
    hidden = false;
    type = '';
    className = '';
    title = '';
    innerHTML = '';
    private readonly attributes = new Map<string, string>();
    private readonly listeners = new Map<string, EventListenerOrEventListenerObject[]>();

    setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
    }
    dispatch(type: string): void {
        const event = { type, preventDefault: () => undefined } as Event;
        for (const listener of this.listeners.get(type) ?? []) {
            if (typeof listener === 'function') listener(event);
            else listener.handleEvent(event);
        }
    }
    remove(): void {
        if (this.parentElement === null) return;
        const index = this.parentElement.children.indexOf(this);
        if (index >= 0) this.parentElement.children.splice(index, 1);
        this.parentElement = null;
    }
}

class FakeHost {
    readonly children: Array<FakeCanvas | FakeButton> = [];
    readonly style: Record<string, string> = {};
    readonly dataset: Record<string, string | undefined> = {};
    readonly classList = new FakeClassList();
    parentElement: FakeHost | null = null;
    clientWidth = 800;
    clientHeight = 480;
    isConnected = true;
    textContent = '';

    appendChild<T extends FakeCanvas | FakeButton>(child: T): T {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }
    replaceChildren(): void {
        for (const child of this.children) child.parentElement = null;
        this.children.length = 0;
        this.textContent = '';
    }
    closest(): null { return null; }
    addEventListener(): void {}
    removeEventListener(): void {}
    getBoundingClientRect(): DOMRect {
        return { left: 0, top: 0, right: 800, bottom: 480, width: 800, height: 480, x: 0, y: 0, toJSON: () => ({}) };
    }
}

class FakeMutationObserver {
    static readonly instances: FakeMutationObserver[] = [];
    disconnected = false;
    constructor(private readonly callback: MutationCallback) {
        FakeMutationObserver.instances.push(this);
    }
    observe(): void {}
    disconnect(): void { this.disconnected = true; }
    trigger(): void { if (!this.disconnected) this.callback([], this as unknown as MutationObserver); }
}

class FakeResizeObserver {
    static readonly instances: FakeResizeObserver[] = [];
    disconnected = false;
    constructor(private readonly callback: ResizeObserverCallback) {
        FakeResizeObserver.instances.push(this);
    }
    observe(): void {}
    disconnect(): void { this.disconnected = true; }
    trigger(): void { if (!this.disconnected) this.callback([], this as unknown as ResizeObserver); }
}

class FakeWindow {
    devicePixelRatio = 1;
    private readonly listeners = new Map<string, EventListener[]>();
    addEventListener(type: string, listener: EventListener): void {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }
    removeEventListener(type: string, listener: EventListener): void {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
    }
}

const emptyScheme: DiagramEmbedScheme = { nodes: [], links: [] };
const palette = { socketTypes: [], elements: [] };

function installDom(fetchImpl: typeof fetch): void {
    FakeMutationObserver.instances.length = 0;
    FakeResizeObserver.instances.length = 0;
    const documentElement = {};
    Object.assign(globalThis, {
        document: {
            documentElement,
            createElement: (tag: string) => {
                if (tag === 'canvas') return new FakeCanvas();
                if (tag === 'button') return new FakeButton();
                throw new Error(`Unexpected element: ${tag}`);
            },
        },
        window: new FakeWindow(),
        MutationObserver: FakeMutationObserver,
        ResizeObserver: FakeResizeObserver,
        requestAnimationFrame: () => 1,
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        Image: class {},
        fetch: fetchImpl,
    });
}

/** Lets the pending fetch/JSON promises and the zero-delay fit timer run to completion. */
async function settle(): Promise<void> {
    for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function paletteResponse(): Response {
    return { ok: true, json: async () => palette } as Response;
}

test('embed rendering replaces and disposes every resource owned by a host', async () => {
    installDom(async () => paletteResponse());
    const host = new FakeHost();
    host.classList.add('ss-diagram-error');

    const first = await renderScheme(host as unknown as HTMLElement, '/palette.json', emptyScheme);
    assert.notEqual(first, null);
    assert.equal(host.children.length, 2);
    assert.equal(host.dataset.rendered, '1');
    assert.equal(host.classList.contains('ss-diagram-error'), false);

    const firstResize = FakeResizeObserver.instances[0];
    const firstTheme = FakeMutationObserver.instances.find((observer) => !observer.disconnected)!;
    const second = await renderScheme(host as unknown as HTMLElement, '/palette.json', emptyScheme);
    assert.notEqual(second, null);
    assert.equal(first!.destroyed, true);
    assert.equal(firstResize.disconnected, true);
    assert.equal(firstTheme.disconnected, true);
    assert.equal(host.children.length, 2);

    assert.equal(destroyRenderedDiagram(host as unknown as HTMLElement), true);
    assert.equal(second!.destroyed, true);
    assert.equal(host.children.length, 0);
    assert.equal(host.dataset.rendered, undefined);
    assert.equal(destroyRenderedDiagram(host as unknown as HTMLElement), false);

    const third = await renderScheme(host as unknown as HTMLElement, '/palette.json', emptyScheme);
    assert.notEqual(third, null);
    host.isConnected = false;
    for (const observer of FakeMutationObserver.instances) observer.trigger();
    assert.equal(third!.destroyed, true);
    assert.equal(host.children.length, 0);
});

test('the download button appears only for a host that listens, and only asks', async () => {
    installDom(async () => paletteResponse());
    const withoutHost = new FakeHost();
    const plain = await renderScheme(withoutHost as unknown as HTMLElement, '/palette.json', emptyScheme, {});
    assert.notEqual(plain, null);
    assert.equal(plain!.diagram.isDownloadButtonVisible(), false);
    plain!.destroy();

    const host = new FakeHost();
    const asked: string[] = [];
    const handle = await renderScheme(
        host as unknown as HTMLElement,
        '/palette.json',
        emptyScheme,
        {
            onExportRequested: ({ format }) => { asked.push(format); },
        },
    );
    assert.notEqual(handle, null);
    assert.equal(handle!.diagram.isDownloadButtonVisible(), true);

    const button = host.children.find(
        (child): child is FakeButton => child instanceof FakeButton && child.className.includes('download'),
    )!;
    button.dispatch('click');

    // The control writes nothing itself: it says what was asked for and leaves the saving to the host.
    assert.deepEqual(asked, ['document']);

    handle!.destroy();
});

test('embed forwards fullscreen requests to the host callback', async () => {
    installDom(async () => paletteResponse());
    const host = new FakeHost();
    const requests: Array<{ fullscreen: boolean; sameHost: boolean }> = [];
    let destroyed = 0;
    const handle = await renderScheme(
        host as unknown as HTMLElement,
        '/palette.json',
        emptyScheme,
        {
            onFullscreenRequested: ({ fullscreen }, rendered) => {
                requests.push({
                    fullscreen,
                    sameHost: rendered.host === (host as unknown as HTMLElement),
                });
            },
            onDestroyed: () => { destroyed += 1; },
        },
    );
    assert.notEqual(handle, null);

    const button = host.children.find((child): child is FakeButton => child instanceof FakeButton)!;
    button.dispatch('click');
    assert.deepEqual(requests, [{ fullscreen: true, sameHost: true }]);
    assert.equal(handle!.diagram.isFullscreen(), false);

    handle!.diagram.setFullscreenState(true);
    button.dispatch('click');
    assert.deepEqual(requests.at(-1), { fullscreen: false, sameHost: true });

    handle!.destroy();
    assert.equal(destroyed, 1);
    button.dispatch('click');
    assert.equal(requests.length, 2);
});

test('a stale async render cannot replace a newer host render', async () => {
    const responses: Array<(response: Response) => void> = [];
    installDom(() => new Promise<Response>((resolve) => responses.push(resolve)));
    const host = new FakeHost();

    const older = renderScheme(host as unknown as HTMLElement, '/old-palette.json', emptyScheme);
    const newer = renderScheme(host as unknown as HTMLElement, '/new-palette.json', emptyScheme);
    assert.equal(responses.length, 2);
    responses[1](paletteResponse());
    const current = await newer;
    assert.notEqual(current, null);
    responses[0](paletteResponse());
    assert.equal(await older, null);
    assert.equal(host.children.length, 2);

    current!.destroy();
    assert.equal(host.children.length, 0);
});

test('a stale source failure cannot replace a newer successful render with an error note', async () => {
    let resolveOlder!: (response: Response) => void;
    const raw = JSON.stringify({
        Content: { Value: { Scheme: { Model: {
            Nodes: [{ Key: 'node', TypeId: 'missing', X: 0, Y: 0 }],
            Links: [],
        } } } },
    });
    installDom((input) => {
        const url = String(input);
        if (url === '/older.json') return new Promise<Response>((resolve) => { resolveOlder = resolve; });
        if (url === '/newer.json') return Promise.resolve({ ok: true, text: async () => raw } as Response);
        if (url === '/palette.json') return Promise.resolve(paletteResponse());
        throw new Error(`Unexpected URL: ${url}`);
    });
    const host = new FakeHost();

    const older = renderFromSource(
        host as unknown as HTMLElement, '/palette.json', '/older.json',
    );
    const newer = await renderFromSource(
        host as unknown as HTMLElement, '/palette.json', '/newer.json',
    );
    assert.notEqual(newer, null);
    resolveOlder({ ok: false } as Response);
    assert.equal(await older, null);
    assert.equal(newer!.destroyed, false);
    assert.equal(host.children.length, 2);
    assert.equal(host.classList.contains('ss-diagram-error'), false);
    const missingNode = newer!.diagram.save().nodes[0];
    assert.equal(missingNode.isPlaceholder, true);
    assert.equal(newer!.diagram.getRuntimeState().nodes.node.errors.load?.kind, 'load');
    assert.match(newer!.diagram.getRuntimeState().nodes.node.errors.load?.message ?? '', /missing/i);

    newer!.destroy();
});

test('theming paints the host only, never the element it was mounted into', async () => {
    installDom(async () => paletteResponse());
    const page = new FakeHost();
    const host = new FakeHost();
    host.parentElement = page;

    const handle = await renderScheme(host as unknown as HTMLElement, '/palette.json', emptyScheme);
    assert.notEqual(handle, null);

    // The host carries the diagram background; the surrounding page keeps whatever it had. Reaching one
    // level up would repaint arbitrary page content -- on a docs page it spilled over the whole article.
    assert.equal(host.style.background, '#1b1b1f');
    assert.equal(page.style.background, undefined);

    handle!.destroy();
});

test('a scheme whose Nodes or Links is not an array degrades to a note instead of throwing', async () => {
    // A .NET dictionary serializer emits {} for an empty map, so a non-array here
    // is a realistic document rather than a hand-crafted hostile one.
    const render = async (model: unknown) => {
        const raw = JSON.stringify({ Content: { Value: { Scheme: { Model: model } } } });
        installDom((input) => String(input) === '/palette.json'
            ? Promise.resolve(paletteResponse())
            : Promise.resolve({ ok: true, text: async () => raw } as Response));
        const host = new FakeHost();
        host.dataset.diagramErrors = 'load failed|empty diagram|draw failed';
        const handle = await renderFromSource(host as unknown as HTMLElement, '/palette.json', '/src.json');
        return { host, handle };
    };

    for (const model of [{ Nodes: {}, Links: [] }, { Nodes: 'nope', Links: null }]) {
        const { host, handle } = await render(model);
        assert.equal(handle, null);
        assert.equal(host.textContent, 'empty diagram');
    }

    // Readable nodes still render even when the links are unusable.
    const partial = await render({ Nodes: [{ Key: 'node', TypeId: 'x', X: 0, Y: 0 }], Links: 7 });
    assert.notEqual(partial.handle, null);
    const saved = partial.handle!.diagram.save();
    assert.equal(saved.nodes.length, 1);
    assert.equal(saved.links.length, 0);
    partial.handle!.destroy();
});

test('a malformed palette body yields an empty catalog instead of crashing the render', async () => {
    for (const body of [null, {}, [], { socketTypes: 'no', elements: 3 }]) {
        installDom(async () => ({ ok: true, json: async () => body } as Response));
        const host = new FakeHost();

        const handle = await renderScheme(host as unknown as HTMLElement, '/palette.json', {
            nodes: [{ id: 'n1', typeId: 'unknown-type', name: 'Node', x: 0, y: 0 }],
            links: [],
        });

        assert.notEqual(handle, null);
        assert.equal(handle!.diagram.save().nodes[0].isPlaceholder, true);
        handle!.destroy();
    }
});

test('malformed palette entries are skipped, readable ones still load', async () => {
    installDom(async () => ({
        ok: true,
        json: async () => ({
            socketTypes: [null, { name: 'Candle', color: '#fff' }, { name: 7, color: '#000' }],
            elements: [
                'nonsense',
                { typeId: 'good', name: 'Good', groupName: 'G', icon: '', inPorts: [{ key: 'in', name: 'In', type: 'Candle' }], outPorts: [] },
                { typeId: 'no-ports', name: 'No ports', groupName: 'G', icon: '', inPorts: 'bad', outPorts: null },
            ],
        }),
    } as Response));
    const host = new FakeHost();

    const handle = await renderScheme(host as unknown as HTMLElement, '/palette.json', {
        nodes: [
            { id: 'a', typeId: 'good', name: 'A', x: 0, y: 0 },
            { id: 'b', typeId: 'no-ports', name: 'B', x: 0, y: 0 },
        ],
        links: [],
    });

    assert.notEqual(handle, null);
    const saved = handle!.diagram.save();
    assert.equal(saved.nodes[0].isPlaceholder, false);
    assert.equal(saved.nodes[0].inPorts.length, 1);
    assert.equal(saved.nodes[1].isPlaceholder, false);
    assert.equal(saved.nodes[1].inPorts.length, 0);
    handle!.destroy();
});

test('a palette URL that answers with an error status degrades to a note', async () => {
    installDom((input) => String(input) === '/palette.json'
        ? Promise.resolve({ ok: false, json: async () => ({}) } as Response)
        : Promise.resolve({
            ok: true,
            text: async () => JSON.stringify({ Content: { Value: { Scheme: { Model: {
                Nodes: [{ Key: 'node', TypeId: 'x', X: 0, Y: 0 }], Links: [],
            } } } } }),
        } as Response));
    const host = new FakeHost();
    host.dataset.diagramErrors = 'load failed|empty diagram|draw failed';

    const handle = await renderFromSource(host as unknown as HTMLElement, '/palette.json', '/src.json');

    assert.equal(handle, null);
    assert.equal(host.textContent, 'draw failed');
});

test('a host that sets no error texts still gets the built-in ones', async () => {
    // "".split("|") is [""], not [], so a destructuring default never fires here:
    // the slots have to fall back on emptiness, not on absence.
    installDom(async () => ({ ok: false } as Response));
    const host = new FakeHost();

    assert.equal(await renderFromSource(host as unknown as HTMLElement, '/palette.json', '/src.json'), null);
    assert.equal(host.textContent, 'Diagram source could not be loaded.');

    // A partial override keeps the built-in text for the slots it omits.
    installDom(async () => ({ ok: false } as Response));
    const partial = new FakeHost();
    partial.dataset.diagramErrors = 'Не удалось загрузить схему.';

    assert.equal(await renderFromSource(partial as unknown as HTMLElement, '/palette.json', '/src.json'), null);
    assert.equal(partial.textContent, 'Не удалось загрузить схему.');

    installDom((input) => String(input) === '/palette.json'
        ? Promise.resolve(paletteResponse())
        : Promise.resolve({ ok: true, text: async () => '{}' } as Response));
    const empty = new FakeHost();
    empty.dataset.diagramErrors = 'Не удалось загрузить схему.';

    assert.equal(await renderFromSource(empty as unknown as HTMLElement, '/palette.json', '/src.json'), null);
    assert.equal(empty.textContent, 'Diagram is empty or malformed.');
});

test('a host whose embed failed is rendered again by the next renderAll', async () => {
    // An ordinary failure: a source URL that answered badly once. Nothing about it says "never
    // draw this element again", which is what latching dataset.rendered amounts to.
    let sourceReachable = false;
    installDom((async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/data/designer-palette.json') return paletteResponse();
        if (url === '/scheme.json') {
            return sourceReachable
                ? { ok: true, text: async () => JSON.stringify({
                    Content: { Value: { Scheme: { Model: {
                        Nodes: [{ Key: 'node', TypeId: 'whatever', X: 10, Y: 20 }],
                        Links: [],
                    } } } },
                }) } as Response
                : { ok: false } as Response;
        }
        throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as typeof fetch);
    const host = new FakeHost();
    host.dataset.diagramSrc = '/scheme.json';
    const root = { querySelectorAll: () => [host] } as unknown as ParentNode;

    renderAll(root);
    await settle();

    // Setup check: the transient failure really did take the load-error path.
    assert.equal(host.textContent, 'Diagram source could not be loaded.',
        'the host did not take the load-failure path, so this test is not exercising the finding');
    assert.equal(host.classList.contains('ss-diagram-error'), true,
        'the failure note was not applied, so this test is not exercising the finding');

    assert.notEqual(host.dataset.rendered, '1',
        'a failed embed stayed marked as rendered, so the flag permanently hides a host that never drew anything');

    // The consequence a reader of the page sees: the source is reachable again, yet the element
    // stays a text note for the rest of the session.
    sourceReachable = true;
    renderAll(root);
    await settle();

    assert.equal(host.children.length, 2,
        'renderAll skipped a host that had only ever failed, so one transient network error is permanent');
    assert.equal(host.classList.contains('ss-diagram-error'), false,
        'the error note survived a successful re-render');
});

test('a shorthand --diagram-bg is read as the light canvas it names', async () => {
    // Both spellings name the same white. The link palette is picked from that colour, so the two
    // have to land on the same theme.
    const lightnessFor = async (background: string): Promise<number | undefined> => {
        installDom((async () => paletteResponse()) as unknown as typeof fetch);
        // The canvas colour the embed reads is a custom property on the document element.
        Object.assign(globalThis, {
            getComputedStyle: () => ({
                getPropertyValue: (name: string) => (name === '--diagram-bg' ? background : ''),
            }),
        });
        const host = new FakeHost();
        const scheme: DiagramEmbedScheme = { nodes: [], links: [] };
        const handle = await renderScheme(host as unknown as HTMLElement, '/palette.json', scheme);
        assert.notEqual(handle, null, `renderScheme drew nothing for ${background}`);
        // The chosen palette is not published anywhere public, so the canvas option it was written
        // into is the only place to read it back.
        const lightness = (handle!.diagram as unknown as {
            canvas: { opts: { linkMaxLightness?: number } };
        }).canvas.opts.linkMaxLightness;
        handle!.destroy();
        return lightness;
    };

    assert.equal(await lightnessFor('#ffffff'), 0.42,
        'long-form white did not select the light link palette, so this test is not exercising the finding');

    assert.equal(await lightnessFor('#fff'), 0.42,
        'shorthand #fff scored luminance 0, so a white canvas is classified as dark and draws near-invisible links');
});
