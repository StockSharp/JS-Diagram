import { applyLanguage, fmt, language, strings, type DemoLanguage } from './i18n';
import {
    DiagramNode,
    Link,
    Node,
    PALETTE_DRAG_MIME,
    PortType,
    StockSharpCatalog,
    StockSharpDiagram,
    StockSharpPalette,
} from '../src/index';

// Fails loudly on missing markup and hands back a non-nullable element, so the
// demo never needs a `!` and the null check cannot drift out of sync with use.
function requireElement<T extends Element>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (element === null) throw new Error(`Diagram demo markup is incomplete: ${selector} is missing.`);
    return element;
}

const root = document.documentElement;
const diagramHost = requireElement<HTMLElement>('#diagram');
const canvasPanel = requireElement<HTMLElement>('.canvas-panel');
const paletteHost = requireElement<HTMLElement>('#palette');
const search = requireElement<HTMLInputElement>('#paletteSearch');
const status = requireElement<HTMLElement>('#status');
const modelStats = requireElement<HTMLElement>('#modelStats');
const indicatorDialog = requireElement<HTMLDialogElement>('#indicatorDialog');
const indicatorForm = requireElement<HTMLFormElement>('#indicatorForm');
const indicatorTitle = requireElement<HTMLElement>('#indicatorTitle');
const indicatorPeriod = requireElement<HTMLInputElement>('#indicatorPeriod');
const indicatorInputType = requireElement<HTMLSelectElement>('#indicatorInputType');
const indicatorInputMulti = requireElement<HTMLInputElement>('#indicatorInputMulti');
const indicatorOutputMulti = requireElement<HTMLInputElement>('#indicatorOutputMulti');
const themeButton = requireElement<HTMLButtonElement>('#themeBtn');
const fullscreenButton = requireElement<HTMLButtonElement>('#fullscreenBtn');

const svgIcon = (label: string, color: string): string => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="5" fill="${color}"/><text x="12" y="16" text-anchor="middle" font-family="Segoe UI,sans-serif" font-size="11" font-weight="700" fill="#0b0e11">${label}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const catalog = new StockSharpCatalog();
[
    new PortType({ name: 'Candle', color: 'hsl(202, 72%, 58%)' }),
    new PortType({ name: 'Decimal', color: 'hsl(267, 68%, 66%)' }),
    new PortType({ name: 'Boolean', color: 'hsl(42, 82%, 57%)' }),
    new PortType({ name: 'Order', color: 'hsl(350, 69%, 62%)' }),
    new PortType({ name: 'Trade', color: 'hsl(153, 67%, 49%)' }),
    new PortType({ name: 'Object', color: 'hsl(215, 16%, 62%)' }),
    // The two ends of the range, the way a host really sends them: StockSharp colours Any
    // black. A socket has to stay visible on both canvases at both ends, so the demo carries
    // them to show the outline flipping with the fill.
    new PortType({ name: 'Any', color: '#000000' }),
    new PortType({ name: 'Text', color: '#ffffff' }),
].forEach((type) => catalog.addPortType(type));

