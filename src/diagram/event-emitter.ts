export type EventHandler<T> = (payload: T) => void;

// TEvents is constrained to object rather than Record<string, unknown>: the
// latter forces every event map to carry a string index signature, which
// collapses keyof TEvents to string and lets any misspelled name compile.
export class EventEmitter<TEvents extends object> {
    private readonly handlers = new Map<keyof TEvents, Set<EventHandler<unknown>>>();

    on<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): () => void {
        let set = this.handlers.get(event);
        if (set === undefined) {
            set = new Set();
            this.handlers.set(event, set);
        }
        set.add(handler as EventHandler<unknown>);
        return () => this.off(event, handler);
    }

    off<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void {
        const set = this.handlers.get(event);
        if (set === undefined) {
            return;
        }
        set.delete(handler as EventHandler<unknown>);
        if (set.size === 0) {
            this.handlers.delete(event);
        }
    }

    protected emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
        const set = this.handlers.get(event);
        if (set === undefined) {
            return;
        }
        for (const handler of set) {
            try {
                (handler as EventHandler<TEvents[K]>)(payload);
            } catch (err) {
                console.error(err);
            }
        }
    }

    /**
     * Whether anyone is listening. Lets a subject skip building a payload that
     * is expensive to produce and that nothing would read.
     */
    protected hasHandlers<K extends keyof TEvents>(event: K): boolean {
        return (this.handlers.get(event)?.size ?? 0) > 0;
    }

    protected clearEventHandlers(): void {
        this.handlers.clear();
    }
}
