// Shared read-only diagram embed layer. Rendering, palette loading and theming
// live next to the diagram engine so web applications do not copy that logic.
//
// renderScheme draws a scheme supplied by the caller. renderAll,
// renderFromSource and renderFromInline discover .ss-diagram-host elements and
// load a schema from a URL or embedded JSON. Every failure degrades to a short
// inline note instead of throwing.
// StockSharpDiagram uses the canvas renderer directly, so this module is
// self-contained and uses the same public component as the editor.
import { StockSharpDiagram } from './diagram/stocksharp-diagram.js';
import { StockSharpCatalog } from './diagram/catalog.js';
import { DiagramNode, Link, Node, Port, PortType } from './diagram/types.js';
import type { FullscreenRequestedPayload } from './diagram/api.js';
import { toPortDynamicMode } from './core/model.js';
import type { PortDynamicMode } from './core/model.js';

interface PalettePort {
	key: string;
	name: string;
	type: string;
	maxLinks?: number;
	availableTypes?: string[];
	isDynamic?: boolean;
	dynamicMode?: PortDynamicMode;
}

interface PaletteElement {
	typeId: string;
	name: string;
	groupName: string;
	icon: string;
	inPorts: PalettePort[];
	outPorts: PalettePort[];
}

interface Palette {
	socketTypes: { name: string; color: string }[];
	elements: PaletteElement[];
}

export interface DiagramEmbedSchemeNode { id: string; typeId: string; name: string; x: number; y: number; }
export interface DiagramEmbedSchemeLink { from: string; fromPort: string; to: string; toPort: string; }
export interface DiagramEmbedScheme {
	nodes: DiagramEmbedSchemeNode[];
	links: DiagramEmbedSchemeLink[];
}

export interface DiagramEmbedHandle {
	readonly host: HTMLElement;
	readonly diagram: StockSharpDiagram;
	readonly destroyed: boolean;
	destroy(): void;
}

export interface DiagramEmbedOptions {
	onFullscreenRequested?: (
		request: FullscreenRequestedPayload,
		handle: DiagramEmbedHandle,
	) => void;
	onDestroyed?: (handle: DiagramEmbedHandle) => void;
}

const PALETTE_URL = '/data/designer-palette.json';
const activeRenders = new WeakMap<HTMLElement, DiagramEmbedHandle>();
const connectedRenders = new Set<DiagramEmbedHandle>();
const renderRevisions = new WeakMap<HTMLElement, number>();
let disconnectedHostObserver: MutationObserver | null = null;

function iconUrl(name: string): string {
	return name ? `/diagram-icons/${name}.svg` : '';
}

