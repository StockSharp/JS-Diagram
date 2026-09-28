import {
    parseDiagramDocument,
    serializeDiagramDocument,
} from '../core/document.js';
import {
    parseDiagramViewState,
    serializeDiagramViewState,
} from '../core/view-state.js';
import type { DiagramDocument, PortDynamicMode } from '../core/model.js';
import { DiagramActionRegistry } from '../core/action-registry.js';
import type {
    DiagramGlobalErrorKind,
    DiagramInteractionPermissions,
    DiagramPortRuntimeState,
    DiagramRuntimeState,
    DiagramSelection,
    DiagramSnapshot,
    DiagramViewState,
} from '../core/state.js';
import {
    Diagram as CanvasDiagram,
    type DiagramNodeInit as CanvasNodeInit,
    type LinkInit as CanvasLinkInit,
    type LinkModel,
    type NodeModel,
    type PortInit as CanvasPortInit,
    type PortModel,
} from '../canvas-renderer.js';
import { StockSharpCatalog } from './catalog.js';
import { ContextMenuView } from './context-menu.js';
import { t } from '../i18n.js';
import { EventEmitter } from './event-emitter.js';
import type {
    DiagramEvents,
    DiagramClipboard,
    ContextCommand,
    ContextCommandGroup,
    ContextCommandState,
    ContextMenuItemState,
    DiagramLoadOptions,
    DiagramFullscreenLabels,
    DiagramGridSettings,
    DiagramNodeBounds,
    DiagramPoint,
    DiagramOptions,
    DiagramScreenshotOptions,
    DiagramThemeOptions,
    LinkValidationResult,
    LinkValidator,
    NodeErrorKind,
    NodeErrorOptions,
} from './api.js';
import {
    DiagramNode,
    Link,
    Node,
    Port,
    type PortDirection,
    type PortUpdate,
} from './types.js';

interface ContextActionContext {
    selection: DiagramSelection;
    nodes: DiagramNode[];
    links: Link[];
    /** The whole diagram, not the selection: export offers the picture as a whole. */
    document: DiagramDocument;
}

type ContextMenuEntry = ContextCommand | { group: ContextCommandGroup; commands: readonly ContextCommand[] };

/**
 * Menu order, and the only place the nesting is declared. The registry is flat because
 * every command must be runnable by id, so the shape of the menu cannot live there.
 * A command missing from this list would be executable and never offered; the test suite
 * walks both and refuses to let the two drift.
 */
const CONTEXT_MENU: readonly ContextMenuEntry[] = [
    'undo', 'redo',
    'cut', 'copy', 'paste',
    'open',
    'delete',
    { group: 'export', commands: ['exportDocument', 'exportPng', 'exportSvg'] },
    'overview',
    'properties',
    'help',
];

/** Commands that toggle rather than do, so the menu reports their state instead of just enabling them. */
const CONTEXT_CHECKED: Partial<Record<ContextCommand, (diagram: StockSharpDiagram) => boolean>> = {
    overview: (diagram) => diagram.getViewState().overviewVisible,
};

export class StockSharpDiagram extends EventEmitter<DiagramEvents> {
    private readonly div: HTMLElement;
    private readonly catalog: StockSharpCatalog;
    private readonly fullscreenButton: HTMLButtonElement;
    // Built only where a host asked for it: a control nobody asked to save gets no button at all.
    private downloadButton: HTMLButtonElement | null = null;
    private readonly overviewContainer: HTMLElement | null;
    private readonly zoomLabel: HTMLElement | null;
    private readonly canvas: CanvasDiagram;
    private readonly clipboard: DiagramClipboard | null;
    private readonly disposables: Array<() => void> = [];
    private idCounter = 1;
    private undoEnabled = true;
    private redoEnabled = true;
    private helpEnabled = true;
    private loading = false;
    private destroyed = false;
    private fullscreen = false;
    private fullscreenButtonVisible = true;
    private downloadButtonVisible = false;
    private downloadLabel: string | null = null;
    // null means the host never named the button, so its wording comes from the shared bundle.
    // Keeping the two apart is what lets an explicit label win while an untouched control still
    // follows the page's language instead of being stuck in English.
    private fullscreenLabels: DiagramFullscreenLabels | null = null;
    private readonly contextActions = new DiagramActionRegistry<ContextCommand, ContextActionContext>();
    private contextMenu: ContextMenuView | null = null;

    constructor(options: DiagramOptions) {
        super();
        this.div = options.div;
        this.catalog = options.catalog;
        this.overviewContainer = options.overviewContainer ?? null;
        this.zoomLabel = options.zoomLabel ?? null;
        this.clipboard = this.resolveClipboard(options.clipboard);
        this.canvas = new CanvasDiagram({
            host: this.div,
            typeColors: this.portTypeColors(),
            gridSnap: options.gridSnap ?? true,
            gridSize: options.gridSize,
            pageScroll: options.pageScroll ?? false,
        });
        this.fullscreenButtonVisible = options.showFullscreenButton ?? true;
        this.fullscreenLabels = options.fullscreenLabels ?? null;
        this.prepareFullscreenButtonHost();
        this.fullscreenButton = this.createFullscreenButton();
        this.updateFullscreenButton();
        this.downloadLabel = options.downloadLabel ?? null;
        this.setDownloadButtonVisible(options.showDownloadButton ?? false);
        this.setContextMenuEnabled(options.showContextMenu ?? true);
        // The keyboard is an entry point like the menu and the toolbar, so it goes through the
        // same undo()/redo() -- which respect enableUndo/enableRedo and emit undoRequested.
        this.canvas.setHistoryShortcutHandler((direction) => {
            if (direction === 'undo') this.undo(); else this.redo();
        });
        this.registerContextActions();
        this.bindCanvasEvents();
        this.disposables.push(this.catalog.on('portTypesChanged', () => this.applySocketTheme()));
        this.updateZoomLabel();
    }