// Built from the current dictionary rather than from literals: node types are host data, so a
// localized application localizes its palette too. Re-registering an id replaces the definition
// and the catalog tells the palette to redraw, which is all a language switch has to do.
// Port *type* names (Candle, Decimal, ...) stay put -- they are identifiers that links match on,
// not captions.
function nodeTypes(): Node[] {
    const s = strings();
    return [
        new Node({
            id: 'market-data',
            name: s.nodeMarketData,
            description: s.nodeMarketDataDesc,
            groupName: s.grpSources,
            icon: svgIcon('MD', '#4aa3ff'),
            outPorts: [
                { id: 'candles', name: s.portCandles, type: 'Candle' },
                // The dark end of the palette, as something a wire can be dragged out of:
                // Any is #000000, and a wire drawn in it is the case the canvas has to leave
                // room for.
                { id: 'any', name: s.portAny, type: 'Any' },
            ],
        }),
        new Node({
            id: 'sma',
            name: s.nodeSma,
            description: s.nodeSmaDesc,
            groupName: s.grpIndicators,
            icon: svgIcon('MA', '#a779e9'),
            openAction: 'indicatorSettings',
            parameters: [{
                name: 'Period', displayName: s.dlgPeriod, description: s.nodeSmaPeriodDesc,
                type: 'number', defaultValue: '20', options: [], min: 1, max: 1000,
                displayOrder: 1, category: 'General', isBasic: true, editorType: '',
            }],
            inPorts: [{ id: 'source', name: s.portSource, type: 'Candle', maxLinks: 1 }],
            outPorts: [{ id: 'value', name: s.portValue, type: 'Decimal' }],
        }),
        new Node({
            id: 'crossing',
            name: s.nodeCrossing,
            description: s.nodeCrossingDesc,
            groupName: s.grpLogic,
            icon: svgIcon('X', '#f0b90b'),
            inPorts: [
                { id: 'fast', name: s.portFast, type: 'Decimal', maxLinks: 1 },
                { id: 'slow', name: s.portSlow, type: 'Decimal', maxLinks: 1 },
            ],
            outPorts: [{ id: 'signal', name: s.portSignal, type: 'Boolean' }],
        }),
        new Node({
            id: 'order-builder',
            name: s.nodeOrderBuilder,
            description: s.nodeOrderBuilderDesc,
            groupName: s.grpTrading,
            icon: svgIcon('OR', '#f6465d'),
            inPorts: [{ id: 'signal', name: s.portSignal, type: 'Boolean', maxLinks: 1 }],
            outPorts: [{ id: 'order', name: s.portOrder, type: 'Order' }],
        }),
        new Node({
            id: 'connector',
            name: s.nodeConnector,
            description: s.nodeConnectorDesc,
            groupName: s.grpExecution,
            icon: svgIcon('BR', '#0ecb81'),
            inPorts: [{ id: 'order', name: s.portOrder, type: 'Order' }],
            outPorts: [{ id: 'trade', name: s.portTrade, type: 'Trade' }],
        }),
        new Node({
            id: 'chart',
            name: s.nodeChart,
            description: s.nodeChartDesc,
            groupName: s.grpVisualization,
            icon: svgIcon('CH', '#45c2d6'),
            inPorts: [
                { id: 'candles', name: s.portCandles, type: 'Candle' },
                { id: 'trades', name: s.portTrade, type: 'Trade' },
                { id: 'object', name: s.portAnyObject, type: 'Object' },
                { id: 'any', name: s.portAny, type: 'Any' },
                { id: 'text', name: s.portText, type: 'Text' },
            ],
        }),
    ];
}

nodeTypes().forEach((node) => catalog.addNodeType(node));

const palette = new StockSharpPalette({ div: paletteHost, catalog });
const diagram = new StockSharpDiagram({
    div: diagramHost,
    catalog,
    showFullscreenButton: true,
    // The demo saves what the control asks for, so it shows the button that asks.
    showDownloadButton: true,
});
// Wires carry their socket type's colour, which is what makes the ends of the palette
// visible as wires rather than only as sockets.
diagram.setTheme({ typedLinkColors: true });

(window as Window & { stockSharpDiagramDemo?: StockSharpDiagram }).stockSharpDiagramDemo = diagram;

palette.on('nodeActivated', ({ node: activated }) => {
    const rect = diagramHost.getBoundingClientRect();
    diagram.dropNodeFromPalette(activated.id, rect.left + rect.width / 2, rect.top + rect.height / 2);
    setStatus(fmt(strings().addedFromPalette, activated.name));
});
palette.on('contextMenuRequested', ({ node: requested }) => {
    setStatus(requested.description.length > 0 ? requested.description : requested.name);
});

function node(typeId: string, id: string, name: string, x: number, y: number): DiagramNode {
    const type = catalog.getNodeType(typeId);
    if (type === null) throw new Error(`Unknown node type: ${typeId}`);
    return new DiagramNode({
        id,
        typeId,
        name,
        description: type.description,
        groupName: type.groupName,
        icon: type.icon,
        openAction: type.openAction,
        parameters: type.parameters.map((parameter) => ({ ...parameter, options: [...parameter.options] })),
        paramValues: typeId === 'sma'
            ? { Period: name.match(/\((\d+)\)/)?.[1] ?? '20' }
            : {},
        inPorts: type.inPorts.map((port) => port.clone()),
        outPorts: type.outPorts.map((port) => port.clone()),
        x,
        y,
    });
}

const seedNodes = (): DiagramNode[] => [
    node('market-data', 'market', 'BTC/USDT candles', 30, 185),
    node('sma', 'fast', 'Fast SMA (12)', 285, 70),
    node('sma', 'slow', 'Slow SMA (26)', 285, 290),
    node('crossing', 'cross', 'SMA crossing', 550, 180),
    node('order-builder', 'orders', 'Buy on cross', 790, 180),
    node('connector', 'broker', 'Paper broker', 1030, 180),
    node('chart', 'chart', 'Strategy chart', 790, 385),
];

