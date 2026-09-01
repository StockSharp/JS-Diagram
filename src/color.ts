// Colour arithmetic shared by the parts that have to stay readable against a
// fill they do not choose: the embed host reading a page's background, and the
// renderer drawing a title on a node whose colour comes from the scheme.

const CSS_COLOR_KEYWORDS: Readonly<Record<string, [number, number, number]>> = {
	white: [255, 255, 255],
	black: [0, 0, 0],
	transparent: [255, 255, 255],
};

/**
 * Channels of a CSS colour, or null when it cannot be read.
 *
 * Understands the keywords above, three-, six- and eight-digit hex (the alpha is
 * ignored), and rgb()/rgba() in both the comma and the space syntax.
 */
function parseRgb(color: string): [number, number, number] | null {
	const value = color.trim().toLowerCase();
	if (value === '')
		return null;

	const keyword = CSS_COLOR_KEYWORDS[value];
	if (keyword !== undefined)
		return [...keyword];

	const long = value.match(/^#?([0-9a-f]{6})$/);
	if (long !== null) {
		const n = parseInt(long[1], 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}

	// #abc is shorthand for #aabbcc, and the eight-digit forms carry an alpha we ignore.
	const short = value.match(/^#?([0-9a-f]{3})([0-9a-f])?$/);
	if (short !== null) {
		const [r, g, b] = [...short[1]].map((digit) => parseInt(digit + digit, 16));
		return [r, g, b];
	}

	const long8 = value.match(/^#?([0-9a-f]{6})[0-9a-f]{2}$/);
	if (long8 !== null) {
		const n = parseInt(long8[1], 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}

	const rgb = value.match(/^rgba?\(([^)]+)\)$/);
	if (rgb !== null) {
		const parts = rgb[1].split(/[\s,/]+/).filter((part) => part !== '');
		if (parts.length >= 3) {
			const [r, g, b] = parts.slice(0, 3).map((part) => part.endsWith('%')
				? (parseFloat(part) / 100) * 255
				: parseFloat(part));
			if ([r, g, b].every((channel) => Number.isFinite(channel)))
				return [r, g, b];
		}
	}

	return null;
}

/**
 * Perceived brightness of a CSS colour, or -1 when it cannot be read.
 *
 * Six-digit hex was the only form understood, and everything else answered 0 -- black. A page
 * writing --diagram-bg as #fff, white or rgb(255 255 255) therefore had its white canvas
 * classified as dark and got the dark link palette: near-white wires on a near-white background.
 * Unreadable is now -1 rather than 0, so the caller can keep its own default instead of being
 * told the page is black.
 */
export function luminance(color: string): number {
	const rgb = parseRgb(color);
	if (rgb === null)
		return -1;

	const [r, g, b] = rgb;
	return 0.299 * r + 0.587 * g + 0.114 * b;
}

const DARK_TEXT = '#1b1b1b';
const LIGHT_TEXT = '#f5f5f5';

/// One channel on the scale contrast is measured on, where equal steps look
/// equally different rather than merely being equal numbers.
function toLinear(channel: number): number {
	const v = channel / 255;
	return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/// Relative luminance as WCAG defines it, or -1 for a colour that cannot be read.
function relativeLuminance(color: string): number {
	const rgb = parseRgb(color);
	if (rgb === null)
		return -1;

	const [r, g, b] = rgb;
	return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/// WCAG contrast ratio between two relative luminances: 1 for identical, 21 for
/// black against white.
function contrast(a: number, b: number): number {
	const [lighter, darker] = a > b ? [a, b] : [b, a];
	return (lighter + 0.05) / (darker + 0.05);
}

/// Title colour for a body filled with `fill`.
///
/// A node's fill comes from the scheme rather than the theme, so it can be any
/// colour, and a title fixed to one shade disappears as soon as a node is filled
/// close to it. Rather than split the range at a brightness someone has to pick,
/// this measures both candidates against the fill and takes whichever stands out
/// more. That is also why a saturated orange keeps its dark title where a plain
/// brightness test, which reads such a colour as darker than it looks, flips it.
///
/// A fill this cannot read keeps the dark title: every node shipped so far is
/// light, so guessing light text would fail on more of them than it fixes.
export function readableTextOn(fill: string): string {
	const background = relativeLuminance(fill);
	if (background < 0)
		return DARK_TEXT;

	return contrast(background, relativeLuminance(LIGHT_TEXT))
		> contrast(background, relativeLuminance(DARK_TEXT))
		? LIGHT_TEXT
		: DARK_TEXT;
}

// Opaque on purpose: a translucent edge takes part of its colour from the fill underneath, so
// two sockets side by side end up with visibly different edges and the one rule looks like two.
const DARK_OUTLINE = '#3a3d45';
const LIGHT_OUTLINE = '#c8ccd4';

/// Outline colour for a shape drawn on `surface`.
///
/// A socket is filled with its type's colour, which comes from the host and spans the whole
/// range -- StockSharp sends #000000 for Any. What the outline has to separate the socket
/// from is the canvas, so it is measured against the canvas: one outline for every socket on
/// it, and none of them left without an edge. Choosing per fill instead would edge two
/// neighbouring sockets differently, which reads as a mistake rather than as a rule.
///
/// A surface this cannot read keeps the dark outline, for the same reason the title stays
/// dark: the canvas shipped so far is dark, and a light outline on a light one would vanish.
export function readableOutlineOn(surface: string): string {
	const background = relativeLuminance(surface);
	if (background < 0)
		return DARK_OUTLINE;

	return contrast(background, relativeLuminance(LIGHT_OUTLINE))
		> contrast(background, relativeLuminance(DARK_OUTLINE))
		? LIGHT_OUTLINE
		: DARK_OUTLINE;
}

/// A colour's hue, saturation and lightness, or null when it cannot be read.
function toHsl(color: string): [number, number, number] | null {
	const hsl = color.trim().match(/^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i);
	if (hsl !== null)
		return [+hsl[1], +hsl[2] / 100, +hsl[3] / 100];

	const rgb = parseRgb(color);
	if (rgb === null)
		return null;

	const [r, g, b] = rgb.map((channel) => channel / 255);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const lightness = (max + min) / 2;

	if (max === min)
		return [0, 0, lightness];

	const span = max - min;
	const saturation = lightness > 0.5 ? span / (2 - max - min) : span / (max + min);
	const hue = max === r
		? ((g - b) / span + (g < b ? 6 : 0))
		: max === g
			? (b - r) / span + 2
			: (r - g) / span + 4;

	return [hue * 60, saturation, lightness];
}

/// Lightest a colour may be drawn on a light canvas, and darkest on a dark one. Wide enough
/// that a hue is still itself, narrow enough that neither end of the palette disappears.
const DARK_CANVAS_FLOOR = 0.42;
const LIGHT_CANVAS_CEILING = 0.45;

/// The same colour, moved into the band the canvas leaves room for.
///
/// A socket type's colour belongs to the host and spans the whole range -- StockSharp sends
/// #000000 for Any and near-white for Side. As a socket that is fine: it is a filled square
/// with an outline. As a wire it is a thin line with nothing behind it, so a colour at the
/// same end of the range as the canvas cannot be seen at all. Only the lightness moves; the
/// hue and saturation are the host's answer to which type this is, and are left alone.
///
/// A colour that already sits in the band is returned exactly as it came, and one that cannot
/// be read is passed through: guessing at it would be worse than drawing what was asked for.
export function legibleOn(color: string, background: string): string {
	const hsl = toHsl(color);
	if (hsl === null)
		return color;

	const canvas = relativeLuminance(background);
	const [hue, saturation, lightness] = hsl;
	const moved = canvas < 0
		? lightness
		: canvas > 0.18
			? Math.min(lightness, LIGHT_CANVAS_CEILING)
			: Math.max(lightness, DARK_CANVAS_FLOOR);

	if (moved === lightness && /^hsl/i.test(color.trim()))
		return color;

	return `hsl(${Math.round(hue * 10) / 10}, ${Math.round(saturation * 1000) / 10}%, ${Math.round(moved * 1000) / 10}%)`;
}

/// The same colour with its lightness capped at `maxLightness` (0..1), hue and saturation kept.
///
/// Any colour, not only one already written as hsl(): a host's palette arrives as hex, and a
/// ceiling that only understood one notation left exactly those colours uncapped -- so a light
/// theme darkened the hues the control invents and left the ones it was given.
///
/// A colour that cannot be read is returned untouched.
export function cappedLightness(color: string, maxLightness: number): string {
	const hsl = toHsl(color);
	if (hsl === null)
		return color;

	const [hue, saturation, lightness] = hsl;
	if (lightness <= maxLightness)
		return color;

	return `hsl(${Math.round(hue * 10) / 10}, ${Math.round(saturation * 1000) / 10}%, ${Math.round(maxLightness * 1000) / 10}%)`;
}