    setLinkValidator(validator: LinkValidator | null): void {
        this.canvas.setLinkValidator(validator === null ? null : ({ fromNode, fromPort, toNode, toPort }) => validator({
            fromNode: this.fromCanvasNode(fromNode),
            fromPort: this.fromCanvasPort(fromPort),
            toNode: this.fromCanvasNode(toNode),
            toPort: this.fromCanvasPort(toPort),
        }));
    }

    addDiagramNode(node: DiagramNode): string {
        return this.canvas.addDiagramNode(this.toCanvasNode(node));
    }

    dropNodeFromPalette(typeId: string, clientX: number, clientY: number): string | null {
        const rect = this.div.getBoundingClientRect();
        const [x, y] = this.canvas.viewToWorld(clientX - rect.left, clientY - rect.top);
        const definition = this.catalog.getNodeType(typeId) ?? new Node({ id: typeId, name: typeId });
        const id = this.generateNodeId(definition.id);
        const node = new DiagramNode({
            id,
            typeId: definition.id,
            name: definition.name,
            description: definition.description,
            groupName: definition.groupName,
            inPorts: definition.inPorts.map((port) => port.clone()),
            outPorts: definition.outPorts.map((port) => port.clone()),
            icon: definition.icon,
            parameters: definition.parameters.map((parameter) => ({ ...parameter, options: [...parameter.options] })),
            openAction: definition.openAction,
            x,
            y,
        });
        this.canvas.addDiagramNode(this.toCanvasNode(node));
        this.canvas.selectNodeById(id);
        return id;
    }

    removeDiagramNode(nodeId: string): void {
        this.canvas.removeDiagramNode(nodeId);
    }

    moveNode(nodeId: string, x: number, y: number): void {
        this.canvas.moveNode(nodeId, x, y);
    }

    getNodeBounds(nodeId: string): DiagramNodeBounds | null {
        const node = this.canvas.findNode(nodeId);
        return node === undefined
            ? null
            : { x: node.x, y: node.y, width: node.w, height: node.h };
    }

    getPortPosition(
        nodeId: string,
        direction: PortDirection,
        portId: string,
    ): DiagramPoint | null {
        const node = this.canvas.findNode(nodeId);
        const port = direction === 'in'
            ? node?.inPorts.find((candidate) => candidate.id === portId)
            : node?.outPorts.find((candidate) => candidate.id === portId);
        return port === undefined ? null : { x: port.cx, y: port.cy };
    }

    worldToView(x: number, y: number): DiagramPoint {
        const [viewX, viewY] = this.canvas.worldToView(x, y);
        return { x: viewX, y: viewY };
    }

    setGridSnap(enabled: boolean, size?: number): void {
        this.canvas.setGridSnap(enabled, size);
    }

    getGridSnap(): DiagramSnapshot<DiagramGridSettings> {
        return this.canvas.getGridSnap();
    }

    /** See DiagramOptions.pageScroll. */
    setPageScroll(enabled: boolean): void {
        this.canvas.setPageScroll(enabled);
    }

    isPageScrollEnabled(): boolean {
        return this.canvas.isPageScrollEnabled();
    }

    nudgeSelection(dx: number, dy: number): boolean {
        return this.canvas.nudgeSelection(dx, dy);
    }

    addLink(link: Link): boolean {
        return this.canvas.addLink(this.toCanvasLink(link));
    }

    validateLink(link: Link, excludeLinkId?: string): LinkValidationResult {
        return this.canvas.validateLink(this.toCanvasLink(link), excludeLinkId);
    }

    relink(linkId: string, link: Link): LinkValidationResult {
        return this.canvas.relink(linkId, this.toCanvasLink(link));
    }

    removeLink(link: Link): void {
        this.canvas.removeLink(this.toCanvasLink(link));
    }

    /** False when nothing changed: no such node or port, or the edit was a no-op. */
    addPort(nodeId: string, direction: PortDirection, port: Port): boolean {
        return this.canvas.addPort(nodeId, direction, this.toCanvasPort(port));
    }

    /** False when nothing changed: no such node or port, or the edit was a no-op. */
    removePort(nodeId: string, direction: PortDirection, portId: string): boolean {
        return this.canvas.removePort(nodeId, direction, portId);
    }

    /** False when nothing changed: no such node or port, or the edit was a no-op. */
    updatePortType(nodeId: string, direction: PortDirection, portId: string, type: string): boolean {
        return this.canvas.updatePortType(nodeId, direction, portId, type);
    }

    updatePort(nodeId: string, direction: PortDirection, portId: string, patch: PortUpdate): boolean {
        return this.canvas.updatePort(nodeId, direction, portId, patch);
    }