const seedLinks = (): Link[] => [
    new Link({ outNode: 'market', outPort: 'candles', inNode: 'fast', inPort: 'source' }),
    new Link({ outNode: 'market', outPort: 'candles', inNode: 'slow', inPort: 'source' }),
    new Link({ outNode: 'market', outPort: 'candles', inNode: 'chart', inPort: 'candles' }),
    new Link({ outNode: 'market', outPort: 'any', inNode: 'chart', inPort: 'any' }),
    new Link({ outNode: 'fast', outPort: 'value', inNode: 'cross', inPort: 'fast' }),
    new Link({ outNode: 'slow', outPort: 'value', inNode: 'cross', inPort: 'slow' }),
    new Link({ outNode: 'cross', outPort: 'signal', inNode: 'orders', inPort: 'signal' }),
    new Link({ outNode: 'orders', outPort: 'order', inNode: 'broker', inPort: 'order' }),
    new Link({ outNode: 'broker', outPort: 'trade', inNode: 'chart', inPort: 'trades' }),
];

let light = new URLSearchParams(window.location.search).get('theme') === 'light';
let readOnly = false;
let customSequence = 1;
let activeIndicator: DiagramNode | null = null;

function setStatus(message: string): void {
    status.textContent = message;
}

// Two dictionaries change at once: the control's, through window.__designerI18n, and the
// demo's own. Only the context menu comes from the control -- right-click after switching and
// it is Chinese too, which is the quickest way to see whether the package is localized at all.
// The switch happens live, with no reload: the menu re-reads the bundle every time it opens.
const languageButton = requireElement<HTMLButtonElement>('#langBtn');
function setLanguage(next: DemoLanguage): void {
    applyLanguage(next);
    nodeTypes().forEach((type) => catalog.addNodeType(type));
    // The control draws its fullscreen button once, so unlike the menu it has to be told the
    // language moved. The menu needs nothing: it is rebuilt, and re-reads the bundle, on open.
    diagram.refreshLabels();
    applyTheme();
    updateState();
    setStatus(strings().languageSwitched);
}
languageButton.addEventListener('click', () => setLanguage(language() === 'en' ? 'zh' : 'en'));

function updateState(): void {
    const model = diagram.save();
    modelStats.textContent = fmt(strings().stats, model.nodes.length, model.links.length);
    requireElement<HTMLButtonElement>('#undoBtn').disabled = !diagram.canUndo();
    requireElement<HTMLButtonElement>('#redoBtn').disabled = !diagram.canRedo();
}

function applyTheme(): void {
    root.setAttribute('data-bs-theme', light ? 'light' : 'dark');
    diagram.setTheme(light
        ? { diagramBackground: '#f5f7fa', gridColor: '#e2e8f0', linkMaxLightness: 0.42 }
        : { diagramBackground: '#131820', gridColor: '#1e2633', linkMaxLightness: 1 });
    diagram.applySocketTheme();
    themeButton.classList.toggle('is-light', light);
    const themeLabel = light ? strings().themeDark : strings().themeLight;
    themeButton.title = themeLabel;
    themeButton.setAttribute('aria-label', themeLabel);
}

function reset(nodeErrors: Readonly<Record<string, string>> = {}): void {
    diagram.load(seedNodes(), seedLinks(), { nodeErrors });
    diagram.zoomToFit();
    setStatus(strings().modelReset);
    updateState();
}

