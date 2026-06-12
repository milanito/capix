import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from './event-bus.js';

type TestEvents = {
  'task:updated': { id: string; status: string };
  'order:paid': { orderId: string; amount: number };
};

describe('createEventBus', () => {
  it('publish delivers to all subscribers of that event', () => {
    const bus = createEventBus<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.subscribe('client-1', 'task:updated', h1);
    bus.subscribe('client-2', 'task:updated', h2);
    bus.publish('task:updated', { id: '1', status: 'done' });

    expect(h1).toHaveBeenCalledWith({ id: '1', status: 'done' });
    expect(h2).toHaveBeenCalledWith({ id: '1', status: 'done' });
  });

  it('publish does not deliver to subscribers of other events', () => {
    const bus = createEventBus<TestEvents>();
    const h = vi.fn();

    bus.subscribe('client-1', 'order:paid', h);
    bus.publish('task:updated', { id: '1', status: 'done' });

    expect(h).not.toHaveBeenCalled();
  });

  it('subscribe returns an unsubscribe function that works', () => {
    const bus = createEventBus<TestEvents>();
    const h = vi.fn();

    const unsub = bus.subscribe('client-1', 'task:updated', h);
    unsub();
    bus.publish('task:updated', { id: '1', status: 'done' });

    expect(h).not.toHaveBeenCalled();
  });

  it('unsubscribeAll removes all listeners for a client', () => {
    const bus = createEventBus<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.subscribe('client-1', 'task:updated', h1);
    bus.subscribe('client-1', 'order:paid', h2);
    bus.unsubscribeAll('client-1');

    bus.publish('task:updated', { id: '1', status: 'done' });
    bus.publish('order:paid', { orderId: 'o1', amount: 99 });

    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it('unsubscribeAll does not affect other clients', () => {
    const bus = createEventBus<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.subscribe('client-1', 'task:updated', h1);
    bus.subscribe('client-2', 'task:updated', h2);
    bus.unsubscribeAll('client-1');

    bus.publish('task:updated', { id: '1', status: 'done' });

    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledWith({ id: '1', status: 'done' });
  });

  it('multiple clients can subscribe to the same event independently', () => {
    const bus = createEventBus<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();
    const h3 = vi.fn();

    bus.subscribe('c1', 'task:updated', h1);
    bus.subscribe('c2', 'task:updated', h2);
    bus.subscribe('c3', 'task:updated', h3);

    bus.unsubscribeAll('c2');
    bus.publish('task:updated', { id: '1', status: 'done' });

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).not.toHaveBeenCalled();
    expect(h3).toHaveBeenCalledOnce();
  });

  it('publish with no subscribers does nothing (no error)', () => {
    const bus = createEventBus<TestEvents>();
    expect(() => bus.publish('task:updated', { id: '1', status: 'done' })).not.toThrow();
  });

  it('subscribing again to the same event replaces the previous handler', () => {
    const bus = createEventBus<TestEvents>();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.subscribe('client-1', 'task:updated', h1);
    bus.subscribe('client-1', 'task:updated', h2);
    bus.publish('task:updated', { id: '1', status: 'done' });

    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('_getHandler returns the registered handler', () => {
    const bus = createEventBus<TestEvents>();
    const h = vi.fn();

    bus.subscribe('client-1', 'task:updated', h);
    const found = bus._getHandler('client-1', 'task:updated');
    expect(found).toBeDefined();
  });

  it('_getHandler returns undefined for unregistered client+event', () => {
    const bus = createEventBus<TestEvents>();
    expect(bus._getHandler('nobody', 'task:updated')).toBeUndefined();
  });

  it('TypeScript — publish and subscribe use consistent event payload types', () => {
    const bus = createEventBus<TestEvents>();
    // This test is primarily a compile-time check; at runtime it just runs.
    bus.subscribe('c1', 'order:paid', (data) => {
      const _: number = data.amount; // must compile — amount is number
      void _;
    });
    bus.publish('order:paid', { orderId: 'o1', amount: 100 });
  });

  // --- filter predicate ---

  it('filter: handler is called when predicate returns true', () => {
    const bus = createEventBus<TestEvents>();
    const h = vi.fn();
    bus.subscribe('c1', 'task:updated', h, { filter: (d) => d.status === 'done' });
    bus.publish('task:updated', { id: '1', status: 'done' });
    expect(h).toHaveBeenCalledWith({ id: '1', status: 'done' });
  });

  it('filter: handler is NOT called when predicate returns false', () => {
    const bus = createEventBus<TestEvents>();
    const h = vi.fn();
    bus.subscribe('c1', 'task:updated', h, { filter: (d) => d.status === 'done' });
    bus.publish('task:updated', { id: '1', status: 'pending' });
    expect(h).not.toHaveBeenCalled();
  });

  it('filter: only matching clients receive the event (privacy isolation)', () => {
    const bus = createEventBus<TestEvents>();
    const alice = vi.fn();
    const bob = vi.fn();
    bus.subscribe('alice', 'task:updated', alice, { filter: (d) => d.id === 'alice-task' });
    bus.subscribe('bob', 'task:updated', bob, { filter: (d) => d.id === 'bob-task' });
    bus.publish('task:updated', { id: 'alice-task', status: 'done' });
    expect(alice).toHaveBeenCalledOnce();
    expect(bob).not.toHaveBeenCalled();
  });

  it('filter: unfiltered subscribers still receive all events', () => {
    const bus = createEventBus<TestEvents>();
    const filtered = vi.fn();
    const unfiltered = vi.fn();
    bus.subscribe('c1', 'task:updated', filtered, { filter: (d) => d.status === 'done' });
    bus.subscribe('c2', 'task:updated', unfiltered);
    bus.publish('task:updated', { id: '1', status: 'pending' });
    expect(filtered).not.toHaveBeenCalled();
    expect(unfiltered).toHaveBeenCalledOnce();
  });

  // --- server-internal (2-arg) subscribe ---

  it('internal subscribe (no clientId) receives published events', () => {
    const bus = createEventBus<TestEvents>();
    const h = vi.fn();
    bus.subscribe('task:updated', h);
    bus.publish('task:updated', { id: '1', status: 'done' });
    expect(h).toHaveBeenCalledWith({ id: '1', status: 'done' });
  });

  it('internal subscribe is not removed by unsubscribeAll', () => {
    const bus = createEventBus<TestEvents>();
    const internal = vi.fn();
    const client = vi.fn();
    bus.subscribe('task:updated', internal);
    bus.subscribe('c1', 'task:updated', client);
    bus.unsubscribeAll('c1');
    bus.publish('task:updated', { id: '1', status: 'done' });
    expect(internal).toHaveBeenCalledOnce();
    expect(client).not.toHaveBeenCalled();
  });

  it('internal subscribe with filter only fires when predicate passes', () => {
    const bus = createEventBus<TestEvents>();
    const h = vi.fn();
    bus.subscribe('task:updated', h, { filter: (d) => d.status === 'done' });
    bus.publish('task:updated', { id: '1', status: 'pending' });
    bus.publish('task:updated', { id: '2', status: 'done' });
    expect(h).toHaveBeenCalledTimes(1);
    expect(h).toHaveBeenCalledWith({ id: '2', status: 'done' });
  });
});

describe('subscriber isolation', () => {
  it('a throwing subscriber does not block delivery to other subscribers', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bus = createEventBus<TestEvents>();
    const healthy = vi.fn();
    bus.subscribe('c1', 'task:updated', () => { throw new Error('subscriber boom'); });
    bus.subscribe('c2', 'task:updated', healthy);

    expect(() => bus.publish('task:updated', { id: '1', status: 'done' })).not.toThrow();
    expect(healthy).toHaveBeenCalledOnce();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('task:updated'), expect.any(Error));
    errSpy.mockRestore();
  });

  it('a throwing filter does not propagate to the publisher', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bus = createEventBus<TestEvents>();
    const after = vi.fn();
    bus.subscribe('c1', 'task:updated', vi.fn(), { filter: () => { throw new Error('filter boom'); } });
    bus.subscribe('c2', 'task:updated', after);

    expect(() => bus.publish('task:updated', { id: '1', status: 'done' })).not.toThrow();
    expect(after).toHaveBeenCalledOnce();
    errSpy.mockRestore();
  });
});