    /** False when nothing changed: no such node or port, or the edit was a no-op. */
    setNodePorts(
        nodeId: string,
        inPorts: ReadonlyArray<{ key: string; name: string; description: string; type: string; maxLinks: number; availableTypes?: string[]; isDynamic?: boolean; dynamicMode?: PortDynamicMode }>,
        outPorts: ReadonlyArray<{ key: string; name: string; description: string; type: string; maxLinks: number; availableTypes?: string[]; isDynamic?: boolean; dynamicMode?: PortDynamicMode }>,
    ): boolean {
        const current = this.canvas.findNode(nodeId);
        if (current === undefined) return false;
        const convert = (port: typeof inPorts[number]): CanvasPortInit => ({
            id: port.key,
            name: port.name,
            description: port.description,
            type: port.type,
            maxLinks: port.maxLinks,
            availableTypes: [...(port.availableTypes ?? [])],
            isDynamic: port.isDynamic ?? false,
            dynamicMode: port.dynamicMode ?? '',
        });
        const nextIn = inPorts.map(convert);
        const nextOut = outPorts.map(convert);
        for (const sibling of current.inPorts.filter((port) => port.isSibling)) {
            if (!nextIn.some((port) => port.id === sibling.id)) nextIn.push(sibling.toInit());
        }
        for (const sibling of current.outPorts.filter((port) => port.isSibling)) {
            if (!nextOut.some((port) => port.id === sibling.id)) nextOut.push(sibling.toInit());
        }
        return this.canvas.setNodePorts(nodeId, nextIn, nextOut);
    }

    /** False when nothing changed: no such node or port, or the edit was a no-op. */
    updateNode(nodeId: string, patch: { name?: string; description?: string; color?: string; border?: string }): boolean {
        return this.canvas.updateNode(nodeId, patch);
    }

    /** False when nothing changed: no such node or port, or the edit was a no-op. */
    setNodeMessage(nodeId: string, message: string): boolean {
        return this.canvas.updateNode(nodeId, { message });
    }

    setNodeError(nodeId: string, message: string, options: NodeErrorOptions = {}): boolean {
        return this.canvas.setNodeError(nodeId, message, options);
    }

    clearNodeError(nodeId: string, kind?: NodeErrorKind): boolean {
        return this.canvas.clearNodeError(nodeId, kind);
    }

    getRuntimeState(): DiagramSnapshot<DiagramRuntimeState> {
        return this.canvas.getRuntimeState();
    }

    setRuntimeState(state: DiagramSnapshot<DiagramRuntimeState>): void {
        this.canvas.setRuntimeState(state);
    }

    clearRuntimeState(): void {
        this.canvas.clearRuntimeState();
    }

    setActiveNode(nodeId: string | null): boolean {
        return this.canvas.setActiveNode(nodeId);
    }

    setPortRuntimeState(
        nodeId: string,
        direction: PortDirection,
        portId: string,
        patch: Partial<DiagramPortRuntimeState>,
    ): boolean {
        return this.canvas.setPortRuntimeState(nodeId, direction, portId, patch);
    }

    setGlobalError(message: string | null, kind: DiagramGlobalErrorKind = 'invalid'): void {
        this.canvas.setGlobalError(message, kind);
    }

    /** False when nothing changed: no such node or port, or the edit was a no-op. */
    setNodeParamValue(nodeId: string, paramName: string, value: string | undefined): boolean {
        return this.canvas.setNodeParamValue(nodeId, paramName, value);
    }

    /** False when nothing changed: no such node or port, or the edit was a no-op. */
    setNodeName(nodeId: string, value: string): boolean {
        return this.canvas.updateNode(nodeId, { name: value });
    }

    /** Groups host-driven document edits into one undo/redo operation. */
    transaction<T>(label: string, action: () => T): T {
        return this.canvas.withTransaction(label, action);
    }

    setShowNodeMessages(show: boolean): void {
        this.canvas.setShowNodeMessages(show);
    }

    setReadOnly(readonly: boolean): void {
        this.canvas.setReadOnly(readonly);
    }

    getInteractionPermissions(): DiagramSnapshot<DiagramInteractionPermissions> {
        return this.canvas.getInteractionPermissions();
    }

    setInteractionPermissions(patch: Partial<DiagramInteractionPermissions>): void {
        this.canvas.setInteractionPermissions(patch);
    }

    applySocketTheme(): void {
        this.canvas.setTypeColors(this.portTypeColors());
    }

    applyOverviewTheme(): void {
        this.canvas.requestRedraw();
    }

    setOverviewVisible(visible: boolean): void {
        this.canvas.setOverviewVisible(visible);
        this.overviewContainer?.classList.toggle('hidden', !visible);
    }

    zoomToFit(): void {
        this.canvas.zoomToFit();
    }

    setZoom(scale: number): void {
        this.canvas.setZoom(scale);
    }

    getViewState(): DiagramSnapshot<DiagramViewState> {
        return this.canvas.getViewState();
    }

    setViewState(state: DiagramSnapshot<DiagramViewState>): void {
        this.canvas.setViewState(state);
        this.overviewContainer?.classList.toggle('hidden', !state.overviewVisible);
    }

    /** Serializes only viewport preferences; strategy data stays in saveDocument(). */
    saveViewState(space?: number): string {
        return serializeDiagramViewState(this.canvas.getViewState(), space);
    }

    /** Restores a versioned viewport snapshot produced by saveViewState(). */
    loadViewState(source: string | unknown): void {
        this.setViewState(parseDiagramViewState(source));
    }

    /** Detached PNG-ready canvas; use scope: 'content' for the complete scheme. */
    takeScreenshot(options: DiagramScreenshotOptions = {}): HTMLCanvasElement {
        return this.canvas.takeScreenshot(options);
    }

