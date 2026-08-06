import type { DrawSurface } from './draw-surface.js';

/**
 * A DrawSurface that writes SVG instead of pixels.
 *
 * The renderer is not aware of it: it issues the same calls it issues to a 2D context, and they are
 * recorded as elements rather than painted. That is the whole point -- one renderer, so the vector
 * output cannot drift from what the screen shows.
 *
 * Canvas semantics are followed rather than approximated, because the difference is visible:
 *   - a transform is baked into each element as a matrix, so nesting never has to be reconstructed;
 *   - arcTo is resolved the way canvas resolves it (tangent point, then a real arc), which is what
 *     draws every rounded node corner;
 *   - arc emits the leading straight segment canvas draws when a subpath is already open, and
 *     splits a full circle in two, since a single SVG arc cannot close on itself;
 *   - text metrics come from a real 2D context, so glyphs land where the on-screen layout put them.
 */

type Matrix = [number, number, number, number, number, number];   // a b c d e f

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
    return [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
    ];
}

function isIdentity(m: Matrix): boolean {
    return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

/** Trims float noise: coordinates carry three decimals, which is finer than any renderer needs. */
function n(value: number): string {
    if (!Number.isFinite(value)) return '0';
    return (Math.round(value * 1000) / 1000).toString();
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

interface SurfaceState {
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
    lineJoin: CanvasLineJoin;
    lineCap: CanvasLineCap;
    globalAlpha: number;
    font: string;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
    dash: readonly number[];
    matrix: Matrix;
    clipId: string | null;
}

const ANCHOR: Record<string, string> = {
    left: 'start', start: 'start',
    center: 'middle',
    right: 'end', end: 'end',
};

// dominant-baseline rather than alignment-baseline: it is the one browsers and renderers agree on
// for <text>, and these four are the values the renderer actually sets.
const BASELINE: Record<string, string> = {
    top: 'text-before-edge',
    hanging: 'hanging',
    middle: 'central',
    alphabetic: 'alphabetic',
    ideographic: 'ideographic',
    bottom: 'text-after-edge',
};

export interface SvgSurfaceOptions {
    width: number;
    height: number;
    /** Painted as a full-size rect before anything else. Omit to leave the drawing transparent. */
    background?: string;
    /** Borrowed only for measureText; the SVG never draws on it. */
    metrics?: CanvasRenderingContext2D;
}

export class SvgSurface implements DrawSurface {
    private readonly width: number;
    private readonly height: number;
    private readonly background: string | undefined;
    private readonly metrics: CanvasRenderingContext2D | null;

    private readonly body: string[] = [];
    private readonly defs: string[] = [];
    private readonly stack: SurfaceState[] = [];

    private state: SurfaceState = {
        fillStyle: '#000000',
        strokeStyle: '#000000',
        lineWidth: 1,
        lineJoin: 'miter',
        lineCap: 'butt',
        globalAlpha: 1,
        font: '10px sans-serif',
        textAlign: 'start',
        textBaseline: 'alphabetic',
        dash: [],
        matrix: IDENTITY,
        clipId: null,
    };

    /** Path being built by moveTo/lineTo/arc/arcTo, in the units the caller passes. */
    private path: string[] = [];
    private cursor: [number, number] | null = null;
    private subpathStart: [number, number] | null = null;
    private clipSeq = 0;

    constructor(options: SvgSurfaceOptions) {
        this.width = options.width;
        this.height = options.height;
        this.background = options.background;
        this.metrics = options.metrics ?? null;
    }

    // ===== state =========================================================

    get fillStyle(): string | CanvasGradient | CanvasPattern { return this.state.fillStyle; }
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
        // Gradients and patterns are canvas objects with no serialisable form here. The renderer
        // uses plain colours; anything else is left as the previous colour rather than guessed at.
        if (typeof value === 'string') this.state.fillStyle = value;
    }

    get strokeStyle(): string | CanvasGradient | CanvasPattern { return this.state.strokeStyle; }
    set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
        if (typeof value === 'string') this.state.strokeStyle = value;
    }

    get lineWidth(): number { return this.state.lineWidth; }
    set lineWidth(value: number) { this.state.lineWidth = value; }

    get lineJoin(): CanvasLineJoin { return this.state.lineJoin; }
    set lineJoin(value: CanvasLineJoin) { this.state.lineJoin = value; }

    get lineCap(): CanvasLineCap { return this.state.lineCap; }
    set lineCap(value: CanvasLineCap) { this.state.lineCap = value; }

    get globalAlpha(): number { return this.state.globalAlpha; }
    set globalAlpha(value: number) { this.state.globalAlpha = value; }

    get font(): string { return this.state.font; }
    set font(value: string) {
        this.state.font = value;
        if (this.metrics !== null) this.metrics.font = value;
    }

    get textAlign(): CanvasTextAlign { return this.state.textAlign; }
    set textAlign(value: CanvasTextAlign) { this.state.textAlign = value; }

    get textBaseline(): CanvasTextBaseline { return this.state.textBaseline; }
    set textBaseline(value: CanvasTextBaseline) { this.state.textBaseline = value; }

    save(): void {
        this.stack.push({ ...this.state, dash: [...this.state.dash], matrix: [...this.state.matrix] as Matrix });
    }

    restore(): void {
        const previous = this.stack.pop();
        if (previous !== undefined) this.state = previous;
    }

    setLineDash(segments: readonly number[]): void {
        this.state.dash = [...segments];
    }

    // ===== transform =====================================================

    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
        this.state.matrix = [a, b, c, d, e, f];
    }

    translate(x: number, y: number): void {
        this.state.matrix = multiply(this.state.matrix, [1, 0, 0, 1, x, y]);
    }

    rotate(angle: number): void {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        this.state.matrix = multiply(this.state.matrix, [cos, sin, -sin, cos, 0, 0]);
    }

    // ===== paths =========================================================

    beginPath(): void {
        this.path = [];
        this.cursor = null;
        this.subpathStart = null;
    }

    closePath(): void {
        if (this.cursor === null) return;
        this.path.push('Z');
        if (this.subpathStart !== null) this.cursor = [...this.subpathStart] as [number, number];
    }

    moveTo(x: number, y: number): void {
        this.path.push(`M${n(x)} ${n(y)}`);
        this.cursor = [x, y];
        this.subpathStart = [x, y];
    }

    lineTo(x: number, y: number): void {
        if (this.cursor === null) { this.moveTo(x, y); return; }
        this.path.push(`L${n(x)} ${n(y)}`);
        this.cursor = [x, y];
    }

    arc(cx: number, cy: number, r: number, start: number, end: number, ccw = false): void {
        const sx = cx + r * Math.cos(start);
        const sy = cy + r * Math.sin(start);

        // Canvas joins an open subpath to the arc's first point with a straight line.
        if (this.cursor === null) this.moveTo(sx, sy);
        else this.lineTo(sx, sy);

        let delta = end - start;

        if (ccw) {
            while (delta > 0) delta -= Math.PI * 2;
            if (delta <= -Math.PI * 2) delta = -Math.PI * 2;
        } else {
            while (delta < 0) delta += Math.PI * 2;
            if (delta >= Math.PI * 2) delta = Math.PI * 2;
        }

        const sweep = ccw ? 0 : 1;

        // A single SVG arc cannot end where it began, so a full turn is drawn as two halves.
        if (Math.abs(delta) >= Math.PI * 2 - 1e-9) {
            const mid = start + delta / 2;
            const mx = cx + r * Math.cos(mid);
            const my = cy + r * Math.sin(mid);
            this.path.push(`A${n(r)} ${n(r)} 0 0 ${sweep} ${n(mx)} ${n(my)}`);
            this.path.push(`A${n(r)} ${n(r)} 0 0 ${sweep} ${n(sx)} ${n(sy)}`);
            this.cursor = [sx, sy];
            return;
        }

        const ex = cx + r * Math.cos(start + delta);
        const ey = cy + r * Math.sin(start + delta);
        const large = Math.abs(delta) > Math.PI ? 1 : 0;

        this.path.push(`A${n(r)} ${n(r)} 0 ${large} ${sweep} ${n(ex)} ${n(ey)}`);
        this.cursor = [ex, ey];
    }

    arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
        if (this.cursor === null) { this.moveTo(x1, y1); return; }

        const [x0, y0] = this.cursor;

        // Canvas degenerates to a straight line when there is no corner to round.
        const a = [x0 - x1, y0 - y1];
        const b = [x2 - x1, y2 - y1];
        const la = Math.hypot(a[0], a[1]);
        const lb = Math.hypot(b[0], b[1]);

        if (la === 0 || lb === 0 || r === 0) { this.lineTo(x1, y1); return; }

        const ua = [a[0] / la, a[1] / la];
        const ub = [b[0] / lb, b[1] / lb];
        const cross = ua[0] * ub[1] - ua[1] * ub[0];

        if (Math.abs(cross) < 1e-9) { this.lineTo(x1, y1); return; }   // collinear

        const angle = Math.acos(Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1])));
        const tangent = r / Math.tan(angle / 2);

        // The corner cannot swallow more than the shorter arm.
        const t = Math.min(tangent, la, lb);
        const radius = t * Math.tan(angle / 2);

        const t1 = [x1 + ua[0] * t, y1 + ua[1] * t];
        const t2 = [x1 + ub[0] * t, y1 + ub[1] * t];

        this.lineTo(t1[0], t1[1]);

        // Turning left in screen coordinates (y down) is a counter-clockwise sweep.
        const sweep = cross < 0 ? 1 : 0;
        this.path.push(`A${n(radius)} ${n(radius)} 0 0 ${sweep} ${n(t2[0])} ${n(t2[1])}`);
        this.cursor = [t2[0], t2[1]];
    }

    fill(): void {
        if (this.path.length === 0) return;
        this.emit(`<path d="${this.path.join(' ')}" ${this.fillAttrs()}/>`);
    }

    stroke(): void {
        if (this.path.length === 0) return;
        this.emit(`<path d="${this.path.join(' ')}" fill="none" ${this.strokeAttrs()}/>`);
    }

    clip(): void {
        if (this.path.length === 0) return;

        const id = `clip${++this.clipSeq}`;
        this.defs.push(`<clipPath id="${id}"><path d="${this.path.join(' ')}"/></clipPath>`);
        this.state.clipId = id;
    }

    // ===== rectangles ====================================================

    clearRect(x: number, y: number, w: number, h: number): void {
        // Nothing to clear in a document that is built up rather than painted over: SVG has no
        // eraser, and the first thing written is the background anyway.
        void x; void y; void w; void h;
    }

    fillRect(x: number, y: number, w: number, h: number): void {
        this.emit(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ${this.fillAttrs()}/>`);
    }

    strokeRect(x: number, y: number, w: number, h: number): void {
        this.emit(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none" ${this.strokeAttrs()}/>`);
    }

    // ===== text ==========================================================

    fillText(text: string, x: number, y: number, maxWidth?: number): void {
        if (text === '') return;

        const anchor = ANCHOR[this.state.textAlign] ?? 'start';
        const baseline = BASELINE[this.state.textBaseline] ?? 'alphabetic';

        // Canvas squeezes the glyphs to fit maxWidth; SVG needs to be told, and only when the text
        // would actually overflow -- textLength on text that already fits would stretch it.
        // Dropping the argument left node titles and zone captions running past the box the
        // renderer had sized for them, so the vector export disagreed with the raster one.
        let constraint = '';
        if (maxWidth !== undefined && maxWidth > 0 && this.measureText(text).width > maxWidth) {
            constraint = ` textLength="${n(maxWidth)}" lengthAdjust="spacingAndGlyphs"`;
        }

        // The canvas font string is CSS font shorthand, so it transfers verbatim -- no parsing, and
        // no chance of losing the weight or the fallback list on the way.
        this.emit(
            `<text x="${n(x)}" y="${n(y)}" style="font:${escapeXml(this.state.font)}" ` +
            `text-anchor="${anchor}" dominant-baseline="${baseline}"${constraint} ${this.fillAttrs()}>` +
            `${escapeXml(text)}</text>`);
    }

    measureText(text: string): { width: number } {
        if (this.metrics !== null) return { width: this.metrics.measureText(text).width };

        // Without a context to ask, a rough advance keeps layout sane rather than collapsing to
        // zero and stacking every label at one point.
        const size = parseFloat(this.state.font) || 10;
        return { width: text.length * size * 0.55 };
    }

    // ===== images ========================================================

    drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void {
        const href = this.imageHref(image);
        if (href === null) return;

        this.emit(`<image x="${n(dx)}" y="${n(dy)}" width="${n(dw)}" height="${n(dh)}" href="${escapeXml(href)}"${this.commonAttrs()}/>`);
    }

    private imageHref(image: CanvasImageSource): string | null {
        try {
            if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) return image.toDataURL();
            if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) return image.src;
        } catch {
            // A canvas tainted by a cross-origin draw refuses toDataURL. Dropping the image beats
            // failing the whole export for one picture.
            return null;
        }
        return null;
    }

    // ===== output ========================================================

    /** The finished document. Safe to call more than once; it does not consume the recording. */
    toSvg(): string {
        const background = this.background === undefined
            ? ''
            : `<rect width="100%" height="100%" fill="${escapeXml(this.background)}"/>`;

        const defs = this.defs.length === 0 ? '' : `<defs>${this.defs.join('')}</defs>`;

        return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(this.width)}" height="${n(this.height)}" ` +
            `viewBox="0 0 ${n(this.width)} ${n(this.height)}">` +
            `${defs}${background}${this.body.join('')}</svg>`;
    }

    // ===== internals =====================================================

    private emit(element: string): void {
        this.body.push(element);
    }

    private commonAttrs(): string {
        const parts: string[] = [];

        if (!isIdentity(this.state.matrix)) {
            parts.push(` transform="matrix(${this.state.matrix.map(n).join(' ')})"`);
        }

        if (this.state.globalAlpha !== 1) parts.push(` opacity="${n(this.state.globalAlpha)}"`);
        if (this.state.clipId !== null) parts.push(` clip-path="url(#${this.state.clipId})"`);

        return parts.join('');
    }

    private fillAttrs(): string {
        return `fill="${escapeXml(this.state.fillStyle)}"${this.commonAttrs()}`;
    }

    private strokeAttrs(): string {
        const parts = [
            `stroke="${escapeXml(this.state.strokeStyle)}"`,
            `stroke-width="${n(this.state.lineWidth)}"`,
        ];

        if (this.state.lineJoin !== 'miter') parts.push(`stroke-linejoin="${this.state.lineJoin}"`);
        if (this.state.lineCap !== 'butt') parts.push(`stroke-linecap="${this.state.lineCap}"`);
        if (this.state.dash.length > 0) parts.push(`stroke-dasharray="${this.state.dash.map(n).join(' ')}"`);

        return parts.join(' ') + this.commonAttrs();
    }
}