diagram.on('nodeSelected', ({ node: selected }) => {
    setStatus(selected === null ? strings().selectionCleared : fmt(strings().selected, selected.name));
});
diagram.on('nodeAdded', ({ nodes }) => {
    const added = nodes[0];
    if (added === undefined) return;
    setStatus(fmt(strings().added, added.name));
    updateState();
});
diagram.on('nodeRemoved', updateState);
// Undo/redo availability is owned by the control; track its canonical signal so
// the toolbar buttons stay in sync for every command (delete, drag, relink, …),
// not only the model mutations handled above.
diagram.on('undoStackChanged', updateState);
diagram.on('linkAdded', ({ links }) => {
    const link = links[0];
    if (link === undefined) return;
    setStatus(fmt(strings().connected, String(link.outNode), String(link.inNode)));
    updateState();
});
diagram.on('linkRemoved', updateState);
diagram.on('linkRelinked', ({ link }) => {
    setStatus(fmt(strings().relinked, String(link.outNode), String(link.inNode)));
});
diagram.on('linkValidation', ({ allowed, reason }) => {
    if (allowed) return;
    const text = strings();
    const messages: Partial<Record<typeof reason, string>> = {
        'duplicate-link': text.rejectDuplicate,
        'source-limit': text.rejectSourceLimit,
        'target-limit': text.rejectTargetLimit,
        'incompatible-type': text.rejectIncompatible,
        'same-node': text.rejectSameNode,
        'host-rejected': text.rejectHost,
    };
    setStatus(messages[reason] ?? fmt(text.rejectOther, reason));
});
// The toolbar button and the diagram's built-in button both toggle our own window overlay -- not the browser
// Fullscreen API, which hides everything outside the panel and would take the toolbar button with it. Either
// button expands the canvas to fill the window below the header; the same button collapses it, and it mirrors
// the state onto both controls. Escape exits too.
let expanded = false;
const setDiagramExpanded = (value: boolean): void => {
    if (expanded === value) return;
    expanded = value;
    canvasPanel.classList.toggle('is-fullscreen', value);
    const label = value ? strings().exitFullscreen : strings().enterFullscreen;
    fullscreenButton.classList.toggle('is-active', value);
    fullscreenButton.title = label;
    fullscreenButton.setAttribute('aria-label', label);
    fullscreenButton.setAttribute('aria-pressed', String(value));
    diagram.setFullscreenState(value);
    requestAnimationFrame(() => {
        diagram.resize(diagramHost.clientWidth, diagramHost.clientHeight);
        diagram.zoomToFit();
    });
    setStatus(value ? strings().diagramExpanded : strings().diagramRestored);
};

diagram.on('fullscreenRequested', ({ fullscreen }) => setDiagramExpanded(fullscreen));
fullscreenButton.addEventListener('click', () => setDiagramExpanded(!expanded));
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && expanded) setDiagramExpanded(false);
});
diagram.on('nodeOpen', ({ nodes }) => {
    const selected = nodes[0];
    if (selected?.openAction !== 'indicatorSettings') return;
    activeIndicator = selected;
    indicatorTitle.textContent = selected.name;
    indicatorPeriod.value = selected.paramValues.Period
        ?? selected.name.match(/\((\d+)\)/)?.[1]
        ?? '20';
    const input = selected.inPorts.find((port) => port.id === 'source');
    const output = selected.outPorts.find((port) => port.id === 'value');
    const normalizedType = input?.type.trim().toLowerCase() ?? '';
    indicatorInputType.value = normalizedType === 'any' || normalizedType === 'object'
        || normalizedType === 'system.object' || normalizedType === '*'
        ? 'Object'
        : 'Candle';
    indicatorInputMulti.checked = input !== undefined && input.maxLinks !== 1;
    indicatorOutputMulti.checked = output !== undefined && output.maxLinks !== 1;
    if (indicatorDialog.open) indicatorDialog.close();
    indicatorDialog.showModal();
    indicatorPeriod.focus();
    indicatorPeriod.select();
    setStatus(fmt(strings().openedIndicator, selected.name));
});

indicatorForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (activeIndicator === null || !indicatorPeriod.reportValidity()) return;
    const period = indicatorPeriod.value;
    const baseName = activeIndicator.name.replace(/\s*\(\d+\)\s*$/, '');
    diagram.transaction('update indicator settings', () => {
        diagram.setNodeParamValue(activeIndicator!.id, 'Period', period);
        diagram.setNodeName(activeIndicator!.id, `${baseName} (${period})`);
        diagram.updatePort(activeIndicator!.id, 'in', 'source', {
            type: indicatorInputType.value,
            availableTypes: [],
            maxLinks: indicatorInputMulti.checked ? 0 : 1,
        });
        diagram.updatePort(activeIndicator!.id, 'out', 'value', {
            maxLinks: indicatorOutputMulti.checked ? 0 : 1,
        });
    });
    setStatus(fmt(
        strings().updatedIndicator,
        baseName,
        period,
        indicatorInputType.value,
        indicatorInputMulti.checked ? 'multiple' : 'single',
        indicatorOutputMulti.checked ? 'multiple' : 'single',
    ));
    indicatorDialog.close();
    activeIndicator = null;
});
requireElement<HTMLButtonElement>('#indicatorCancelBtn').addEventListener('click', () => {
    activeIndicator = null;
    indicatorDialog.close();
});

