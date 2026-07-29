import { EventEmitter } from './event-emitter.js';
import { Node, NodeInit, PortType, PortTypeInit } from './types.js';

export interface CatalogEvents {
    portTypesChanged: PortType[];
    nodeTypesChanged: Node[];
}

export class StockSharpCatalog extends EventEmitter<CatalogEvents> {
    private readonly portTypes = new Map<string, PortType>();
    private readonly nodeTypes = new Map<string, Node>();

    addPortType(portType: PortType | PortTypeInit): void {
        const pt = portType instanceof PortType ? portType : new PortType(portType);
        this.portTypes.set(pt.name, pt);
        this.emit('portTypesChanged', this.getPortTypes());
    }

    removePortType(name: string): void {
        this.portTypes.delete(name);
        this.emit('portTypesChanged', this.getPortTypes());
    }

    getPortType(name: string): PortType | null {
        return this.portTypes.get(name) ?? null;
    }

    getPortTypes(): PortType[] {
        return Array.from(this.portTypes.values());
    }

    // Keyed by lower-cased typeId: element GUIDs are case-insensitive,
    // but the seeded palette uses upper-case while desktop-schema imports
    // serialize lower-case. A case-sensitive Map.get would miss every
    // imported node ("Element type is missing from the palette"). Node.id
    // keeps its original casing so save/load round-trips unchanged.
    addNodeType(node: Node | NodeInit): void {
        // Copied on the way in as well as on the way out: otherwise the caller
        // keeps a handle on the stored definition and can edit it afterwards.
        // The clone covers the init branch too -- Node's constructor keeps the
        // caller's Port instances and parameters array as they are.
        const n = (node instanceof Node ? node : new Node(node)).clone();
        this.nodeTypes.set(n.id.toLowerCase(), n);
        this.emitNodeTypesChanged();
    }

    removeNodeType(id: string): void {
        this.nodeTypes.delete(id.toLowerCase());
        this.emitNodeTypesChanged();
    }

    getNodeType(id: string): Node | null {
        return this.nodeTypes.get(id.toLowerCase())?.clone() ?? null;
    }

    getNodeTypes(): Node[] {
        return Array.from(this.nodeTypes.values(), (node) => node.clone());
    }

    // Node definitions are mutable, so the payload has to be a copy of each one.
    // Building a catalog is a loop of addNodeType calls, which would make that
    // quadratic; skipping it while nobody listens keeps catalog construction --
    // where no subscriber exists yet -- as cheap as it was.
    private emitNodeTypesChanged(): void {
        if (this.hasHandlers('nodeTypesChanged')) this.emit('nodeTypesChanged', this.getNodeTypes());
    }
}