// Perceived luminance (0..255) of a #rrggbb colour; used to tell a light diagram canvas from a dark
// one so the (dark-canvas-tuned) link palette can be darkened when the canvas is light.
function luminance(hex: string): number {
	const m = hex.match(/^#?([0-9a-fA-F]{6})$/);
	if (m === null)
		return 0;
	const n = parseInt(m[1], 16);
	return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

function makePort(p: PalettePort): Port {
	return new Port({
		id: p.key,
		name: p.name,
		type: p.type,
		maxLinks: p.maxLinks ?? 0,
		availableTypes: p.availableTypes ?? [],
		isDynamic: p.isDynamic ?? false,
		dynamicMode: p.dynamicMode ?? '',
	});
}

function buildCatalog(palette: Palette): StockSharpCatalog {
	const catalog = new StockSharpCatalog();

	for (const st of palette.socketTypes)
		catalog.addPortType(new PortType({ name: st.name, color: st.color }));

	for (const el of palette.elements) {
		catalog.addNodeType(new Node({
			id: el.typeId,
			name: el.name,
			groupName: el.groupName,
			icon: iconUrl(el.icon),
			inPorts: el.inPorts.map(makePort),
			outPorts: el.outPorts.map(makePort),
		}));
	}

	return catalog;
}

interface ConvertedDiagramNodes {
	nodes: DiagramNode[];
	nodeErrors: Record<string, string>;
}

function toDiagramNodes(
	scheme: DiagramEmbedScheme,
	catalog: StockSharpCatalog,
	missingTypeMessage: (typeId: string) => string,
): ConvertedDiagramNodes {
	const portOf = (p: Port) => ({ id: p.id, name: p.name, type: p.type, maxLinks: p.maxLinks });
	const nodeErrors: Record<string, string> = {};

	const usedIn = new Map<string, Set<string>>();
	const usedOut = new Map<string, Set<string>>();
	const add = (m: Map<string, Set<string>>, id: string, port: string) => {
		(m.get(id) ?? m.set(id, new Set()).get(id)!).add(port);
	};
	for (const l of scheme.links) {
		add(usedOut, l.from, l.fromPort);
		add(usedIn, l.to, l.toPort);
	}

	const nodes = scheme.nodes.map((n) => {
		const t = catalog.getNodeType(n.typeId);
		const inPorts = t ? t.inPorts.map(portOf) : [];
		const outPorts = t ? t.outPorts.map(portOf) : [];
		const anchorType = (t?.inPorts.find((p) => p.isDynamic)?.type) ?? 'Any';

		for (const key of usedIn.get(n.id) ?? [])
			if (!inPorts.some((p) => p.id === key))
				inPorts.push({ id: key, name: key, type: anchorType, maxLinks: 0 });

		for (const key of usedOut.get(n.id) ?? [])
			if (!outPorts.some((p) => p.id === key))
				outPorts.push({ id: key, name: key, type: 'Any', maxLinks: 0 });

		const data = new DiagramNode({ id: n.id, typeId: n.typeId, name: n.name, x: n.x, y: n.y, inPorts, outPorts });

		if (t?.icon)
			data.icon = t.icon;

		if (!t) {
			data.isPlaceholder = true;
			nodeErrors[n.id] = missingTypeMessage(n.typeId);
		}

		return data;
	});

	return { nodes, nodeErrors };
}

// Walk the persisted Content.Value.Scheme.Model.{Nodes,Links} structure into
// the thin scheme. Defensive at every field so a partially
// broken document yields as many nodes as are readable; a wholly unusable one yields an empty scheme.
// Every reader below narrows rather than asserts: the input is arbitrary JSON
// from a URL or an inline <script>, so a type assertion here would only be a
// promise the data never made. Anything unreadable is skipped, never thrown on.
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function asFiniteNumber(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nodeName(node: Record<string, unknown>): string {
	const named = asRecord(asRecord(asRecord(node.Settings)?.Parameters)?.Name)?.Value;
	if (typeof named === 'string' && named.length > 0)
		return named;
	const figure = asString(node.Figure);
	return figure.length > 0 ? figure : asString(node.Key);
}

function parseRawScheme(raw: unknown): DiagramEmbedScheme {
	const nodes: DiagramEmbedSchemeNode[] = [];
	const links: DiagramEmbedSchemeLink[] = [];

	const model = asRecord(asRecord(asRecord(asRecord(raw)?.Content)?.Value)?.Scheme)?.Model;
	const fields = asRecord(model);
	if (fields === undefined)
		return { nodes, links };

	for (const entry of asArray(fields.Nodes)) {
		const node = asRecord(entry);
		if (node === undefined)
			continue;
		const key = node.Key;
		if (typeof key !== 'string' || key.length === 0)
			continue;
		nodes.push({
			id: key,
			typeId: asString(node.TypeId),
			name: nodeName(node),
			x: asFiniteNumber(node.X),
			y: asFiniteNumber(node.Y),
		});
	}

	for (const entry of asArray(fields.Links)) {
		const link = asRecord(entry);
		if (link === undefined)
			continue;
		const from = link.From;
		const to = link.To;
		if (typeof from !== 'string' || typeof to !== 'string')
			continue;
		links.push({
			from,
			fromPort: asString(link.FromPort),
			to,
			toPort: asString(link.ToPort),
		});
	}

	return { nodes, links };
}

function parsePalettePorts(value: unknown): PalettePort[] {
	const ports: PalettePort[] = [];
	for (const entry of asArray(value)) {
		const port = asRecord(entry);
		if (port === undefined)
			continue;
		const key = asString(port.key);
		if (key.length === 0)
			continue;
		ports.push({
			key,
			name: asString(port.name),
			type: asString(port.type),
			maxLinks: asFiniteNumber(port.maxLinks),
			availableTypes: asArray(port.availableTypes).filter((item): item is string => typeof item === 'string'),
			isDynamic: port.isDynamic === true,
			dynamicMode: toPortDynamicMode(port.dynamicMode),
		});
	}
	return ports;
}

function parsePalette(value: unknown): Palette {
	const socketTypes: Palette['socketTypes'] = [];
	const elements: PaletteElement[] = [];
	const root = asRecord(value);
	if (root === undefined)
		return { socketTypes, elements };

	for (const entry of asArray(root.socketTypes)) {
		const socket = asRecord(entry);
		const name = asString(socket?.name);
		if (name.length === 0)
			continue;
		socketTypes.push({ name, color: asString(socket?.color) });
	}

	for (const entry of asArray(root.elements)) {
		const element = asRecord(entry);
		const typeId = asString(element?.typeId);
		if (element === undefined || typeId.length === 0)
			continue;
		elements.push({
			typeId,
			name: asString(element.name),
			groupName: asString(element.groupName),
			icon: asString(element.icon),
			inPorts: parsePalettePorts(element.inPorts),
			outPorts: parsePalettePorts(element.outPorts),
		});
	}

	return { socketTypes, elements };
}

export async function renderScheme(
	div: HTMLElement,
	paletteUrl: string,
	scheme: DiagramEmbedScheme,
	options: DiagramEmbedOptions = {},
): Promise<DiagramEmbedHandle | null> {
	return renderSchemeAtRevision(div, paletteUrl, scheme, beginRender(div), options);
}

async function renderSchemeAtRevision(
	div: HTMLElement,
	paletteUrl: string,
	scheme: DiagramEmbedScheme,
	revision: number,
	options: DiagramEmbedOptions,
): Promise<DiagramEmbedHandle | null> {
	if (renderRevisions.get(div) !== revision)
		return null;
	// Same treatment the schema fetch gets: a non-2xx answer is a failure, not a
	// body to parse. Callers that degrade already catch it.
	const response = await fetch(paletteUrl);
	if (!response.ok)
		throw new Error(`Palette request to ${paletteUrl} failed with status ${response.status}.`);
	const palette = parsePalette(await response.json());
	if (renderRevisions.get(div) !== revision)
		return null;
	const catalog = buildCatalog(palette);

	disposeActiveRender(div);
	div.classList.remove('ss-diagram-error');
	div.replaceChildren();
	// The host page passes its wording the same way it passes the error texts: through the dataset,
	// "enter|exit". Left out, the button keeps its English defaults.
	const [enterLabel, exitLabel] = (div.dataset.diagramFullscreen ?? '').split('|');

	let diagram: StockSharpDiagram;
	try {
		diagram = new StockSharpDiagram({
			div,
			catalog,
			...(enterLabel && exitLabel ? { fullscreenLabels: { enter: enterLabel, exit: exitLabel } } : {}),
		});
	} catch (error) {
		div.replaceChildren();
		throw error;
	}
	const cleanups: Array<() => void> = [];
	const timers = new Set<ReturnType<typeof setTimeout>>();
	let destroyed = false;
	const schedule = (callback: () => void, delay: number) => {
		const timer = setTimeout(() => {
			timers.delete(timer);
			if (!destroyed) callback();
		}, delay);
		timers.add(timer);
	};
	const handle: DiagramEmbedHandle = {
		host: div,
		diagram,
		get destroyed() { return destroyed; },
		destroy() {
			if (destroyed) return;
			destroyed = true;
			if (options.onDestroyed !== undefined) {
				try { options.onDestroyed(handle); }
				catch (error) { console.error(error); }
			}
			for (const timer of timers) clearTimeout(timer);
			timers.clear();
			for (const cleanup of cleanups.splice(0).reverse()) cleanup();
			diagram.destroy();
			connectedRenders.delete(handle);
			if (activeRenders.get(div) === handle) {
				activeRenders.delete(div);
				delete div.dataset.rendered;
			}
			stopDisconnectedHostObserverWhenIdle();
		},
	};
	activeRenders.set(div, handle);
	connectedRenders.add(handle);
	ensureDisconnectedHostObserver();
	if (options.onFullscreenRequested !== undefined) {
		const notifyHost = options.onFullscreenRequested;
		cleanups.push(diagram.on('fullscreenRequested', (request) => notifyHost(request, handle)));
	}

	try {
		// Follow the site theme: the canvas colour comes from the live --diagram-bg CSS token; a theme toggle
		// repaints it. Nodes are self-contained light-grey boxes, so only the canvas behind them is themed.
		const applyDiagramTheme = () => {
			const cs = getComputedStyle(document.documentElement);
			const bg = cs.getPropertyValue('--diagram-bg').trim() || '#1b1b1f';
			const gridColor = cs.getPropertyValue('--diagram-grid').trim() || '#26262c';
			diagram.setTheme({
				diagramBackground: bg,
				gridColor,
				linkMaxLightness: luminance(bg) > 140 ? 0.42 : 1,
			});
		};
		applyDiagramTheme();
		const themeObserver = new MutationObserver(applyDiagramTheme);
		themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		cleanups.push(() => themeObserver.disconnect());
		diagram.setReadOnly(true);

		diagram.setLinkValidator(() => true);
		diagram.setOverviewVisible(false);
		const missingTypeTemplate = div.dataset.diagramMissingElement
			?? 'Element type "{typeId}" is missing from the palette.';
		const converted = toDiagramNodes(
			scheme,
			catalog,
			(typeId) => missingTypeTemplate.replace('{typeId}', typeId || '(empty)'),
		);
		diagram.load(
			converted.nodes,
			scheme.links.map((link) => new Link({
				outNode: link.from,
				outPort: link.fromPort,
				inNode: link.to,
				inPort: link.toPort,
			})),
			{ nodeErrors: converted.nodeErrors },
		);

		const fit = () => {
			if (!div.isConnected) {
				handle.destroy();
				return;
			}
			const w = div.clientWidth, h = div.clientHeight;
			if (w < 2 || h < 2)
				return;
			diagram.resize(w, h);
			diagram.zoomToFit();
		};

		schedule(fit, 0);

		let scheduled = false;
		const scheduleFit = (delay = 50) => {
			if (scheduled) return;
			scheduled = true;
			schedule(() => { scheduled = false; fit(); }, delay);
		};
		if (typeof ResizeObserver !== 'undefined') {
			const observer = new ResizeObserver(() => scheduleFit());
			observer.observe(div);
			cleanups.push(() => observer.disconnect());
		} else {
			const onResize = () => scheduleFit();
			window.addEventListener('resize', onResize);
			cleanups.push(() => window.removeEventListener('resize', onResize));
		}

		div.dataset.rendered = '1';
		return handle;
	} catch (error) {
		handle.destroy();
		throw error;
	}
}

export function destroyRenderedDiagram(div: HTMLElement): boolean {
	beginRender(div);
	return disposeActiveRender(div);
}

function disposeActiveRender(div: HTMLElement): boolean {
	const handle = activeRenders.get(div);
	if (handle === undefined) return false;
	handle.destroy();
	return true;
}

function beginRender(div: HTMLElement): number {
	const revision = (renderRevisions.get(div) ?? 0) + 1;
	renderRevisions.set(div, revision);
	return revision;
}

function ensureDisconnectedHostObserver(): void {
	if (disconnectedHostObserver !== null || typeof MutationObserver === 'undefined') return;
	disconnectedHostObserver = new MutationObserver(() => {
		for (const handle of [...connectedRenders]) {
			if (!handle.host.isConnected) handle.destroy();
		}
	});
	disconnectedHostObserver.observe(document.documentElement, { childList: true, subtree: true });
}

function stopDisconnectedHostObserverWhenIdle(): void {
	if (connectedRenders.size > 0 || disconnectedHostObserver === null) return;
	disconnectedHostObserver.disconnect();
	disconnectedHostObserver = null;
}

interface EmbedErrorTexts {
	load: string;
	empty: string;
	draw: string;
}

// The host overrides the inline notes with data-diagram-errors="load|empty|draw".
// Each slot falls back when it is empty rather than when it is absent: split on a
// missing attribute yields [''], one present empty string, so a destructuring
// default would never fire and the note would render blank.
function errorTexts(div: HTMLElement): EmbedErrorTexts {
	const parts = (div.dataset.diagramErrors ?? '').split('|');
	return {
		load: parts[0] || 'Diagram source could not be loaded.',
		empty: parts[1] || 'Diagram is empty or malformed.',
		draw: parts[2] || 'Diagram could not be rendered.',
	};
}

function note(div: HTMLElement, message: string, revision: number): void {
	if (renderRevisions.get(div) !== revision) return;
	disposeActiveRender(div);
	div.textContent = message;
	div.classList.add('ss-diagram-error');
}

// Fetch the raw schema JSON from srcUrl, transform it and draw it. Every failure mode -- an
// unreachable source, a non-JSON / malformed body, or an empty schema -- degrades to a short inline note
// instead of throwing, so a bad @diagram never breaks the surrounding page.
export async function renderFromSource(
	div: HTMLElement,
	paletteUrl: string,
	srcUrl: string,
	options: DiagramEmbedOptions = {},
): Promise<DiagramEmbedHandle | null> {
	const revision = beginRender(div);
	const errors = errorTexts(div);

	let raw: unknown;
	try {
		const resp = await fetch(srcUrl);
		if (!resp.ok) { note(div, errors.load, revision); return null; }
		const text = (await resp.text()).replace(/^﻿/, '');
		raw = JSON.parse(text);
	} catch {
		note(div, errors.load, revision);
		return null;
	}

	const scheme = parseRawScheme(raw);
	if (scheme.nodes.length === 0) {
		note(div, errors.empty, revision);
		return null;
	}

	try {
		return await renderSchemeAtRevision(div, paletteUrl, scheme, revision, options);
	} catch {
		note(div, errors.draw, revision);
		return null;
	}
}

// Draw a host whose schema JSON is embedded inline (a
// <script type="application/json"> child holds the schema). Same degradation as renderFromSource: a
// malformed/empty schema shows an inline note instead of throwing.
export async function renderFromInline(
	div: HTMLElement,
	paletteUrl: string,
	json: string,
	options: DiagramEmbedOptions = {},
): Promise<DiagramEmbedHandle | null> {
	const revision = beginRender(div);
	const errors = errorTexts(div);

	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		note(div, errors.empty, revision);
		return null;
	}

	const scheme = parseRawScheme(raw);
	if (scheme.nodes.length === 0) {
		note(div, errors.empty, revision);
		return null;
	}

	try {
		return await renderSchemeAtRevision(div, paletteUrl, scheme, revision, options);
	} catch {
		note(div, errors.draw, revision);
		return null;
	}
}

// Render every not-yet-rendered diagram host under root (default: the whole document). Callable again after
// dynamic HTML is injected (e.g. the editor preview) to draw hosts that just appeared. A host either points
// at a source URL (data-diagram-src) or embeds its schema JSON inline (a <script type="application/json">).
export function renderAll(root: ParentNode = document, options: DiagramEmbedOptions = {}): void {
	root.querySelectorAll<HTMLElement>('.ss-diagram-host').forEach((host) => {
		if (host.dataset.rendered === '1')
			return;

		const src = host.dataset.diagramSrc;
		if (src) {
			host.dataset.rendered = '1';
			void renderFromSource(host, PALETTE_URL, src, options);
			return;
		}

		const inline = host.querySelector('script[type="application/json"]');
		if (inline) {
			host.dataset.rendered = '1';
			void renderFromInline(host, PALETTE_URL, inline.textContent ?? '', options);
		}
	});
}