search.addEventListener('input', () => palette.setFilter(search.value));

diagramHost.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes(PALETTE_DRAG_MIME) !== true) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
});
diagramHost.addEventListener('drop', (event) => {
    event.preventDefault();
    const raw = event.dataTransfer?.getData(PALETTE_DRAG_MIME) ?? '';
    try {
        const payload = JSON.parse(raw) as { typeId?: string };
        if (typeof payload.typeId === 'string')
            diagram.dropNodeFromPalette(payload.typeId, event.clientX, event.clientY);
    } catch {
        setStatus(strings().paletteDropInvalid);
    }
});

// Wrapped, not passed directly: reset() takes node errors, and handing it to
// addEventListener would feed it the click event as that argument.
requireElement<HTMLButtonElement>('#resetBtn').addEventListener('click', () => reset());
requireElement<HTMLButtonElement>('#undoBtn').addEventListener('click', () => {
    diagram.undo(); updateState();
});
requireElement<HTMLButtonElement>('#redoBtn').addEventListener('click', () => {
    diagram.redo(); updateState();
});
function download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Same framing for every export, so the three outputs are the same picture in three forms.
const exportOptions = { scope: 'content', padding: 40, includeOverview: false, includeSelection: false } as const;

// The control offers Export in its context menu but produces nothing itself: only the host
// knows where the result goes. This is that host, and the toolbar buttons below go through
// the very same command, so the menu and the buttons cannot drift apart.
diagram.on('exportRequested', ({ format }) => {
    if (format === 'document') {
        download(new Blob([JSON.stringify(diagram.saveDocument(), null, 2)], { type: 'application/json' }), 'stocksharp-strategy.json');
        setStatus(strings().schemeExported);
        return;
    }
    if (format === 'svg') {
        download(new Blob([diagram.takeSvg(exportOptions)], { type: 'image/svg+xml' }), 'stocksharp-strategy.svg');
        setStatus(strings().vectorExported);
        return;
    }
    diagram.takeScreenshot({ ...exportOptions, pixelRatio: 2 }).toBlob((blob) => {
        if (blob === null) {
            setStatus(strings().imageFailed);
            return;
        }
        download(blob, 'stocksharp-strategy.png');
        setStatus(strings().imageExported);
    }, 'image/png');
});

diagram.on('nodeProperties', ({ nodes }) => {
    setStatus(fmt(strings().propertiesRequested, nodes.map((node) => node.name).join(', ')));
});

requireElement<HTMLButtonElement>('#exportBtn').addEventListener('click', () => {
    diagram.executeContextCommand('exportPng');
});
requireElement<HTMLButtonElement>('#exportSvgBtn').addEventListener('click', () => {
    diagram.executeContextCommand('exportSvg');
});
requireElement<HTMLButtonElement>('#runtimeErrorBtn').addEventListener('click', () => {
    diagram.setNodeError('orders', 'Order Builder failed: order volume is not configured.');
    setStatus(strings().runtimeErrorShown);
});
requireElement<HTMLButtonElement>('#loadErrorBtn').addEventListener('click', () => {
    reset({
        slow: 'Scheme load failed for Slow SMA: the saved Period value is invalid.',
    });
    setStatus(strings().brokenLoadShown);
});
themeButton.addEventListener('click', () => {
    light = !light; applyTheme();
});
requireElement<HTMLButtonElement>('#readonlyBtn').addEventListener('click', (event) => {
    readOnly = !readOnly;
    diagram.setReadOnly(readOnly);
    const button = event.currentTarget as HTMLButtonElement;
    button.classList.toggle('on', readOnly);
    button.textContent = readOnly ? '● Locked' : 'Read-only';
    setStatus(readOnly ? strings().readOnlyMode : strings().editingEnabled);
});
requireElement<HTMLButtonElement>('#addBtn').addEventListener('click', () => {
    const id = `indicator-${customSequence++}`;
    const created = node('sma', id, `SMA (${10 + customSequence * 3})`, 470, 400);
    diagram.addDiagramNode(created);
});

const resize = (): void => diagram.resize(diagramHost.clientWidth, diagramHost.clientHeight);
if (typeof ResizeObserver !== 'undefined')
    new ResizeObserver(resize).observe(diagramHost);
else
    window.addEventListener('resize', resize);

applyTheme();
resize();
reset();