    /** The same picture as takeScreenshot, as an SVG document. */
    takeSvg(options: DiagramScreenshotOptions = {}): string {
        return this.canvas.takeSvg(options);
    }

    getSelection(): DiagramSnapshot<DiagramSelection> {
        return this.canvas.getSelection();
    }

    selectNodes(nodeIds: readonly string[]): void {
        this.canvas.selectNodesById(nodeIds);
    }

    selectLink(linkId: string | null): void {
        this.canvas.selectLinkById(linkId);
    }

    selectPort(nodeId: string, direction: PortDirection, portId: string): void {
        this.canvas.selectPortById(nodeId, direction, portId);
    }

    resize(width: number, height: number): void {
        this.canvas.resize(width, height);
    }

    isFullscreen(): boolean {
        return this.fullscreen;
    }

    /** Shows or hides the button that asks the host to save the diagram. */
    setDownloadButtonVisible(visible: boolean): void {
        this.downloadButtonVisible = visible;

        if (!visible) {
            if (this.downloadButton === null) return;

            this.downloadButton.hidden = true;
            this.downloadButton.style.display = 'none';
            return;
        }

        this.downloadButton ??= this.createDownloadButton();
        this.updateDownloadButton();
        this.downloadButton.hidden = false;
        this.downloadButton.style.display = 'inline-flex';
    }

    isDownloadButtonVisible(): boolean {
        return this.downloadButtonVisible;
    }

    /** Text of the download button, for a host that renders in another language. */
    setDownloadLabel(label: string): void {
        this.downloadLabel = label;
        this.updateDownloadButton();
    }

    setFullscreenButtonVisible(visible: boolean): void {
        this.fullscreenButtonVisible = visible;
        this.fullscreenButton.hidden = !visible;
        this.fullscreenButton.style.display = visible ? 'inline-flex' : 'none';
    }

    isFullscreenButtonVisible(): boolean {
        return this.fullscreenButtonVisible;
    }

    /** Text of the fullscreen button, for a host that renders in another language. */
    setFullscreenLabels(labels: DiagramSnapshot<DiagramFullscreenLabels>): void {
        this.fullscreenLabels = labels;
        this.updateFullscreenButton();
    }

    /**
     * Re-reads the shared bundle for text the control renders itself. Call it after changing
     * the page language: the context menu is rebuilt on every open and needs nothing, but the
     * fullscreen button is drawn once and would otherwise keep the old wording.
     */
    refreshLabels(): void {
        this.updateFullscreenButton();
    }

    getFullscreenLabels(): DiagramSnapshot<DiagramFullscreenLabels> {
        return { ...this.resolveFullscreenLabels() };
    }

    private resolveFullscreenLabels(): DiagramFullscreenLabels {
        return this.fullscreenLabels ?? {
            enter: t('fullscreenEnter', 'Enter fullscreen'),
            exit: t('fullscreenExit', 'Exit fullscreen'),
        };
    }

    /** Updates only the control's state after the host changed its own layout. */
    setFullscreenState(fullscreen: boolean): void {
        if (this.fullscreen === fullscreen) return;
        this.fullscreen = fullscreen;
        this.updateFullscreenButton();
        this.emit('fullscreenChanged', { fullscreen });
    }

    setTheme(options: DiagramThemeOptions): void {
        const {
            diagramBackground,
            overviewBackground,
            gridColor,
            linkMaxLightness,
            typedLinkColors,
            overviewBorderColor,
            overviewViewportColor,
            overviewViewportFill,
        } = options;
        if (diagramBackground !== undefined) {
            // Only the mount point is ours to paint. The element around it belongs to the embedding page,
            // whose own styling decides what shows behind the diagram.
            this.div.style.background = diagramBackground;
        }
        if (this.overviewContainer !== null && overviewBackground !== undefined) {
            this.overviewContainer.style.background = overviewBackground;
        }
        this.canvas.setTheme({
            background: diagramBackground,
            gridColor,
            linkMaxLightness,
            typedLinkColors,
            overviewBackground,
            overviewBorderColor,
            overviewViewportColor,
            overviewViewportFill,
        });
    }

    enableUndo(enabled: boolean): void { this.undoEnabled = enabled; }
    enableRedo(enabled: boolean): void { this.redoEnabled = enabled; }
    enableHelp(enabled: boolean): void { this.helpEnabled = enabled; }

    canUndo(): boolean { return this.undoEnabled && this.canvas.canUndo(); }
    canRedo(): boolean { return this.redoEnabled && this.canvas.canRedo(); }

    undo(): void {
        if (!this.canUndo()) return;
        this.canvas.undo();
        const snapshot = this.save();
        this.emit('undoRequested', snapshot);
    }

    redo(): void {
        if (!this.canRedo()) return;
        this.canvas.redo();
        const snapshot = this.save();
        this.emit('redoRequested', snapshot);
    }

    cutSelection(): void { this.canvas.cutSelection(); }
    copySelection(): void { this.canvas.copySelection(); }
    pasteSelection(): void { this.canvas.pasteSelection(); }
    deleteSelection(): void { this.canvas.deleteSelection(); }

    async copySelectionToClipboard(): Promise<boolean> {
        const document = this.canvas.copySelectionDocument();
        if (document === null) return false;
        if (this.clipboard !== null) {
            try {
                await this.clipboard.writeText(serializeDiagramDocument(document));
            } catch {
                // The in-memory document remains available as a safe fallback.
            }
        }
        return true;
    }

