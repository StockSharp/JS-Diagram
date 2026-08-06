import type { DesignerI18n } from '../src/index';

/**
 * Localization for the demo, in two languages, so it is obvious at a glance whether the
 * control is translated or not.
 *
 * There are two dictionaries here, and the split is the point:
 *
 *  - MENU_LABELS is the control's. The context menu is the only text @stocksharp/diagram
 *    renders itself, and it reads `window.__designerI18n`. English is the built-in fallback,
 *    so the English entry is deliberately empty -- supplying nothing is a supported state.
 *  - STRINGS is the host's. Everything else on the page -- toolbar, palette headings, the
 *    dialog, the status line -- belongs to the application, and the library neither knows
 *    nor cares about it.
 *
 * The bundle can be assigned at any time, including a switch mid-session: the menu is rebuilt
 * on every right-click and reads the global on every lookup.
 */

export type DemoLanguage = 'en' | 'zh';

const MENU_LABELS: Record<DemoLanguage, DesignerI18n> = {
    // Not a mistake: with no bundle the control falls back to its English captions, and the
    // demo exercises that path as the default.
    en: {},
    zh: {
        undo: '撤销',
        redo: '重做',
        cut: '剪切',
        copy: '复制',
        paste: '粘贴',
        ctxOpen: '打开',
        ctxDelete: '删除',
        ctxExportAs: '导出为',
        ctxExportDocument: '方案',
        ctxExportPng: 'PNG 图片',
        ctxExportSvg: 'SVG 图片',
        ctxOverview: '缩略图',
        properties: '属性',
        fullscreenEnter: '进入全屏',
        fullscreenExit: '退出全屏',
        ctxHelp: '帮助',
    },
};

const EN = {
    brand: 'StockSharp JS Strategy Diagram',
    diagramTools: 'Diagram tools',
    resetDiagram: 'Reset diagram',
    undo: 'Undo',
    redo: 'Redo',
    fullscreen: 'Fullscreen',
    enterFullscreen: 'Enter fullscreen',
    exitFullscreen: 'Exit fullscreen',
    exportPng: 'Export PNG',
    exportSvg: 'Export SVG',
    readOnlyBtn: 'Read-only',
    runErrorBtn: 'Run error',
    brokenLoadBtn: 'Broken load',
    themeLight: 'Switch to light theme',
    themeDark: 'Switch to dark theme',
    addNode: '+ Node',
    languageBtn: '中文',
    elements: 'Elements',
    dragToCanvas: 'drag to canvas',
    searchElements: 'Search elements…',
    diagramAria: 'Interactive StockSharp strategy diagram',
    canvasHelp: 'Right-click for the menu · select a wire to drag its endpoint handles · double-click an indicator to edit',
    stats: '{0} nodes · {1} links',

    dlgKicker: 'INDICATOR',
    dlgTitle: 'Indicator settings',
    dlgNote: 'Opened by the host after receiving the node’s nodeOpen event.',
    dlgPeriod: 'Period',
    dlgPortPolicy: 'Port policy',
    dlgInputType: 'Input type',
    dlgCandleOnly: 'Candle only',
    dlgObject: 'Object — any data type',
    dlgAllowMultiIn: 'Allow multiple incoming wires',
    dlgAllowFanOut: 'Allow output fan-out to multiple inputs',
    dlgPortsNote: 'Changes apply to the live ports without reloading the diagram.',
    dlgCancel: 'Cancel',
    dlgApply: 'Apply',

    ready: 'Ready.',
    modelReset: 'Strategy model reset.',
    selectionCleared: 'Selection cleared.',
    selected: 'Selected: {0}',
    added: 'Added: {0}',
    addedFromPalette: 'Added from palette: {0}',
    connected: 'Connected {0} → {1}',
    relinked: 'Relinked {0} → {1}.',
    rejectDuplicate: 'Rejected: that exact output/input pair is already connected.',
    rejectSourceLimit: 'Rejected: the output does not allow another wire.',
    rejectTargetLimit: 'Rejected: the input does not allow another wire.',
    rejectIncompatible: 'Rejected: socket types are incompatible.',
    rejectSameNode: 'Rejected: a node cannot connect to itself.',
    rejectHost: 'Rejected by the host application.',
    rejectOther: 'Rejected: {0}.',
    diagramExpanded: 'Diagram expanded to fill the window.',
    diagramRestored: 'Diagram restored.',
    openedIndicator: 'Opened indicator settings: {0}',
    updatedIndicator: 'Updated {0}: period {1}, input {2}, multi-in {3}, fan-out {4}.',
    paletteDropInvalid: 'Palette drop payload is invalid.',
    schemeExported: 'Scheme exported as JSON.',
    vectorExported: 'Full strategy exported as vector.',
    imageFailed: 'The browser could not encode the diagram image.',
    imageExported: 'Full strategy image exported.',
    propertiesRequested: 'Properties requested for {0}.',
    runtimeErrorShown: 'Runtime error highlighted on Buy on cross. Hover the node for details.',
    brokenLoadShown: 'Loaded a damaged scheme. Hover the red node for details.',
    readOnlyMode: 'Read-only preview mode.',
    editingEnabled: 'Editing enabled.',
    languageSwitched: 'Language: English. Right-click the canvas — the menu comes from the control itself.',
    ctxOverview: 'Overview',

    // The palette's vocabulary. Not the control's either: node types are host data, handed to
    // the catalog, so a localized application localizes these too. Re-registering a type by the
    // same id replaces it and the palette redraws, which is what the language switch does.
    grpSources: 'Sources',
    grpIndicators: 'Indicators',
    grpLogic: 'Logic',
    grpTrading: 'Trading',
    grpExecution: 'Execution',
    grpVisualization: 'Visualization',
    nodeMarketData: 'Market Data',
    nodeMarketDataDesc: 'Streams candles for the selected instrument.',
    nodeSma: 'Simple Moving Average',
    nodeSmaDesc: 'Calculates a moving average over candle closes.',
    nodeSmaPeriodDesc: 'Moving-average length.',
    nodeCrossing: 'Crossing',
    nodeCrossingDesc: 'Emits true when the fast value crosses the slow value.',
    nodeOrderBuilder: 'Order Builder',
    nodeOrderBuilderDesc: 'Creates a market order from a Boolean signal.',
    nodeConnector: 'Broker Connector',
    nodeConnectorDesc: 'Submits orders and publishes own trades.',
    nodeChart: 'Chart',
    nodeChartDesc: 'Visualizes candles and executions.',
    portCandles: 'Candles',
    portSource: 'Source',
    portValue: 'Value',
    portFast: 'Fast',
    portSlow: 'Slow',
    portSignal: 'Signal',
    portOrder: 'Order',
    portTrade: 'Trade',
    portAnyObject: 'Any object',
} as const;

