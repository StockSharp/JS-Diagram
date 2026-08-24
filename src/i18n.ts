// Shared localization bridge. A host can provide localized values through
// `window.__designerI18n`; every module reads them through `t(key, fallback)`.
// The English fallback prevents a missing or stale key from rendering blank.

export interface DesignerI18n {
    // Panel titles (GoldenLayout tabs).
    panelStrategies?: string;
    panelPalette?: string;
    panelProperties?: string;
    panelDiagram?: string;
    panelOutput?: string;
    panelErrors?: string;
    panelCode?: string;
    panelBacktest?: string;
    panelOptimizer?: string;
    panelLive?: string;
    liveNoRuns?: string;
    selectAnElement?: string;
    noErrors?: string;

    // Solution explorer.
    strategies?: string;
    noStrategiesYet?: string;
    rename?: string;
    newStrategy?: string;
    refresh?: string;
    run?: string;
    stop?: string;
    newIndicator?: string;
    newComposite?: string;
    newCodeStrategy?: string;
    codeLanguagePrompt?: string;
    groupStrategies?: string;
    groupComposites?: string;
    groupIndicators?: string;
    noComposites?: string;
    noIndicators?: string;
    groupOptimizations?: string;
    groupLive?: string;
    optReady?: string;
    optNoStrategy?: string;
    btReady?: string;
    btNoStrategy?: string;
    noOptimizations?: string;
    newOptimization?: string;
    optimize?: string;
    duplicate?: string;
    delete?: string;
    create?: string;
    deleteStrategyTitle?: string;
    deleteStrategyMsg?: string;
    ctxExport?: string;
    encryptTitle?: string;
    encryptLabel?: string;
    importEncTitle?: string;
    importEncLabel?: string;
    importEncRetry?: string;

    // Property grid.
    openDocumentation?: string;
    selectPlaceholder?: string;
    notANumber?: string;
    expectedTimeSpan?: string;
    basicSettings?: string;
    advancedSettings?: string;
    noParameters?: string;
    noBasicParameters?: string;
    noneOption?: string;
    loadingParameters?: string;

    // Modals / generic.
    loading?: string;
    cancel?: string;

    // Discard-confirm dialog.
    discardTitle?: string;
    discardOpenMsg?: string;
    discardCreateMsg?: string;
    discardOpenOk?: string;
    discardCreateOk?: string;

    // Node / diagram authoring.
    nodeMessage?: string;
    nodeName?: string;
    strategyNamePrompt?: string;
    untitledStrategy?: string;
    annotationPlaceholder?: string;
    searchPlaceholder?: string;
    noMatches?: string;

    // Diagram context menu.
    undo?: string;
    redo?: string;
    cut?: string;
    copy?: string;
    paste?: string;
    ctxOpen?: string;
    // Deletes the selected nodes and links. Deliberately not the solution explorer's
    // `delete`, which removes a whole strategy: same English word, but the object differs,
    // and a language that declines it -- or a host that writes "Delete strategy..." -- cannot
    // serve both from one key.
    ctxDelete?: string;
    // Submenu title, and deliberately not `ctxExport` -- that one is the solution
    // explorer's "export this strategy", a different action that a host may well word
    // differently. Reads as its own item too: "Export as > SVG image".
    ctxExportAs?: string;
    ctxExportDocument?: string;
    ctxExportPng?: string;
    ctxExportSvg?: string;
    ctxOverview?: string;
    /** Palette heading for elements that declare no group of their own. */
    paletteCommonGroup?: string;
    properties?: string;
    ctxHelp?: string;

    // Everything else the control renders by itself. Each of these also has a per-instance
    // override -- the fullscreenLabels option, or a data-diagram-* attribute on an embedded
    // host -- and that override wins; these are the defaults when none was given.
    fullscreenEnter?: string;
    fullscreenExit?: string;
    download?: string;
    embedErrorLoad?: string;
    embedErrorEmpty?: string;
    embedErrorDraw?: string;
    embedMissingElement?: string;

    // Not the diagram menu: it has no collapse/expand command. Kept for hosts already
    // shipping them, but moved out of the block above so nobody translates them expecting
    // to see them in the context menu.
    collapse?: string;
    expand?: string;

