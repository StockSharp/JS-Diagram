import { Diagram, type DiagramScreenshotOptions } from './canvas-renderer.js';
import { parseDiagramDocument } from './core/document.js';

/**
 * Drawing a diagram where there is no browser -- a server producing a picture for a chat message, an
 * e-mail or a report. The renderer itself never needed one: it draws through a surface, and the SVG
 * surface builds a string. What needed a browser was the control around it, which creates a canvas and
 * listens for pointers; so the few things it reaches for are stood in for here, for the length of one
 * drawing, and taken away again.
 *
 * Text is measured by the SVG surface's own estimate rather than by a real font, so a label's box can sit
 * a pixel or two off where a browser would put it. The alternative is a native canvas dependency on every
 * machine that renders, which is a steep price for that.
 */
export interface HeadlessRenderOptions extends DiagramScreenshotOptions {
    /** Width of the frame the drawing is laid out in, in CSS pixels. Defaults to 1200. */
    hostWidth?: number;
    /** Height of that frame. Defaults to 800. */
    hostHeight?: number;
}

/** A 2D context that answers every call and remembers nothing: the drawing goes to the SVG surface. */
function createContext(): CanvasRenderingContext2D {
    const own = {
        globalAlpha: 1,
        measureText: (text: string) => ({ width: text.length * 7 }),
    };

    return new Proxy(own, {
        get: (target, property) => property in target ? target[property as keyof typeof own] : () => undefined,
        set: (target, property, value) => {
            (target as Record<PropertyKey, unknown>)[property] = value;
            return true;
        },
    }) as unknown as CanvasRenderingContext2D;
}

class StubElement {
    style: Record<string, string> = {};
    className = '';
    tabIndex = 0;
    width = 0;
    height = 0;
    textContent = '';
    readonly children: StubElement[] = [];
    readonly classList = { toggle: () => false, add: () => undefined, remove: () => undefined };

    private readonly context = createContext();

    appendChild<T extends StubElement>(child: T): T {
        this.children.push(child);
        return child;
    }

    removeChild(child: StubElement): StubElement {
        const at = this.children.indexOf(child);
        if (at >= 0) this.children.splice(at, 1);
        return child;
    }

    remove(): void { /* detached already */ }
    setAttribute(): void { /* nothing reads it here */ }
    focus(): void { /* no focus without a browser */ }
    addEventListener(): void { /* nothing to fire the events */ }
    removeEventListener(): void { /* see above */ }
    getContext(): CanvasRenderingContext2D { return this.context; }

    getBoundingClientRect(): DOMRect {
        return { left: 0, top: 0, right: this.width, bottom: this.height, width: this.width, height: this.height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    }

    get clientWidth(): number { return this.width; }
    get clientHeight(): number { return this.height; }
}

const GLOBAL_KEYS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'Image', 'getComputedStyle', 'performance'] as const;

/** Puts the stubs in place, and hands back the function that removes exactly what it added. */
function installGlobals(): () => void {
    const target = globalThis as Record<string, unknown>;

    if (target.document !== undefined)
        return () => undefined;

    const before = new Map<string, unknown>();
    for (const key of GLOBAL_KEYS) before.set(key, target[key]);

    const stubDocument = Object.assign(new StubElement(), {
        documentElement: new StubElement(),
        createElement: () => new StubElement(),
    });

    Object.assign(target, {
        window: Object.assign(new StubElement(), { devicePixelRatio: 1 }),
        document: stubDocument,
        requestAnimationFrame: () => 1,
        cancelAnimationFrame: () => undefined,
        Image: class { },
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        // A host without a browser may have no clock either -- an embedded JS engine has none. The drawing
        // reads it for animation, and a still picture has no animation to advance.
        performance: (globalThis as { performance?: { now(): number } }).performance ?? { now: () => 0 },
    });

    return () => {
        for (const [key, value] of before) {
            if (value === undefined) delete target[key];
            else target[key] = value;
        }
    };
}

/**
 * Draws a saved diagram and returns the SVG for it. The source is the document as text or as an object;
 * the frame follows the content by default, since a picture made without a viewport has none to crop to.
 */
export function renderDiagramSvg(source: string | unknown, options: HeadlessRenderOptions = {}): string {
    const { hostWidth = 1200, hostHeight = 800, ...screenshot } = options;
    const restore = installGlobals();

    try {
        const host = new StubElement();
        host.width = hostWidth;
        host.height = hostHeight;

        const diagram = new Diagram({ host: host as unknown as HTMLElement });

        try {
            // Whatever shape it arrived in -- text off the wire, an object already in hand -- the library's
            // own reader decides what a document is.
            diagram.loadDocument(parseDiagramDocument(source));
            return diagram.takeSvg({ scope: 'content', ...screenshot });
        } finally {
            diagram.destroy();
        }
    } finally {
        restore();
    }
}