    async pasteSelectionFromClipboard(): Promise<boolean> {
        if (!this.canvas.getInteractionPermissions().paste) return false;
        if (this.clipboard !== null) {
            try {
                const text = await this.clipboard.readText();
                const document = parseDiagramDocument(text);
                return this.canvas.pasteDocument(document).length > 0;
            } catch {
                // Fall through to the component's last valid in-memory copy.
            }
        }
        const fallback = this.canvas.getClipboardDocument();
        return fallback !== null && this.canvas.pasteDocument(fallback).length > 0;
    }

    /**
     * Turns the built-in menu on or off. Off leaves `contextMenuRequested` untouched, so a
     * host that draws its own is only trading one menu for another, never losing the event.
     */
    setContextMenuEnabled(enabled: boolean): void {
        if (enabled === (this.contextMenu !== null)) return;
        if (!enabled) {
            this.contextMenu?.destroy();
            this.contextMenu = null;
            return;
        }
        this.contextMenu = new ContextMenuView({
            container: this.div,
            // Through the public entry point, so the built-in menu is exactly as privileged
            // as a host's own -- same guards, same contextCommand event.
            execute: (command) => { this.executeContextCommand(command); },
        });
    }

    isContextMenuEnabled(): boolean {
        return this.contextMenu !== null;
    }

    /**
     * Whether the built-in menu is on screen right now.
     *
     * The menu closes itself on Escape. A host that binds the same key - to leave a fullscreen
     * layout, to close its own dialog - needs to know the key was already spoken for, or one
     * press does both.
     */
    isContextMenuOpen(): boolean {
        return this.contextMenu?.isOpen ?? false;
    }

    getContextCommands(): ContextMenuItemState[] {
        const context = this.contextActionContext();
        const state = (command: ContextCommand): ContextCommandState => {
            const checked = CONTEXT_CHECKED[command];
            return {
                command,
                enabled: this.contextActions.canExecute(command, context),
                ...(checked === undefined ? {} : { checked: checked(this) }),
            };
        };
        return CONTEXT_MENU.map((entry) => {
            if (typeof entry === 'string') return state(entry);
            const commands = entry.commands.map(state);
            // A submenu that opens onto nothing but greyed items is itself dead, and
            // saying so here spares every host from working the same thing out again.
            return { group: entry.group, enabled: commands.some(({ enabled }) => enabled), commands };
        });
    }

    executeContextCommand(command: ContextCommand): boolean {
        const context = this.contextActionContext();
        if (!this.contextActions.execute(command, context)) return false;
        this.emit('contextCommand', { command, nodes: context.nodes, links: context.links });
        return true;
    }

    clear(): void {
        this.loading = true;
        try {
            this.canvas.load([], []);
        } finally {
            this.loading = false;
        }
        this.emit('runtimeStateChanged', { state: this.canvas.getRuntimeState() });
    }

    load(nodes: DiagramNode[], links: Link[], options: DiagramLoadOptions = {}): void {
        this.loading = true;
        try {
            this.canvas.load(nodes.map((node) => this.toCanvasNode(node)), links.map((link) => this.toCanvasLink(link)));
            for (const [nodeId, message] of Object.entries(options.nodeErrors ?? {})) {
                this.canvas.setNodeError(nodeId, message, { kind: 'load', animate: false });
            }
        } finally {
            this.loading = false;
        }
        this.emit('runtimeStateChanged', { state: this.canvas.getRuntimeState() });
        const snapshot = this.save();
        this.emit('loadFinished', snapshot);
    }

    save(): { nodes: DiagramNode[]; links: Link[] } {
        const snapshot = this.canvas.save();
        return {
            nodes: snapshot.nodes.map((node) => this.fromCanvasInit(node)),
            links: snapshot.links.map((link) => this.fromCanvasLink(link)),
        };
    }

    loadDocument(document: DiagramDocument | string, options: DiagramLoadOptions = {}): void {
        let failure: Error | null = null;
        this.loading = true;
        try {
            this.canvas.loadDocument(document);
            for (const [nodeId, message] of Object.entries(options.nodeErrors ?? {})) {
                this.canvas.setNodeError(nodeId, message, { kind: 'load', animate: false });
            }
        } catch (error) {
            failure = error instanceof Error ? error : new Error(String(error));
            this.canvas.setGlobalError(failure.message, 'load');
        } finally {
            this.loading = false;
        }
        this.emit('runtimeStateChanged', { state: this.canvas.getRuntimeState() });
        if (failure !== null) {
            this.emit('documentLoadFailed', { message: failure.message, error: failure });
            throw failure;
        }
        const saved = this.canvas.saveDocument();
        this.emit('documentLoaded', { document: saved });
        const snapshot = this.save();
        this.emit('loadFinished', snapshot);
    }

    saveDocument(): DiagramDocument {
        return this.canvas.saveDocument();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.contextMenu?.destroy();
        this.contextMenu = null;
        for (const dispose of this.disposables.splice(0).reverse()) dispose();
        this.canvas.destroy();
    }

    private prepareFullscreenButtonHost(): void {
        const previous = this.div.style.position;
        const position = typeof getComputedStyle === 'function'
            ? getComputedStyle(this.div).position
            : previous;
        if (position !== '' && position !== 'static' && position !== undefined) return;
        this.div.style.position = 'relative';
        this.disposables.push(() => {
            if (this.div.style.position === 'relative') this.div.style.position = previous;
        });
    }

