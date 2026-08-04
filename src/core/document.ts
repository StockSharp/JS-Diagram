import { setJsonKey } from './json.js';
import { toPortDynamicMode } from './model.js';
import {
    DIAGRAM_DOCUMENT_VERSION,
    type DiagramDocument,
    type DiagramDocumentEndpoint,
    type DiagramDocumentInput,
    type DiagramDocumentLink,
    type DiagramLinkStyle,
    type DiagramDocumentNode,
    type DiagramDocumentPort,
    type DiagramDocumentZone,
    type DiagramParameterSchema,
    type PortDynamicMode,
    type JsonObject,
    type JsonValue,
} from './model.js';

export { DIAGRAM_DOCUMENT_VERSION } from './model.js';
export type {
    DiagramDocument,
    DiagramDocumentEndpoint,
    DiagramDocumentInput,
    DiagramDocumentLink,
    DiagramDocumentLinkInput,
    DiagramLinkStyle,
    DiagramDocumentNode,
    DiagramDocumentNodeInput,
    DiagramDocumentPort,
    DiagramDocumentPortInput,
    DiagramDocumentZone,
    DiagramDocumentZoneInput,
    DiagramDocumentVersion,
    DiagramParameterSchema,
    JsonObject,
    JsonPrimitive,
    JsonValue,
} from './model.js';

export class DiagramDocumentError extends Error {
    constructor(message: string, readonly path: string = '$') {
        super(`${path}: ${message}`);
        this.name = 'DiagramDocumentError';
    }
}

export function createDiagramDocument(input: DiagramDocumentInput = {}): DiagramDocument {
    // DiagramDocumentInput is a structural interface, so its shape is a claim by
    // the caller, not a guarantee. Elements are checked the same way parsed ones
    // are, otherwise a malformed one surfaces as a TypeError naming no path.
    const rawNodes = mapElements(input.nodes, '$.nodes');
    const rawLinks = mapElements(input.links, '$.links');
    const nodes = rawNodes.map((node, index) => normalizeNode(node, `$.nodes[${index}]`));
    const usedLinkIds = new Set<string>();

    for (let index = 0; index < rawLinks.length; index++) {
        const raw = rawLinks[index].id;
        if (raw === undefined) continue;
        const id = requireIdentifier(raw, `$.links[${index}].id`);
        if (usedLinkIds.has(id)) {
            throw new DiagramDocumentError(`duplicate link id "${id}"`, `$.links[${index}].id`);
        }
        usedLinkIds.add(id);
    }

    let sequence = 1;
    const links = rawLinks.map((link, index) => {
        let id = link.id;
        if (id === undefined) {
            let generated: string;
            do generated = `link_${sequence++}`;
            while (usedLinkIds.has(generated));
            usedLinkIds.add(generated);
            id = generated;
        }
        return normalizeLink({ ...link, id }, `$.links[${index}]`);
    });
    const rawZones = mapElements(input.zones, '$.zones');
    const usedZoneIds = new Set<string>();
    const zones = rawZones.map((zone, index) => {
        const normalized = normalizeZone(zone, `$.zones[${index}]`);
        if (usedZoneIds.has(normalized.id)) {
            throw new DiagramDocumentError(`duplicate zone id "${normalized.id}"`, `$.zones[${index}].id`);
        }
        usedZoneIds.add(normalized.id);
        return normalized;
    });

    const document: DiagramDocument = {
        version: DIAGRAM_DOCUMENT_VERSION,
        nodes,
        links,
        zones,
        metadata: cloneJsonObject(input.metadata ?? {}, '$.metadata'),
    };
    validateDocument(document);
    return document;
}

export function cloneDiagramDocument(document: DiagramDocument): DiagramDocument {
    return parseDiagramDocument(document);
}

export function serializeDiagramDocument(document: DiagramDocument, space?: number): string {
    return JSON.stringify(parseDiagramDocument(document), null, space);
}

