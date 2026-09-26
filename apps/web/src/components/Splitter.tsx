import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import './Splitter.css';

type SplitterOrientation = 'horizontal' | 'vertical';
type ResizeEdge = 'start' | 'end';

type SplitterBounds = {
  min: number;
  max: number;
  default: number;
};

type SplitterChange = {
  key: string;
  size?: number;
};

const SPLITTER_CHANGE_EVENT = 'rhythm:splitter-size-change';
const STORAGE_PREFIX = 'layout.';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizedBounds(bounds: SplitterBounds) {
  const min = Math.max(0, Math.round(bounds.min));
  const max = Math.max(min, Math.round(bounds.max));
  const defaultSize = clamp(Math.round(bounds.default), min, max);
  return { min, max, defaultSize };
}

function readStoredSize(storageKey: string, bounds: SplitterBounds) {
  const { min, max, defaultSize } = normalizedBounds(bounds);
  if (typeof window === 'undefined') return defaultSize;
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === null) return defaultSize;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? clamp(Math.round(parsed), min, max) : defaultSize;
  } catch {
    return defaultSize;
  }
}

function announceSplitterChange(detail: SplitterChange) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<SplitterChange>(SPLITTER_CHANGE_EVENT, { detail }));
}

/** Persisted preferred pane size shared by every layout that uses Splitter. */
export function useSplitterSize(storageKey: string, bounds: SplitterBounds) {
  const { min, max, defaultSize } = normalizedBounds(bounds);
  const [size, setSizeState] = useState(() => readStoredSize(storageKey, bounds));
  const sizeRef = useRef(size);

  const setSize = useCallback((next: SetStateAction<number>) => {
    const resolved = clamp(Math.round(typeof next === 'function' ? next(sizeRef.current) : next), min, max);
    sizeRef.current = resolved;
    setSizeState(resolved);
    try { window.localStorage.setItem(storageKey, String(resolved)); } catch { /* Layout persistence is best effort. */ }
    announceSplitterChange({ key: storageKey, size: resolved });
  }, [max, min, storageKey]);

  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<SplitterChange>).detail;
      if (detail.key !== storageKey && detail.key !== '*') return;
      const next = detail.key === '*' ? defaultSize : readStoredSize(storageKey, { min, max, default: defaultSize });
      sizeRef.current = next;
      setSizeState(next);
    };
    const syncStorage = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      const next = readStoredSize(storageKey, { min, max, default: defaultSize });
      sizeRef.current = next;
      setSizeState(next);
    };
    window.addEventListener(SPLITTER_CHANGE_EVENT, sync);
    window.addEventListener('storage', syncStorage);
    return () => {
      window.removeEventListener(SPLITTER_CHANGE_EVENT, sync);
      window.removeEventListener('storage', syncStorage);
    };
  }, [defaultSize, max, min, storageKey]);

  useEffect(() => {
    const bounded = clamp(sizeRef.current, min, max);
    if (bounded !== sizeRef.current) setSize(bounded);
  }, [max, min, setSize]);

  return [size, setSize] as const;
}

/** Remove every layout.* preference and notify mounted splitters immediately. */
export function resetSplitterSizes() {
  if (typeof window === 'undefined') return 0;
  let removed = 0;
  try {
    const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(STORAGE_PREFIX)));
    for (const key of keys) {
      window.localStorage.removeItem(key);
      removed += 1;
    }
  } catch { /* Mounted splitters still reset even when storage is unavailable. */ }
  announceSplitterChange({ key: '*' });
  return removed;
}

export function Splitter({
  orientation,
  storageKey,
  min,
  max,
  defaultSize,
  onResize,
  ariaLabel,
  resizeEdge = 'start',
  className = '',
  testId,
}: {
  orientation: SplitterOrientation;
  storageKey: string;
  min: number;
  max: number;
  defaultSize: number;
  onResize?: (size: number) => void;
  ariaLabel?: string;
  resizeEdge?: ResizeEdge;
  className?: string;
  testId?: string;
}) {
  const bounds = normalizedBounds({ min, max, default: defaultSize });
  const [preferredSize, setPreferredSize] = useSplitterSize(storageKey, { min: bounds.min, max: bounds.max, default: bounds.defaultSize });
  const [availableMax, setAvailableMax] = useState(bounds.max);
  const splitterRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const size = clamp(preferredSize, bounds.min, availableMax);

  useLayoutEffect(() => {
    const parent = splitterRef.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      const available = orientation === 'vertical' ? parent.clientWidth : parent.clientHeight;
      const next = available > 0
        ? Math.max(bounds.min, Math.min(bounds.max, available - bounds.min - 8))
        : bounds.max;
      setAvailableMax(Math.round(next));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(parent);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [bounds.max, bounds.min, orientation]);

  useLayoutEffect(() => {
    onResize?.(size);
    const frame = window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return () => window.cancelAnimationFrame(frame);
  }, [onResize, size]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const reset = useCallback(() => setPreferredSize(bounds.defaultSize), [bounds.defaultSize, setPreferredSize]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragCleanupRef.current?.();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startPoint = orientation === 'vertical' ? event.clientX : event.clientY;
    const startSize = size;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    const cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize';
    const rtl = orientation === 'vertical' && document.documentElement.dir === 'rtl';
    let active = true;

    target.focus();
    target.setPointerCapture(pointerId);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = cursor;

    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      const point = orientation === 'vertical' ? pointer.clientX : pointer.clientY;
      let delta = point - startPoint;
      if (rtl) delta *= -1;
      if (resizeEdge === 'end') delta *= -1;
      setPreferredSize(clamp(startSize + delta, bounds.min, availableMax));
    };
    const cleanup = () => {
      if (!active) return;
      active = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      window.removeEventListener('blur', cleanup);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null;
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
    window.addEventListener('blur', cleanup);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const allowed = orientation === 'vertical'
      ? ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter']
      : ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'];
    if (!allowed.includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') { setPreferredSize(bounds.min); return; }
    if (event.key === 'End') { setPreferredSize(availableMax); return; }
    if (event.key === 'Enter') { reset(); return; }

    const step = event.shiftKey ? 64 : 16;
    let direction: number;
    if (orientation === 'vertical') {
      direction = event.key === 'ArrowRight' ? 1 : -1;
      if (document.documentElement.dir === 'rtl') direction *= -1;
    } else {
      direction = event.key === 'ArrowDown' ? 1 : -1;
    }
    if (resizeEdge === 'end') direction *= -1;
    setPreferredSize(clamp(size + direction * step, bounds.min, availableMax));
  };

  const label = ariaLabel ?? `Resize ${storageKey.replace(/^layout\./, '').replace(/[._-]+/g, ' ')}`;
  return (
    <div
      ref={splitterRef}
      className={`splitter splitter-${orientation}${className ? ` ${className}` : ''}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={bounds.min}
      aria-valuemax={availableMax}
      aria-valuenow={size}
      aria-valuetext={`${size} pixels`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerCancel={() => dragCleanupRef.current?.()}
      onLostPointerCapture={() => dragCleanupRef.current?.()}
      onBlur={() => dragCleanupRef.current?.()}
      onKeyDown={onKeyDown}
      onDoubleClick={reset}
      data-storage-key={storageKey}
      data-testid={testId}
    />
  );
}
