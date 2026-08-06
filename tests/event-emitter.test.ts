import assert from 'node:assert/strict';
import test from 'node:test';

import { EventEmitter } from '../src/diagram/event-emitter';

/** Hard stop for the resubscribe case: an unbounded loop would hang the runner instead of failing. */
const LOOP_CAP = 50;

/** Test double that opens the protected members of EventEmitter for direct exercise. */
class ProbeEmitter extends EventEmitter<{ ping: number }> {
    fire(payload: number): void {
        this.emit('ping', payload);
    }
    dropAll(): void {
        this.clearEventHandlers();
    }
}

test('emit iterates a snapshot, so handler changes during delivery do not affect it', async (t) => {
    await t.test('a handler subscribed from inside emit does not get the in-flight event', () => {
        const emitter = new ProbeEmitter();
        const lateCalls: number[] = [];
        const late = (payload: number): void => { lateCalls.push(payload); };
        let subscribed = false;
        emitter.on('ping', () => {
            if (subscribed) return;
            subscribed = true;
            emitter.on('ping', late);
        });

        emitter.fire(1);
        assert.deepEqual(
            lateCalls,
            [],
            'a handler subscribed from inside emit received the event that was already in flight'
            + ` (payloads seen: ${JSON.stringify(lateCalls)}); a snapshot taken before delivery would not reach it`,
        );

        // It must still be a real subscription for the next event -- otherwise the fix would be
        // "swallow the subscription", which is a different bug.
        emitter.fire(2);
        assert.deepEqual(
            lateCalls,
            [2],
            `the late handler must receive the next event and only that one, got ${JSON.stringify(lateCalls)}`,
        );
    });

    await t.test('the off()+on() resubscribe pattern terminates with two subscribers', () => {
        const emitter = new ProbeEmitter();
        let calls = 0;
        let capHit = false;
        const resubscribe = (handler: (payload: number) => void): void => {
            calls += 1;
            if (calls > LOOP_CAP) {
                // Stop feeding the iteration; without this the loop never ends and the runner hangs.
                capHit = true;
                return;
            }
            emitter.off('ping', handler);
            emitter.on('ping', handler);
        };
        const first = (): void => { resubscribe(first); };
        const second = (): void => { resubscribe(second); };
        emitter.on('ping', first);
        emitter.on('ping', second);

        emitter.fire(3);
        assert.equal(
            capHit,
            false,
            `the off()+on() resubscribe pattern never terminated: delivery of one event was still running`
            + ` after ${LOOP_CAP} handler calls, so a host that throttles by resubscribing hangs the page`,
        );
        assert.equal(
            calls,
            2,
            `each of the two resubscribing handlers must run once per emit, got ${calls} calls`,
        );
    });

    await t.test('clearEventHandlers() from inside emit stops delivery to the handlers behind it', () => {
        const emitter = new ProbeEmitter();
        let survivorCalls = 0;
        emitter.on('ping', () => { emitter.dropAll(); });
        emitter.on('ping', () => { survivorCalls += 1; });

        emitter.fire(4);
        assert.equal(
            survivorCalls,
            0,
            'clearEventHandlers() called from inside emit did not stop delivery: the handler behind it'
            + ` still ran (${survivorCalls} call(s)), so a destroy() mid-event reaches a torn-down host`,
        );
    });
});