export type DemoStrings = Record<keyof typeof EN, string>;

const ZH: DemoStrings = {
    brand: 'StockSharp JS 策略图',
    diagramTools: '图表工具',
    resetDiagram: '重置图表',
    undo: '撤销',
    redo: '重做',
    fullscreen: '全屏',
    enterFullscreen: '进入全屏',
    exitFullscreen: '退出全屏',
    exportPng: '导出 PNG',
    exportSvg: '导出 SVG',
    readOnlyBtn: '只读',
    runErrorBtn: '运行错误',
    brokenLoadBtn: '损坏的方案',
    themeLight: '切换到浅色主题',
    themeDark: '切换到深色主题',
    addNode: '+ 元素',
    languageBtn: 'EN',
    elements: '元素',
    dragToCanvas: '拖到画布',
    searchElements: '搜索元素…',
    diagramAria: '可交互的 StockSharp 策略图',
    canvasHelp: '右键打开菜单 · 选中连线可拖动其端点 · 双击指标可编辑',
    stats: '{0} 个元素 · {1} 条连线',

    dlgKicker: '指标',
    dlgTitle: '指标设置',
    dlgNote: '宿主程序收到该元素的 nodeOpen 事件后打开。',
    dlgPeriod: '周期',
    dlgPortPolicy: '端口策略',
    dlgInputType: '输入类型',
    dlgCandleOnly: '仅蜡烛图',
    dlgObject: '对象 — 任意数据类型',
    dlgAllowMultiIn: '允许多条输入连线',
    dlgAllowFanOut: '允许输出连接到多个输入',
    dlgPortsNote: '更改会立即应用到端口，无需重新加载图表。',
    dlgCancel: '取消',
    dlgApply: '应用',

    ready: '就绪。',
    modelReset: '已重置策略模型。',
    selectionCleared: '已清除选择。',
    selected: '已选择：{0}',
    added: '已添加：{0}',
    addedFromPalette: '已从元素面板添加：{0}',
    connected: '已连接 {0} → {1}',
    relinked: '已重新连接 {0} → {1}。',
    rejectDuplicate: '已拒绝：该输出/输入组合已经连接。',
    rejectSourceLimit: '已拒绝：该输出不允许再连接一条线。',
    rejectTargetLimit: '已拒绝：该输入不允许再连接一条线。',
    rejectIncompatible: '已拒绝：端口类型不兼容。',
    rejectSameNode: '已拒绝：元素不能连接到自身。',
    rejectHost: '已被宿主程序拒绝。',
    rejectOther: '已拒绝：{0}。',
    diagramExpanded: '图表已放大至整个窗口。',
    diagramRestored: '图表已还原。',
    openedIndicator: '已打开指标设置：{0}',
    updatedIndicator: '已更新 {0}：周期 {1}，输入 {2}，多路输入 {3}，扇出 {4}。',
    paletteDropInvalid: '元素面板的拖放数据无效。',
    schemeExported: '方案已导出为 JSON。',
    vectorExported: '已导出完整策略的矢量图。',
    imageFailed: '浏览器无法编码该图表图片。',
    imageExported: '已导出完整策略图片。',
    propertiesRequested: '已请求属性：{0}。',
    runtimeErrorShown: '已在“Buy on cross”上标记运行时错误。将鼠标悬停在该元素上查看详情。',
    brokenLoadShown: '已加载损坏的方案。将鼠标悬停在红色元素上查看详情。',
    readOnlyMode: '只读预览模式。',
    editingEnabled: '已启用编辑。',
    languageSwitched: '语言：中文。右键点击画布 — 菜单来自控件本身。',
    ctxOverview: '缩略图',

    grpSources: '数据源',
    grpIndicators: '指标',
    grpLogic: '逻辑',
    grpTrading: '交易',
    grpExecution: '执行',
    grpVisualization: '可视化',
    nodeMarketData: '行情数据',
    nodeMarketDataDesc: '推送所选合约的蜡烛数据。',
    nodeSma: '简单移动平均',
    nodeSmaDesc: '按蜡烛收盘价计算移动平均。',
    nodeSmaPeriodDesc: '移动平均的周期长度。',
    nodeCrossing: '交叉',
    nodeCrossingDesc: '当快线穿越慢线时输出 true。',
    nodeOrderBuilder: '订单构建器',
    nodeOrderBuilderDesc: '根据布尔信号创建市价单。',
    nodeConnector: '券商连接器',
    nodeConnectorDesc: '提交订单并发布自成交。',
    nodeChart: '图表',
    nodeChartDesc: '展示蜡烛与成交。',
    portCandles: '蜡烛',
    portSource: '数据源',
    portValue: '数值',
    portFast: '快线',
    portSlow: '慢线',
    portSignal: '信号',
    portOrder: '订单',
    portTrade: '成交',
    portAnyObject: '任意对象',
};

