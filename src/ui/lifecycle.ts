// Page lifecycle. `pagehide` fires on tab close, reload and navigation (and on
// entering the back/forward cache), unlike `unload`, which is unreliable.
// Chrome also releases the port when the document is destroyed; this makes the
// shutdown explicit: stop transactions, cancel the read loop, release locks, close.

export function disconnectOnPageHide(
  target: Pick<EventTarget, 'addEventListener'>,
  disconnect: () => Promise<void>,
  report: (error: unknown) => void,
): void {
  target.addEventListener('pagehide', () => {
    disconnect().catch(report);
  });
}
