/**
 * Stores a key that JSON can legitimately carry but plain assignment cannot hold.
 *
 * `JSON.parse` produces `__proto__` as an ordinary own key, yet writing it back
 * with `target[key] = value` hits the inherited `__proto__` setter: the value is
 * dropped and the object's prototype is replaced instead. A document parsed that
 * way loses data and stops satisfying the parser's own "plain object" guard, so
 * anything the parser accepted could no longer be serialized or cloned.
 */
export function setJsonKey<T>(target: Record<string, T>, key: string, value: T): void {
    if (key === '__proto__') {
        Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
        return;
    }
    target[key] = value;
}
