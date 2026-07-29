export interface DiagramAction<TId extends string, TContext> {
    readonly id: TId;
    canExecute(context: TContext): boolean;
    execute(context: TContext): void;
}

export interface DiagramActionState<TId extends string> {
    id: TId;
    enabled: boolean;
}

export class DiagramActionRegistry<TId extends string, TContext> {
    private readonly actions = new Map<TId, DiagramAction<TId, TContext>>();

    register(action: DiagramAction<TId, TContext>): () => void {
        if (this.actions.has(action.id)) {
            throw new Error(`Diagram action "${action.id}" is already registered.`);
        }
        this.actions.set(action.id, action);
        return () => {
            if (this.actions.get(action.id) === action) this.actions.delete(action.id);
        };
    }

    /**
     * Registers one action per id from a table keyed by TId, in key order.
     * Because the table is a total Record, adding a member to TId without adding
     * its action stops compiling instead of producing a command that silently
     * does nothing.
     */
    registerAll(actions: Record<TId, Omit<DiagramAction<TId, TContext>, 'id'>>): () => void {
        // Object.keys is typed string[] because a value can carry keys beyond the
        // ones its type names. This parameter is a total Record over TId, so its
        // keys are exactly TId.
        const ids = Object.keys(actions) as TId[];
        // Delegating rather than spreading: a spread would copy own fields and
        // drop the prototype, so a class-based action would register cleanly and
        // then throw on its first call.
        const disposers = ids.map((id) => {
            const action = actions[id];
            return this.register({
                id,
                canExecute: (context) => action.canExecute(context),
                execute: (context) => action.execute(context),
            });
        });
        return () => disposers.forEach((dispose) => dispose());
    }

    get(id: TId): DiagramAction<TId, TContext> | null {
        return this.actions.get(id) ?? null;
    }

    states(context: TContext): DiagramActionState<TId>[] {
        return [...this.actions.values()].map((action) => ({
            id: action.id,
            enabled: action.canExecute(context),
        }));
    }

    canExecute(id: TId, context: TContext): boolean {
        return this.actions.get(id)?.canExecute(context) ?? false;
    }

    execute(id: TId, context: TContext): boolean {
        const action = this.actions.get(id);
        if (action === undefined || !action.canExecute(context)) return false;
        action.execute(context);
        return true;
    }
}