    private createFullscreenButton(): HTMLButtonElement {
        const owner = this.div.ownerDocument ?? document;
        const button = owner.createElement('button');
        button.type = 'button';
        button.className = 'ssdiagram-fullscreen-button';
        button.setAttribute('data-ssdiagram-fullscreen-button', '');
        Object.assign(button.style, {
            position: 'absolute',
            top: '8px',
            right: '8px',
            zIndex: '4',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '30px',
            height: '30px',
            padding: '0',
            border: '1px solid var(--ssdiagram-control-border, var(--t-border, #3a4250))',
            borderRadius: '5px',
            background: 'var(--ssdiagram-control-background, var(--t-surface, rgba(18, 21, 28, 0.9)))',
            color: 'var(--ssdiagram-control-color, var(--t-text, #eaecef))',
            boxSizing: 'border-box',
            cursor: 'pointer',
            opacity: '0.9',
        });
        const click = (): void => {
            this.emit('fullscreenRequested', { fullscreen: !this.fullscreen });
        };
        button.addEventListener('click', click);
        this.div.appendChild(button);
        this.disposables.push(() => {
            button.removeEventListener('click', click);
            button.remove();
        });
        button.hidden = !this.fullscreenButtonVisible;
        button.style.display = this.fullscreenButtonVisible ? 'inline-flex' : 'none';
        return button;
    }

    private createDownloadButton(): HTMLButtonElement {
        const owner = this.div.ownerDocument ?? document;
        const button = owner.createElement('button');
        button.type = 'button';
        button.className = 'ssdiagram-download-button';
        button.setAttribute('data-ssdiagram-download-button', '');
        Object.assign(button.style, {
            position: 'absolute',
            top: '8px',
            right: '46px',
            zIndex: '4',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '30px',
            height: '30px',
            padding: '0',
            border: '1px solid var(--ssdiagram-control-border, var(--t-border, #3a4250))',
            borderRadius: '5px',
            background: 'var(--ssdiagram-control-background, var(--t-surface, rgba(18, 21, 28, 0.9)))',
            color: 'var(--ssdiagram-control-color, var(--t-text, #eaecef))',
            boxSizing: 'border-box',
            cursor: 'pointer',
            opacity: '0.9',
        });
        // The control writes no files: it says the diagram was asked for, and the host saves it.
        const click = (): void => {
            this.emit('exportRequested', { format: 'document' });
        };
        button.addEventListener('click', click);
        this.div.appendChild(button);
        this.disposables.push(() => {
            button.removeEventListener('click', click);
            button.remove();
        });
        return button;
    }

    private updateDownloadButton(): void {
        if (this.downloadButton === null) return;

        const label = this.downloadLabel ?? t('download', 'Download');
        this.downloadButton.title = label;
        this.downloadButton.setAttribute('aria-label', label);
        this.downloadButton.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" '
            + 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" '
            + 'stroke-linejoin="round"><path d="M12 4v11M8 11l4 4 4-4M5 19h14"/></svg>';
    }

    private updateFullscreenButton(): void {
        const fullscreen = this.fullscreen;
        const labels = this.resolveFullscreenLabels();
        const label = fullscreen ? labels.exit : labels.enter;
        const path = fullscreen
            ? 'M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5'
            : 'M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5';
        this.fullscreenButton.className = fullscreen
            ? 'ssdiagram-fullscreen-button is-active'
            : 'ssdiagram-fullscreen-button';
        this.fullscreenButton.title = label;
        this.fullscreenButton.setAttribute('aria-label', label);
        this.fullscreenButton.setAttribute('aria-pressed', String(fullscreen));
        this.fullscreenButton.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" `
            + 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" '
            + `stroke-linejoin="round"><path d="${path}"/></svg>`;
    }

