/**
 * The drawing operations the renderer actually uses, and nothing more.
 *
 * The renderer paints straight onto a 2D context, which means the picture only ever exists as
 * pixels: a screenshot can be taken, but there is no vector form to export. Naming the surface it
 * draws against is what makes a second backend possible without a second renderer -- one that emits
 * SVG. Two renderers would be two truths about how a node looks, and they would drift.
 *
 * The member list is deliberately a subset of CanvasRenderingContext2D with identical names and
 * semantics. TypeScript matches types structurally, so the browser's own context satisfies this
 * without a wrapper: the on-screen path keeps calling the real thing directly, at no cost and with
 * no behaviour to re-verify.
 */
export interface DrawSurface {
    // ----- state -----
    fillStyle: string | CanvasGradient | CanvasPattern;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    lineWidth: number;
    lineJoin: CanvasLineJoin;
    lineCap: CanvasLineCap;
    globalAlpha: number;
    font: string;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;

    save(): void;
    restore(): void;
    setLineDash(segments: readonly number[]): void;

    // ----- transform -----
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    translate(x: number, y: number): void;
    rotate(angle: number): void;

    // ----- paths -----
    beginPath(): void;
    closePath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
    arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
    fill(): void;
    stroke(): void;
    clip(): void;

    // ----- rectangles -----
    clearRect(x: number, y: number, w: number, h: number): void;
    fillRect(x: number, y: number, w: number, h: number): void;
    strokeRect(x: number, y: number, w: number, h: number): void;

    // ----- text -----
    fillText(text: string, x: number, y: number, maxWidth?: number): void;
    /**
     * Only `width` is read by the renderer. An SVG backend has no font engine of its own and
     * borrows a real 2D context for this, so text lands in exactly the same place in both outputs.
     */
    measureText(text: string): { width: number };

    // ----- images -----
    drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
}