const DICTIONARIES: Record<DemoLanguage, DemoStrings> = { en: EN, zh: ZH };

let current: DemoLanguage = 'en';

/// Current host dictionary. Read it per use rather than caching, so a switch takes effect.
export function strings(): DemoStrings {
    return DICTIONARIES[current];
}

export function language(): DemoLanguage {
    return current;
}

/// Fills `{0}`, `{1}`, … so a translation can reorder them, which several languages need.
export function fmt(template: string, ...values: Array<string | number>): string {
    return template.replace(/\{(\d+)\}/g, (whole, index: string) => {
        const value = values[Number(index)];
        return value === undefined ? whole : String(value);
    });
}

/**
 * Switches both dictionaries at once and repaints the static markup. Elements opt in with
 * `data-i18n` for their text and `data-i18n-title` for title + aria-label, so adding a label
 * to the page never means editing this function.
 */
export function applyLanguage(next: DemoLanguage): void {
    current = next;
    (window as unknown as { __designerI18n: DesignerI18n }).__designerI18n = MENU_LABELS[next];

    const text = strings();
    for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
        const key = element.dataset.i18n as keyof DemoStrings | undefined;
        if (key !== undefined && key in text) element.textContent = text[key];
    }
    for (const element of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
        const key = element.dataset.i18nTitle as keyof DemoStrings | undefined;
        if (key === undefined || !(key in text)) continue;
        element.title = text[key];
        element.setAttribute('aria-label', text[key]);
    }
    for (const element of document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
        const key = element.dataset.i18nPlaceholder as keyof DemoStrings | undefined;
        if (key !== undefined && key in text) element.placeholder = text[key];
    }
    document.documentElement.lang = next === 'zh' ? 'zh' : 'en';
}
