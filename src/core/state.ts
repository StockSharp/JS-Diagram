export type DiagramPortDirection = 'in' | 'out';
export type DiagramNodeErrorKind = 'runtime' | 'load';
export type DiagramGlobalErrorKind = 'invalid' | 'load' | 'locked' | 'encrypted';

export interface DiagramErrorState<TKind extends string> {
    kind: TKind;
    message: string;
    /** Incrementing this value requests a fresh renderer animation. */
    pulse: number;
}

export interface DiagramPortRuntimeState {
    active: boolean;
    selected: boolean;
    breakpoint: boolean;
    breakpointActive: boolean;
    value: string | null;
    error: string | null;
}

export interface DiagramNodePortRuntimeState {
    in: Record<string, DiagramPortRuntimeState>;
    out: Record<string, DiagramPortRuntimeState>;
}

/**
 * At most one error per kind. A node can carry a load error and a runtime error
 * at the same time -- the tooltip shows both -- so a single slot could not hold
 * what the editor already models, and every state write dropped one of them.
 */
export type DiagramNodeErrors = {
    [TKind in DiagramNodeErrorKind]?: DiagramErrorState<TKind>;
};

export interface DiagramNodeRuntimeState {
    active: boolean;
    errors: DiagramNodeErrors;
    ports: DiagramNodePortRuntimeState;
}

export interface DiagramRuntimeState {
    activeNodeId: string | null;
    nodes: Record<string, DiagramNodeRuntimeState>;
    globalError: DiagramErrorState<DiagramGlobalErrorKind> | null;
}

export interface DiagramViewState {
    zoom: number;
    panX: number;
    panY: number;
    overviewVisible: boolean;
}

export interface DiagramSelectedPort {
    nodeId: string;
    portId: string;
    direction: DiagramPortDirection;
}

export interface DiagramSelection {
    nodeIds: string[];
    linkIds: string[];
    port: DiagramSelectedPort | null;
    primaryNodeId: string | null;
    primaryLinkId: string | null;
}

export interface DiagramInteractionPermissions {
    select: boolean;
    inspect: boolean;
    copy: boolean;
    moveNodes: boolean;
    createLinks: boolean;
    deleteSelection: boolean;
    paste: boolean;
    history: boolean;
}

export function createDiagramRuntimeState(): DiagramRuntimeState {
    return { activeNodeId: null, nodes: {}, globalError: null };
}

export function cloneDiagramRuntimeState(state: DiagramRuntimeState): DiagramRuntimeState {
    return {
        activeNodeId: state.activeNodeId,
        globalError: state.globalError === null ? null : { ...state.globalError },
        nodes: Object.fromEntries(Object.entries(state.nodes).map(([nodeId, node]) => [nodeId, {
            active: node.active,
            errors: cloneDiagramNodeErrors(node.errors),
            ports: {
                in: Object.fromEntries(Object.entries(node.ports.in)
                    .map(([portId, port]) => [portId, { ...port }])),
                out: Object.fromEntries(Object.entries(node.ports.out)
                    .map(([portId, port]) => [portId, { ...port }])),
            },
        }])),
    };
}

export function createDiagramViewState(): DiagramViewState {
    return { zoom: 1, panX: 0, panY: 0, overviewVisible: true };
}

export function createDiagramSelection(): DiagramSelection {
    return {
        nodeIds: [],
        linkIds: [],
        port: null,
        primaryNodeId: null,
        primaryLinkId: null,
    };
}

export function createDiagramPortRuntimeState(): DiagramPortRuntimeState {
    return {
        active: false,
        selected: false,
        breakpoint: false,
        breakpointActive: false,
        value: null,
        error: null,
    };
}

export function createEditableDiagramPermissions(): DiagramInteractionPermissions {
    return {
        select: true,
        inspect: true,
        copy: true,
        moveNodes: true,
        createLinks: true,
        deleteSelection: true,
        paste: true,
        history: true,
    };
}

export function createReadOnlyDiagramPermissions(): DiagramInteractionPermissions {
    return {
        select: true,
        inspect: true,
        copy: true,
        moveNodes: false,
        createLinks: false,
        deleteSelection: false,
        paste: false,
        history: false,
    };
}

export function createDiagramNodeRuntimeState(): DiagramNodeRuntimeState {
    return {
        active: false,
        errors: {},
        ports: { in: {}, out: {} },
    };
}

/**
 * Tolerates a missing map: hosts persist runtime snapshots and build them by
 * hand, so a state written before this field existed still has to be readable.
 */
export function cloneDiagramNodeErrors(errors: DiagramNodeErrors | undefined | null): DiagramNodeErrors {
    const result: DiagramNodeErrors = {};
    if (errors === undefined || errors === null) return result;
    if (errors.runtime !== undefined) result.runtime = { ...errors.runtime };
    if (errors.load !== undefined) result.load = { ...errors.load };
    return result;
}
