import { describe, expect, it, vi } from 'vitest';
import { Controller } from '../src/app/controller';
import { SONY_V2 } from '../src/protocol/profiles';
import { disconnectOnPageHide } from '../src/ui/lifecycle';
import { FakeChannel } from './fakeChannel';

describe('disconnectOnPageHide', () => {
  it('closes an open session when the page is hidden', async () => {
    const page = new EventTarget();
    const channel = new FakeChannel();
    const controller = new Controller();
    await controller.attach(channel, 'passive', SONY_V2);
    const report = vi.fn();
    disconnectOnPageHide(page, () => controller.disconnect(), report);

    page.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() => expect(controller.state.phase).toBe('idle'));
    expect(channel.closeCalls).toBe(1);
    expect(report).not.toHaveBeenCalled();
  });

  it('reports a cleanup failure instead of swallowing it', async () => {
    const page = new EventTarget();
    const report = vi.fn();
    disconnectOnPageHide(page, () => Promise.reject(new Error('close failed')), report);
    page.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith(new Error('close failed')));
  });
});