export function parseDiagramDocument(source: string | unknown): DiagramDocument {
    let value: unknown = source;
    if (typeof source === 'string') {
        try {
            value = JSON.parse(source) as unknown;
        } catch (error) {
            const reason = error instanceof Error ? error.message : 'invalid JSON';
            throw new DiagramDocumentError(reason);
        }
    }

    const root = requireStructure(value, '$');
    const version = requireNumber(root.version, '$.version');
    if (version !== DIAGRAM_DOCUMENT_VERSION) {
        throw new DiagramDocumentError(`unsupported document version ${version}`, '$.version');
    }
    const document: DiagramDocument = {
        version: DIAGRAM_DOCUMENT_VERSION,
        nodes: requireArray(root.nodes, '$.nodes').map((node, index) => parseNode(node, `$.nodes[${index}]`)),
        links: requireArray(root.links, '$.links').map((link, index) => parseLink(link, `$.links[${index}]`)),
        // Zones arrived after the first documents were written, so their absence is not a fault:
        // an older file simply has none, and reading it must not need a migration step.
        zones: root.zones === undefined || root.zones === null
            ? []
            : requireArray(root.zones, '$.zones').map((zone, index) => normalizeZone(zone, `$.zones[${index}]`)),
        metadata: cloneJsonObject(root.metadata, '$.metadata'),
    };
    validateDocument(document);
    return document;
}

function normalizeNode(value: unknown, path: string): DiagramDocumentNode {
    const input = requireStructure(value, path);
    const id = requireIdentifier(input.id, `${path}.id`);
    return {
        id,
        typeId: requireIdentifier(input.typeId ?? id, `${path}.typeId`),
        name: requireString(input.name, `${path}.name`),
        description: requireString(input.description ?? '', `${path}.description`),
        groupName: requireString(input.groupName ?? 'Common', `${path}.groupName`),
        x: requireFiniteNumber(input.x ?? 0, `${path}.x`),
        y: requireFiniteNumber(input.y ?? 0, `${path}.y`),
        color: requireString(input.color ?? '#d7d7d7', `${path}.color`),
        border: requireString(input.border ?? '#8c8c8c', `${path}.border`),
        icon: requireString(input.icon ?? '', `${path}.icon`),
        message: requireString(input.message ?? '', `${path}.message`),
        openAction: requireString(input.openAction ?? '', `${path}.openAction`),
        inPorts: mapElements(input.inPorts, `${path}.inPorts`)
            .map((port, index) => normalizePort(port, `${path}.inPorts[${index}]`)),
        outPorts: mapElements(input.outPorts, `${path}.outPorts`)
            .map((port, index) => normalizePort(port, `${path}.outPorts[${index}]`)),
        parameters: mapElements(input.parameters, `${path}.parameters`)
            .map((parameter, index) => normalizeParameter(parameter, `${path}.parameters[${index}]`)),
        paramValues: cloneStringRecord(input.paramValues ?? {}, `${path}.paramValues`),
        metadata: cloneJsonObject(input.metadata ?? {}, `${path}.metadata`),
    };
}

function normalizePort(value: unknown, path: string): DiagramDocumentPort {
    const input = requireStructure(value, path);
    return {
        id: requireIdentifier(input.id, `${path}.id`),
        name: requireString(input.name, `${path}.name`),
        description: requireString(input.description ?? '', `${path}.description`),
        type: requireString(input.type ?? '', `${path}.type`),
        maxLinks: requireNonNegativeInteger(input.maxLinks ?? 0, `${path}.maxLinks`),
        availableTypes: requireArray(input.availableTypes ?? [], `${path}.availableTypes`)
            .map((type, index) => requireString(type, `${path}.availableTypes[${index}]`)),
        isDynamic: requireBoolean(input.isDynamic ?? false, `${path}.isDynamic`),
        dynamicMode: requirePortDynamicMode(input.dynamicMode ?? '', `${path}.dynamicMode`),
        isSibling: requireBoolean(input.isSibling ?? false, `${path}.isSibling`),
        metadata: cloneJsonObject(input.metadata ?? {}, `${path}.metadata`),
    };
}

function normalizeParameter(value: unknown, path: string): DiagramParameterSchema {
    const input = requireStructure(value, path);
    return {
        name: requireIdentifier(input.name, `${path}.name`),
        displayName: requireString(input.displayName, `${path}.displayName`),
        description: requireString(input.description, `${path}.description`),
        type: requireString(input.type, `${path}.type`),
        defaultValue: requireString(input.defaultValue, `${path}.defaultValue`),
        options: requireArray(input.options, `${path}.options`).map((option, index) => requireString(option, `${path}.options[${index}]`)),
        min: requireNullableFiniteNumber(input.min, `${path}.min`),
        max: requireNullableFiniteNumber(input.max, `${path}.max`),
        displayOrder: requireFiniteNumber(input.displayOrder, `${path}.displayOrder`),
        category: requireString(input.category, `${path}.category`),
        isBasic: requireBoolean(input.isBasic, `${path}.isBasic`),
        editorType: requireString(input.editorType, `${path}.editorType`),
    };
}