    private bindCanvasEvents(): void {
        this.disposables.push(
            this.canvas.on('nodeAdded', ({ node }) => {
                if (!this.loading) this.emit('nodeAdded', { nodes: [this.fromCanvasNode(node)] });
            }),
            this.canvas.on('nodeRemoved', ({ node }) => {
                if (!this.loading) this.emit('nodeRemoved', { nodes: [this.fromCanvasNode(node)] });
            }),
            this.canvas.on('nodeMoved', ({ node }) => {
                if (!this.loading) this.emit('nodeMoved', { node: this.fromCanvasNode(node) });
            }),
            this.canvas.on('nodeChanged', ({ node }) => {
                if (!this.loading) this.emit('nodeEdit', { nodes: [this.fromCanvasNode(node)] });
            }),
            this.canvas.on('linkAdded', ({ link }) => {
                if (!this.loading) this.emit('linkAdded', { links: [this.fromCanvasLink(link)] });
            }),
            this.canvas.on('linkRemoved', ({ link }) => {
                if (!this.loading) this.emit('linkRemoved', { links: [this.fromCanvasLink(link)] });
            }),
            this.canvas.on('linkRelinked', ({ link, previous }) => {
                if (!this.loading) this.emit('linkRelinked', {
                    link: this.fromCanvasLink(link),
                    previous: this.fromCanvasLink(previous),
                });
            }),
            this.canvas.on('nodeSelected', ({ node, selected }) => {
                if (node !== null) this.emit('nodeSelected', { node: this.fromCanvasNode(node), selected });
            }),
            this.canvas.on('linkSelected', ({ link, selected }) => {
                if (link !== null) this.emit('linkSelected', { link: this.fromCanvasLink(link), selected });
            }),
            this.canvas.on('selectionChanged', (selection) => this.emit('selectionChanged', selection)),
            this.canvas.on('runtimeStateChanged', ({ state }) => {
                if (!this.loading) this.emit('runtimeStateChanged', { state });
            }),
            this.canvas.on('nodeHover', ({ node, hovering }) => {
                this.emit('nodeHover', { node: this.fromCanvasNode(node), hovering });
            }),
            this.canvas.on('portSelected', ({ node, port }) => {
                this.emit('portSelected', {
                    node: this.fromCanvasNode(node),
                    port: this.fromCanvasPort(port),
                    direction: port.direction,
                });
            }),
            this.canvas.on('portClicked', ({ node, port, action, ctrlKey, shiftKey, altKey, metaKey }) => {
                this.emit('portClicked', {
                    node: this.fromCanvasNode(node),
                    port: this.fromCanvasPort(port),
                    direction: port.direction,
                    action,
                    ctrlKey,
                    shiftKey,
                    altKey,
                    metaKey,
                });
            }),
            this.canvas.on('portHover', ({ node, port, hovering }) => {
                this.emit('portHover', {
                    node: this.fromCanvasNode(node),
                    port: this.fromCanvasPort(port),
                    direction: port.direction,
                    hovering,
                });
            }),
            this.canvas.on('linkHover', ({ link, hovering }) => {
                this.emit('linkHover', { link: this.fromCanvasLink(link), hovering });
            }),
            this.canvas.on('linkValidation', ({ fromNode, from, toNode, to, allowed, reason }) => {
                this.emit('linkValidation', {
                    fromNode: this.fromCanvasNode(fromNode),
                    fromPort: this.fromCanvasPort(from),
                    toNode: this.fromCanvasNode(toNode),
                    toPort: this.fromCanvasPort(to),
                    allowed,
                    reason,
                });
            }),
            this.canvas.on('nodeOpen', ({ node }) => {
                this.emit('nodeOpen', { nodes: [this.fromCanvasNode(node)] });
            }),
            this.canvas.on('zoomChanged', () => {
                this.updateZoomLabel();
                this.emit('zoomChanged', this.canvas.getViewState());
            }),
            this.canvas.on('viewChanged', (state) => {
                this.overviewContainer?.classList.toggle('hidden', !state.overviewVisible);
                this.emit('viewChanged', state);
            }),
            this.canvas.on('undoStackChanged', (state) => this.emit('undoStackChanged', state)),
            this.canvas.on('contextMenu', ({ x, y, node, link, port }) => {
                const commands = this.getContextCommands();
                this.emit('contextMenuRequested', {
                    x,
                    y,
                    node: node === null ? null : this.fromCanvasNode(node),
                    link: link === null ? null : this.fromCanvasLink(link),
                    port: port === null ? null : this.fromCanvasPort(port.port),
                    portDirection: port?.port.direction ?? null,
                    commands,
                });
                // After the event, so a host that draws its own menu has already been told
                // and can have switched this one off in the handler.
                this.contextMenu?.show(x, y, commands);
            }),
        );
    }

    private registerContextActions(): void {
        const permissions = () => this.canvas.getInteractionPermissions();
        // Keyed by ContextCommand, so a command added to the union without an
        // entry here fails to compile rather than quietly missing from the menu.
        // Key order is menu order.
        this.contextActions.registerAll({
            undo: {
                canExecute: () => this.canUndo(),
                execute: () => this.undo(),
            },
            redo: {
                canExecute: () => this.canRedo(),
                execute: () => this.redo(),
            },
            cut: {
                canExecute: ({ nodes }) => nodes.length > 0 && permissions().copy && permissions().deleteSelection,
                execute: () => this.cutSelection(),
            },
            copy: {
                canExecute: ({ nodes }) => nodes.length > 0 && permissions().copy,
                execute: () => this.copySelection(),
            },
            paste: {
                canExecute: () => this.canvas.hasClipboard() && permissions().paste,
                execute: () => this.pasteSelection(),
            },
            open: {
                canExecute: ({ nodes }) => nodes.length === 1 && nodes[0].openAction.length > 0,
                execute: ({ nodes }) => this.emit('nodeOpen', { nodes }),
            },
            delete: {
                canExecute: ({ selection }) => permissions().deleteSelection
                    && (selection.nodeIds.length > 0 || selection.linkIds.length > 0),
                execute: () => this.canvas.deleteSelection(),
            },
            // Export asks rather than does. Where the result goes -- a download, an upload,
            // a clipboard, a print preview -- is the host's decision, and so is which options
            // to render with, so the control reports the request and stops there.
            // Availability follows the diagram, not the selection: all three export the whole
            // picture, and an empty diagram has none to give. They stay on in read-only mode,
            // which forbids changing the diagram, not looking at it.
            exportDocument: {
                canExecute: ({ document }) => document.nodes.length > 0,
                execute: () => this.emit('exportRequested', { format: 'document' }),
            },
            exportPng: {
                canExecute: ({ document }) => document.nodes.length > 0,
                execute: () => this.emit('exportRequested', { format: 'png' }),
            },
            exportSvg: {
                canExecute: ({ document }) => document.nodes.length > 0,
                execute: () => this.emit('exportRequested', { format: 'svg' }),
            },
            // Always available: it shows the overview as readily as it hides it, and an empty
            // diagram is exactly when someone may want the panel out of the way.
            overview: {
                canExecute: () => true,
                execute: () => this.setOverviewVisible(!this.getViewState().overviewVisible),
            },
            properties: {
                canExecute: ({ nodes }) => nodes.length > 0,
                execute: ({ nodes }) => this.emit('nodeProperties', { nodes }),
            },
            help: {
                canExecute: ({ nodes }) => this.helpEnabled && nodes.length > 0,
                execute: ({ nodes }) => this.emit('nodeHelp', { nodes }),
            },
        });
    }

