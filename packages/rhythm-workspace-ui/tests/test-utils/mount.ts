import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

export interface Mounted {
  container: HTMLDivElement;
  byTestId(testId: string): HTMLElement | null;
  allByTestId(testId: string): HTMLElement[];
  byRole(role: string): HTMLElement | null;
  rerender(element: ReactElement): void;
  unmount(): void;
}

// A deliberately dependency-free mount helper: @testing-library/react pins internal
// react-dom/test-utils access patterns that vary across React majors. Talking to
// react-dom/client + react's own `act` directly keeps this harness correct against
// both React majors this package supports (see scripts/react19-matrix.mjs, which runs
// this same suite against an isolated React 19 install) instead of trusting a third
// library's own cross-version support.
export function mount(element: ReactElement): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return {
    container,
    byTestId: (testId) => container.querySelector<HTMLElement>(`[data-testid="${testId}"]`),
    allByTestId: (testId) => [...container.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)],
    byRole: (role) => container.querySelector<HTMLElement>(`[role="${role}"]`) ?? container.querySelector<HTMLElement>(role),
    rerender(element) { act(() => root.render(element)); },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Flushes pending microtasks (gateway promises resolving, effects scheduling state updates)
 * inside `act`, so React never warns about updates happening outside of it. The 20ms delay
 * (not 0) also covers effects that defer their own work one animation frame past commit
 * (e.g. TaskMenu's roving-focus effect) — jsdom's requestAnimationFrame polyfill doesn't
 * fire on a bare setTimeout(0) macrotask. */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

export async function actClick(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
  });
}

/** Sets a controlled input/textarea/select's value and fires input+change, wrapped in
 * `act`. Two gotchas this works around:
 * 1. Dispatching the native event outside `act` leaves React's state update unflushed
 *    until some later, unrelated `act` call happens to catch it.
 * 2. For <input>/<textarea> (not <select>), ReactDOM installs a per-node "value tracker"
 *    used to detect real vs. redundant changes; assigning `element.value = x` directly
 *    goes through that same wrapped setter, so the tracker already "sees" the new value
 *    before the input event fires and treats it as unchanged — onChange never runs. Going
 *    through the un-wrapped prototype setter (the same trick Testing Library's fireEvent
 *    uses) makes the tracker correctly observe a real change. */
export async function actSetValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

export async function actKeyDown(element: HTMLElement | Document, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}