function normalizeLink(value: unknown, path: string): DiagramDocumentLink {
    const input = requireStructure(value, path);
    return {
        id: requireIdentifier(input.id, `${path}.id`),
        from: normalizeEndpoint(input.from, `${path}.from`),
        to: normalizeEndpoint(input.to, `${path}.to`),
        style: requireLinkStyle(input.style, `${path}.style`),
        metadata: cloneJsonObject(input.metadata ?? {}, `${path}.metadata`),
    };
}

// A style the caller misspelled is a drawing that quietly loses its meaning, so it is refused
// rather than defaulted - unlike an absent one, which simply means a plain line.
function requireLinkStyle(value: unknown, path: string): DiagramLinkStyle {
    if (value === undefined || value === null) return 'solid';
    if (value !== 'solid' && value !== 'dashed') {
        throw new DiagramDocumentError(`unknown link style "${String(value)}"`, path);
    }
    return value;
}

function normalizeZone(value: unknown, path: string): DiagramDocumentZone {
    const input = requireStructure(value, path);
    return {
        id: requireIdentifier(input.id, `${path}.id`),
        name: requireString(input.name, `${path}.name`),
        x: requireNumber(input.x, `${path}.x`),
        y: requireNumber(input.y, `${path}.y`),
        width: requirePositiveSize(input.width, `${path}.width`),
        height: requirePositiveSize(input.height, `${path}.height`),
        color: input.color === undefined || input.color === null ? '' : requireString(input.color, `${path}.color`),
        metadata: cloneJsonObject(input.metadata ?? {}, `${path}.metadata`),
    };
}

// A zone with no area cannot be pointed at, and a negative one paints outside itself, so the
// size is refused rather than clamped - a caller that computed it wrong wants to hear about it.
function requirePositiveSize(value: unknown, path: string): number {
    const size = requireNumber(value, path);
    if (!(size > 0)) throw new DiagramDocumentError('size must be greater than zero', path);
    return size;
}

function normalizeEndpoint(value: unknown, path: string): DiagramDocumentEndpoint {
    const input = requireStructure(value, path);
    return {
        nodeId: requireIdentifier(input.nodeId, `${path}.nodeId`),
        portId: requireIdentifier(input.portId, `${path}.portId`),
    };
}

function parseNode(value: unknown, path: string): DiagramDocumentNode {
    const node = requireStructure(value, path);
    return normalizeNode({
        id: requireString(node.id, `${path}.id`),
        typeId: requireString(node.typeId, `${path}.typeId`),
        name: requireString(node.name, `${path}.name`),
        description: requireString(node.description, `${path}.description`),
        groupName: requireString(node.groupName, `${path}.groupName`),
        x: requireNumber(node.x, `${path}.x`),
        y: requireNumber(node.y, `${path}.y`),
        color: requireString(node.color, `${path}.color`),
        border: requireString(node.border, `${path}.border`),
        icon: requireString(node.icon, `${path}.icon`),
        message: requireString(node.message, `${path}.message`),
        openAction: requireString(node.openAction, `${path}.openAction`),
        inPorts: requireArray(node.inPorts, `${path}.inPorts`).map((port, index) => parsePort(port, `${path}.inPorts[${index}]`)),
        outPorts: requireArray(node.outPorts, `${path}.outPorts`).map((port, index) => parsePort(port, `${path}.outPorts[${index}]`)),
        parameters: requireArray(node.parameters, `${path}.parameters`).map((parameter, index) => parseParameter(parameter, `${path}.parameters[${index}]`)),
        paramValues: cloneStringRecord(node.paramValues, `${path}.paramValues`),
        metadata: cloneJsonObject(node.metadata, `${path}.metadata`),
    }, path);
}

function parsePort(value: unknown, path: string): DiagramDocumentPort {
    const port = requireStructure(value, path);
    return normalizePort({
        id: requireString(port.id, `${path}.id`),
        name: requireString(port.name, `${path}.name`),
        description: requireString(port.description, `${path}.description`),
        type: requireString(port.type, `${path}.type`),
        maxLinks: requireNumber(port.maxLinks, `${path}.maxLinks`),
        availableTypes: requireArray(port.availableTypes, `${path}.availableTypes`).map((type, index) => requireString(type, `${path}.availableTypes[${index}]`)),
        isDynamic: requireBoolean(port.isDynamic, `${path}.isDynamic`),
        dynamicMode: requirePortDynamicMode(port.dynamicMode, `${path}.dynamicMode`),
        isSibling: requireBoolean(port.isSibling, `${path}.isSibling`),
        metadata: cloneJsonObject(port.metadata, `${path}.metadata`),
    }, path);
}

