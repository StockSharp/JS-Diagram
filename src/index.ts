export {
    DiagramDocumentError,
    cloneDiagramDocument,
    createDiagramDocument,
    parseDiagramDocument,
    serializeDiagramDocument,
} from './core/document.js';

export { renderDiagramSvg } from './headless.js';
export type { HeadlessRenderOptions } from './headless.js';

export { DiagramActionRegistry } from './core/action-registry.js';
export type {
    DiagramAction,
    DiagramActionState,
} from './core/action-registry.js';

export { DiagramCommandHistory } from './core/history.js';
export type {
    DiagramCommand,
    DiagramHistoryListener,
    DiagramHistoryState,
} from './core/history.js';

export { DIAGRAM_DOCUMENT_VERSION } from './core/model.js';

export type {
    DiagramDocument,
    DiagramDocumentEndpoint,
    DiagramDocumentInput,
    DiagramDocumentLink,
    DiagramDocumentLinkInput,
    DiagramDocumentNode,
    DiagramDocumentNodeInput,
    DiagramDocumentPort,
    DiagramDocumentPortInput,
    DiagramDocumentVersion,
    DiagramDocumentZone,
    DiagramDocumentZoneInput,
    DiagramLinkStyle,
    DiagramParameterSchema,
    JsonObject,
    JsonPrimitive,
    JsonValue,
    PortDynamicMode,
} from './core/model.js';

export {
    createEditableDiagramPermissions,
    createDiagramNodeRuntimeState,
    createDiagramPortRuntimeState,
    createDiagramRuntimeState,
    cloneDiagramNodeErrors,
    cloneDiagramRuntimeState,
    createDiagramSelection,
    createDiagramViewState,
    createReadOnlyDiagramPermissions,
} from './core/state.js';

export {
    DIAGRAM_VIEW_STATE_VERSION,
    DiagramViewStateError,
    createDiagramViewStateDocument,
    parseDiagramViewState,
    serializeDiagramViewState,
} from './core/view-state.js';

export type { DiagramViewStateDocument } from './core/view-state.js';

export type {
    DiagramErrorState,
    DiagramGlobalErrorKind,
    DiagramInteractionPermissions,
    DiagramNodeErrorKind,
    DiagramNodeErrors,
    DiagramNodePortRuntimeState,
    DiagramNodeRuntimeState,
    DiagramPortDirection,
    DiagramPortRuntimeState,
    DiagramRuntimeState,
    DiagramSelectedPort,
    DiagramSelection,
    DiagramSnapshot,
    DiagramViewState,
} from './core/state.js';

export {
    StockSharpDiagram,
} from './diagram/stocksharp-diagram.js';

// The menu resolves its labels through this, so a host needs the type to write a bundle the
// compiler can check. Without it the key names get hand-copied, and a typo shows up only as an
// English label on screen.
export type { DesignerI18n } from './i18n.js';

export type {
    ContextCommand,
    ContextCommandGroup,
    ContextCommandGroupState,
    ContextCommandPayload,
    ContextCommandState,
    ContextMenuItemState,
    ContextMenuRequestedPayload,
    ExportFormat,
    ExportRequestedPayload,
    DiagramEvents,
    DiagramClipboard,
    DiagramGridSettings,
    DiagramLoadOptions,
    DiagramNodeBounds,
    DiagramOptions,
    DiagramPoint,
    DiagramScreenshotOptions,
    DiagramScreenshotScope,
    DiagramThemeOptions,
    DocumentLoadFailedPayload,
    LinkChangePayload,
    LinkHoverPayload,
    LinkRelinkedPayload,
    LinkSelectedPayload,
    LinkValidationPayload,
    LinkValidationReason,
    LinkValidationResult,
    LinkValidator,
    LinkValidatorArgs,
    LoadFinishedPayload,
    NodeChangePayload,
    NodeErrorKind,
    NodeErrorOptions,
    NodeHoverPayload,
    NodeMovedPayload,
    NodeSelectedPayload,
    PortHoverPayload,
    PortClickAction,
    PortClickedPayload,
    PortSelectedPayload,
} from './diagram/api.js';

export { StockSharpCatalog } from './diagram/catalog.js';
export type { CatalogEvents } from './diagram/catalog.js';

export {
    PALETTE_DRAG_MIME,
    StockSharpPalette,
} from './diagram/palette.js';
export type {
    PaletteContextMenuPayload,
    PaletteEvents,
    PaletteNodePayload,
    PaletteOptions,
    PaletteSelectionChangedPayload,
} from './diagram/palette.js';

export {
    DiagramNode,
    Link,
    Node,
    Port,
    PortType,
} from './diagram/types.js';

export type {
    DiagramNodeInit,
    LinkEndpoint,
    LinkInit,
    NodeData,
    NodeInit,
    PaletteGroupData,
    PaletteNodeData,
    ParamSchema,
    PortData,
    PortDirection,
    PortInit,
    PortUpdate,
    PortTypeInit,
} from './diagram/types.js';

export {
    destroyRenderedDiagram,
    renderAll,
    renderFromInline,
    renderFromSource,
    renderScheme,
} from './embed.js';

export type {
    DiagramEmbedHandle,
    DiagramEmbedScheme,
    DiagramEmbedSchemeLink,
    DiagramEmbedSchemeNode,
} from './embed.js';