    private contextActionContext(): ContextActionContext {
        const selection = this.canvas.getSelection();
        const document = this.canvas.saveDocument();
        const nodeIds = new Set(selection.nodeIds);
        const linkIds = new Set(selection.linkIds);
        return {
            selection,
            document,
            nodes: document.nodes
                .filter((node) => nodeIds.has(node.id))
                .map((node) => this.fromCanvasInit(node)),
            links: document.links
                .filter((link) => linkIds.has(link.id))
                .map((link) => new Link({
                    id: link.id,
                    outNode: link.from.nodeId,
                    outPort: link.from.portId,
                    inNode: link.to.nodeId,
                    inPort: link.to.portId,
                    metadata: link.metadata,
                })),
        };
    }

    private toCanvasNode(node: DiagramNode): CanvasNodeInit {
        return {
            id: node.id,
            typeId: node.typeId,
            name: node.name,
            description: node.description,
            groupName: node.groupName,
            color: node.color,
            border: node.border,
            icon: node.icon,
            openAction: node.openAction,
            message: node.message,
            isPlaceholder: node.isPlaceholder,
            parameters: node.parameters.map((parameter) => ({ ...parameter, options: [...parameter.options] })),
            paramValues: { ...node.paramValues },
            x: node.x,
            y: node.y,
            inPorts: node.inPorts.map((port) => this.toCanvasPort(port)),
            outPorts: node.outPorts.map((port) => this.toCanvasPort(port)),
        };
    }

    private fromCanvasNode(node: NodeModel): DiagramNode {
        return this.fromCanvasInit(node.toInit(false));
    }

    private fromCanvasInit(node: CanvasNodeInit & { id: string }): DiagramNode {
        return new DiagramNode({
            id: node.id,
            typeId: node.typeId,
            name: node.name,
            description: node.description,
            groupName: node.groupName,
            color: node.color,
            border: node.border,
            icon: node.icon,
            openAction: node.openAction,
            message: node.message,
            isPlaceholder: node.isPlaceholder,
            parameters: (node.parameters ?? []).map((parameter) => ({ ...parameter, options: [...parameter.options] })),
            paramValues: { ...(node.paramValues ?? {}) },
            x: node.x,
            y: node.y,
            inPorts: (node.inPorts ?? []).map((port) => this.fromCanvasPortInit(port)),
            outPorts: (node.outPorts ?? []).map((port) => this.fromCanvasPortInit(port)),
        });
    }

    private toCanvasPort(port: Port): CanvasPortInit {
        return {
            id: port.id,
            name: port.name,
            description: port.description,
            type: port.type,
            maxLinks: port.maxLinks,
            availableTypes: [...port.availableTypes],
            isDynamic: port.isDynamic,
            dynamicMode: port.dynamicMode,
            isSibling: port.isSibling,
        };
    }

    private fromCanvasPort(port: PortModel): Port {
        return this.fromCanvasPortInit(port.toInit());
    }

    private fromCanvasPortInit(port: CanvasPortInit): Port {
        return new Port({
            id: port.id,
            name: port.name,
            description: port.description,
            type: port.type,
            maxLinks: port.maxLinks,
            availableTypes: [...(port.availableTypes ?? [])],
            isDynamic: port.isDynamic,
            dynamicMode: port.dynamicMode,
            isSibling: port.isSibling,
        });
    }

    private toCanvasLink(link: Link): CanvasLinkInit {
        const idOf = (value: string | { id: string }): string => typeof value === 'string' ? value : value.id;
        return {
            id: link.id || undefined,
            from: idOf(link.outNode),
            fromPort: idOf(link.outPort),
            to: idOf(link.inNode),
            toPort: idOf(link.inPort),
            metadata: link.metadata,
        };
    }

    private fromCanvasLink(link: CanvasLinkInit | LinkModel): Link {
        return new Link({
            id: link.id,
            outNode: link.from,
            outPort: link.fromPort,
            inNode: link.to,
            inPort: link.toPort,
            metadata: link.metadata,
        });
    }

    private portTypeColors(): Record<string, string> {
        return Object.fromEntries(this.catalog.getPortTypes().map((portType) => [portType.name, portType.color]));
    }

    private updateZoomLabel(): void {
        if (this.zoomLabel !== null) this.zoomLabel.textContent = `${Math.round(this.canvas.getViewState().zoom * 100)}%`;
    }

    private resolveClipboard(explicit: DiagramClipboard | null | undefined): DiagramClipboard | null {
        if (explicit !== undefined) return explicit;
        if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return null;
        return {
            readText: () => navigator.clipboard.readText(),
            writeText: (value) => navigator.clipboard.writeText(value),
        };
    }

    private generateNodeId(prefix: string): string {
        const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '') || 'node';
        let id: string;
        do id = `${safePrefix}_${this.idCounter++}`;
        while (this.canvas.findNode(id) !== undefined);
        return id;
    }
}