function parseParameter(value: unknown, path: string): DiagramParameterSchema {
    const parameter = requireStructure(value, path);
    return normalizeParameter({
        name: requireString(parameter.name, `${path}.name`),
        displayName: requireString(parameter.displayName, `${path}.displayName`),
        description: requireString(parameter.description, `${path}.description`),
        type: requireString(parameter.type, `${path}.type`),
        defaultValue: requireString(parameter.defaultValue, `${path}.defaultValue`),
        options: requireArray(parameter.options, `${path}.options`).map((option, index) => requireString(option, `${path}.options[${index}]`)),
        min: requireNullableFiniteNumber(parameter.min, `${path}.min`),
        max: requireNullableFiniteNumber(parameter.max, `${path}.max`),
        displayOrder: requireNumber(parameter.displayOrder, `${path}.displayOrder`),
        category: requireString(parameter.category, `${path}.category`),
        isBasic: requireBoolean(parameter.isBasic, `${path}.isBasic`),
        editorType: requireString(parameter.editorType, `${path}.editorType`),
    }, path);
}

function parseLink(value: unknown, path: string): DiagramDocumentLink {
    const link = requireStructure(value, path);
    return normalizeLink({
        id: requireString(link.id, `${path}.id`),
        from: parseEndpoint(link.from, `${path}.from`),
        to: parseEndpoint(link.to, `${path}.to`),
        style: link.style === undefined ? undefined : requireLinkStyle(link.style, `${path}.style`),
        metadata: cloneJsonObject(link.metadata, `${path}.metadata`),
    }, path);
}

function parseEndpoint(value: unknown, path: string): DiagramDocumentEndpoint {
    const endpoint = requireStructure(value, path);
    return {
        nodeId: requireIdentifier(endpoint.nodeId, `${path}.nodeId`),
        portId: requireIdentifier(endpoint.portId, `${path}.portId`),
    };
}

function validateDocument(document: DiagramDocument): void {
    const nodes = new Map<string, DiagramDocumentNode>();
    for (let index = 0; index < document.nodes.length; index++) {
        const node = document.nodes[index];
        if (nodes.has(node.id)) throw new DiagramDocumentError(`duplicate node id "${node.id}"`, `$.nodes[${index}].id`);
        validateUniquePorts(node.inPorts, `$.nodes[${index}].inPorts`);
        validateUniquePorts(node.outPorts, `$.nodes[${index}].outPorts`);
        nodes.set(node.id, node);
    }

    const linkIds = new Set<string>();
    const endpoints = new Set<string>();
    for (let index = 0; index < document.links.length; index++) {
        const link = document.links[index];
        const path = `$.links[${index}]`;
        if (linkIds.has(link.id)) throw new DiagramDocumentError(`duplicate link id "${link.id}"`, `${path}.id`);
        linkIds.add(link.id);
        const fromNode = nodes.get(link.from.nodeId);
        const toNode = nodes.get(link.to.nodeId);
        if (fromNode === undefined) throw new DiagramDocumentError(`unknown source node "${link.from.nodeId}"`, `${path}.from.nodeId`);
        if (toNode === undefined) throw new DiagramDocumentError(`unknown target node "${link.to.nodeId}"`, `${path}.to.nodeId`);
        if (!fromNode.outPorts.some((port) => port.id === link.from.portId)) {
            throw new DiagramDocumentError(`unknown output port "${link.from.portId}"`, `${path}.from.portId`);
        }
        if (!toNode.inPorts.some((port) => port.id === link.to.portId)) {
            throw new DiagramDocumentError(`unknown input port "${link.to.portId}"`, `${path}.to.portId`);
        }
        const key = `${link.from.nodeId}\u0000${link.from.portId}\u0000${link.to.nodeId}\u0000${link.to.portId}`;
        if (endpoints.has(key)) throw new DiagramDocumentError('duplicate link endpoints', path);
        endpoints.add(key);
    }
}

function validateUniquePorts(ports: readonly DiagramDocumentPort[], path: string): void {
    const ids = new Set<string>();
    for (let index = 0; index < ports.length; index++) {
        const id = ports[index].id;
        if (ids.has(id)) throw new DiagramDocumentError(`duplicate port id "${id}"`, `${path}[${index}].id`);
        ids.add(id);
    }
}

