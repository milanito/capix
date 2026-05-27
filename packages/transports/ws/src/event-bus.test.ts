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
});