    // Sign-in popup + run-action gating.
    fillEmailPassword?: string;
    signingIn?: string;
    loginFailed?: string;
    connectionError?: string;
    signInToBacktest?: string;
    signInToExport?: string;
    signInToOptimize?: string;
    signInToRunLive?: string;

    // Strategy-level properties.
    statusLabel?: string;
    statusSaved?: string;
    statusModified?: string;

    // Backtest / optimizer chrome.
    loadingEllipsis?: string;
    failed?: string;
    optGrid?: string;
    optHeatmap?: string;
    opt3d?: string;
    optPickRow?: string;

    // Backtest/optimizer statistic names (StatisticParameterTypes), shown in the
    // backtest stats grid and the optimizer result columns / chart axes.
    stat_winning_trades?: string;
    stat_trade_count?: string;
    stat_roundtrip_count?: string;
    stat_avg_trade_profit?: string;
    stat_avg_win?: string;
    stat_avg_loss?: string;
    stat_losing_trades?: string;
    stat_max_long_position?: string;
    stat_max_short_position?: string;
    stat_max_profit?: string;
    stat_max_drawdown?: string;
    stat_max_relative_drawdown?: string;
    stat_return?: string;
    stat_recovery_factor?: string;
    stat_net_profit?: string;
    stat_max_latency_reg?: string;
    stat_max_latency_cancel?: string;
    stat_min_latency_reg?: string;
    stat_min_latency_cancel?: string;
    stat_order_count?: string;
    stat_order_error_count?: string;
    stat_insufficient_fund_errors?: string;
    stat_trades_per_month?: string;
    stat_trades_per_day?: string;
    stat_max_drawdown_date?: string;
    stat_max_profit_date?: string;
    stat_commission?: string;
    stat_max_drawdown_percent?: string;
    stat_net_profit_percent?: string;
    stat_sharpe_ratio?: string;
    stat_sortino_ratio?: string;
    stat_profit_factor?: string;
    stat_expectancy?: string;
    stat_calmar_ratio?: string;
    stat_sterling_ratio?: string;
    stat_avg_drawdown?: string;
    stat_order_cancel_errors?: string;
    stat_gross_loss?: string;
    stat_gross_profit?: string;
    stat_max_profit_percent?: string;
    stat_sharpe?: string; // short grid-header form
    stat_trades?: string; // short grid-header form

    // Backtest run status / errors.
    btstat_starting?: string;
    btstat_done?: string;
    btstat_stopped?: string;
    btstat_failed?: string;
    bterr_chart_runtime_missing?: string;

    // Order side labels.
    order_buy?: string;
    order_sell?: string;

    // Log level names.
    loglevel_inherit?: string;
    loglevel_verbose?: string;
    loglevel_debug?: string;
    loglevel_info?: string;
    loglevel_warning?: string;
    loglevel_error?: string;
    loglevel_off?: string;

    // Optimizer status / errors / messages.
    opt_no_params?: string;
    opt_bool_values?: string;
    optstat_starting?: string;
    optstat_done?: string;
    optstat_stopped?: string;
    optstat_failed?: string;
    opterr_plotly_missing?: string;
}

/// Localized string for `key`, or `fallback` (English) when the host
/// didn't provide it.
///
/// The bundle is read on every call rather than captured when this module loads. Capturing
/// it meant the host had to assign `window.__designerI18n` before the bundle evaluated --
/// the opposite of the usual order, and impossible for a lazily loaded chunk -- and a host
/// that assigned it afterwards silently got English with nothing to explain why. Reading it
/// live also makes assigning and mutating the object behave the same, and lets the language
/// change mid-session: the only thing reading these keys is the context menu, and it is
/// built fresh on every right-click.
///
/// An empty string counts as missing. Half-finished translation exports routinely emit one,
/// and a blank menu entry is worse than an English one.
export function t(key: keyof DesignerI18n, fallback: string): string {
    if (typeof window === 'undefined') return fallback;
    const value = (window as unknown as { __designerI18n?: DesignerI18n }).__designerI18n?.[key];
    return value === undefined || value === '' ? fallback : value;
}