function cloneStringRecord(value: unknown, path: string): Record<string, string> {
    const object = requireObject(value, path);
    const result: Record<string, string> = {};
    for (const [key, item] of Object.entries(object)) setJsonKey(result, key, requireString(item, `${path}.${key}`));
    return result;
}

function cloneJsonObject(value: unknown, path: string, ancestors = new WeakSet<object>()): JsonObject {
    const object = requireObject(value, path);
    if (ancestors.has(object)) throw new DiagramDocumentError('circular JSON value', path);
    ancestors.add(object);
    const result: JsonObject = {};
    try {
        for (const [key, item] of Object.entries(object)) {
            setJsonKey(result, key, cloneJsonValue(item, `${path}.${key}`, ancestors));
        }
    } finally {
        ancestors.delete(object);
    }
    return result;
}

function cloneJsonValue(value: unknown, path: string, ancestors: WeakSet<object>): JsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return requireFiniteNumber(value, path);
    if (Array.isArray(value)) {
        if (ancestors.has(value)) throw new DiagramDocumentError('circular JSON value', path);
        ancestors.add(value);
        try {
            return value.map((item, index) => cloneJsonValue(item, `${path}[${index}]`, ancestors));
        } finally {
            ancestors.delete(value);
        }
    }
    if (isObject(value)) return cloneJsonObject(value, path, ancestors);
    throw new DiagramDocumentError('expected a JSON value', path);
}

/**
 * A container whose fields are read individually. Any object will do, including
 * a class instance: hosts build schemes out of DiagramNode and Port, not object
 * literals, and every field is validated on its own below.
 */
function requireStructure(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new DiagramDocumentError('expected an object', path);
    }
    return value as Record<string, unknown>;
}

/**
 * A value that has to survive JSON round-tripping unchanged. Stricter than
 * requireStructure on purpose: a Date or any other class instance would
 * serialize to something the parser could not read back.
 */
function requireObject(value: unknown, path: string): Record<string, unknown> {
    if (!isObject(value)) throw new DiagramDocumentError('expected an object', path);
    return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value) as object | null;
    return prototype === Object.prototype || prototype === null;
}

/**
 * Reads an optional array of objects, rejecting a non-array, a hole or a
 * non-object element. null counts as absent, like the `?? []` every other
 * optional field is read through.
 */
function mapElements(value: unknown, path: string): Record<string, unknown>[] {
    if (value === undefined || value === null) return [];
    // Array.from rather than map: map skips holes, carrying an undefined element
    // into the result instead of reporting it.
    return Array.from(
        requireArray(value, path),
        (element, index) => requireStructure(element, `${path}[${index}]`),
    );
}

function requireArray(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) throw new DiagramDocumentError('expected an array', path);
    return value;
}

function requireString(value: unknown, path: string): string {
    if (typeof value !== 'string') throw new DiagramDocumentError('expected a string', path);
    return value;
}

/**
 * Coerces rather than rejects. The set is closed in the types, which is where a
 * typo gets caught, but a persisted scheme can carry anything a JavaScript host
 * wrote before that -- and refusing to load it would brick the whole document
 * over a field whose every value except 'onConnect' behaves identically. The
 * type must still be a string, so a number or an object is a real error.
 */
function requirePortDynamicMode(value: unknown, path: string): PortDynamicMode {
    const mode = requireString(value, path);
    return toPortDynamicMode(mode);
}

function requireIdentifier(value: unknown, path: string): string {
    const id = requireString(value, path);
    if (id.trim().length === 0) throw new DiagramDocumentError('identifier cannot be empty', path);
    return id;
}

function requireNumber(value: unknown, path: string): number {
    if (typeof value !== 'number') throw new DiagramDocumentError('expected a number', path);
    return value;
}

function requireFiniteNumber(value: unknown, path: string): number {
    const number = requireNumber(value, path);
    if (!Number.isFinite(number)) throw new DiagramDocumentError('expected a finite number', path);
    return number;
}

function requireNullableFiniteNumber(value: unknown, path: string): number | null {
    return value === null ? null : requireFiniteNumber(value, path);
}

function requireNonNegativeInteger(value: unknown, path: string): number {
    const number = requireFiniteNumber(value, path);
    if (!Number.isInteger(number) || number < 0) throw new DiagramDocumentError('expected a non-negative integer', path);
    return number;
}

function requireBoolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') throw new DiagramDocumentError('expected a boolean', path);
    return value;
}
