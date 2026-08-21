import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

export interface Mounted {
  container: HTMLDivElement;
  byTestId(testId: string): HTMLElement | null;
  allByTestId(testId: string): HTMLElement[];
  byRole(role: string): HTMLElement | null;
  unmount(): void;
}

// A deliberately dependency-free mount helper: @testing-library/react pins internal
// react-dom/test-utils access patterns that vary across React majors. Talking to
// react-dom/client + react's own `act` directly keeps this harness correct against
// BOTH aliased runtimes (see vitest.react19.config.ts) instead of trusting a third
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
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Flushes pending microtasks (gateway promises resolving, effects scheduling state updates)
 * inside `act`, so React never warns about updates happening outside of it. */
export async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export async function actClick(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
  });
}
