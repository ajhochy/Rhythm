import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export type SplitterOrientation = 'horizontal' | 'vertical';
export type SplitterResizeEdge = 'start' | 'end';

export interface SplitterProps {
  orientation: SplitterOrientation;
  min: number;
  max: number;
  defaultSize: number;
  onResize?: (size: number) => void;
  ariaLabel?: string;
  resizeEdge?: SplitterResizeEdge;
  className?: string;
  testId?: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalize(minimum: number, maximum: number, initial: number) {
  const min = Math.max(0, Math.round(minimum));
  const max = Math.max(min, Math.round(maximum));
  return { min, max, initial: clamp(Math.round(initial), min, max) };
}

/** Host-neutral pane resizer. Size is deliberately transient; persistence belongs to the host. */
export function Splitter({ orientation, min, max, defaultSize, onResize, ariaLabel, resizeEdge = 'start', className = '', testId }: SplitterProps) {
  const bounds = normalize(min, max, defaultSize);
  const [preferredSize, setPreferredSize] = useState(bounds.initial);
  const [availableMax, setAvailableMax] = useState(bounds.max);
  const splitterRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const size = clamp(preferredSize, bounds.min, availableMax);

  useEffect(() => {
    setPreferredSize((current) => clamp(current, bounds.min, bounds.max));
  }, [bounds.max, bounds.min]);

  useLayoutEffect(() => {
    const parent = splitterRef.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      const available = orientation === 'vertical' ? parent.clientWidth : parent.clientHeight;
      setAvailableMax(available > 0
        ? Math.max(bounds.min, Math.min(bounds.max, Math.round(available - bounds.min - 8)))
        : bounds.max);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(parent);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [bounds.max, bounds.min, orientation]);

  useLayoutEffect(() => { onResize?.(size); }, [onResize, size]);
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const setSize = useCallback((next: number) => setPreferredSize(clamp(Math.round(next), bounds.min, availableMax)), [availableMax, bounds.min]);
  const reset = useCallback(() => setSize(bounds.initial), [bounds.initial, setSize]);

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
    const rtl = orientation === 'vertical' && document.documentElement.dir === 'rtl';
    let active = true;
    target.focus();
    target.setPointerCapture?.(pointerId);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize';
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      const point = orientation === 'vertical' ? pointer.clientX : pointer.clientY;
      let delta = point - startPoint;
      if (rtl) delta *= -1;
      if (resizeEdge === 'end') delta *= -1;
      setSize(startSize + delta);
    };
    const cleanup = () => {
      if (!active) return;
      active = false;
      for (const name of ['pointermove', 'pointerup', 'pointercancel', 'blur'] as const) window.removeEventListener(name, name === 'pointermove' ? move as EventListener : cleanup);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
      if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null;
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
    window.addEventListener('blur', cleanup);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const allowed = orientation === 'vertical' ? ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'] : ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'];
    if (!allowed.includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') return setSize(bounds.min);
    if (event.key === 'End') return setSize(availableMax);
    if (event.key === 'Enter') return reset();
    let direction = orientation === 'vertical' ? (event.key === 'ArrowRight' ? 1 : -1) : (event.key === 'ArrowDown' ? 1 : -1);
    if (orientation === 'vertical' && document.documentElement.dir === 'rtl') direction *= -1;
    if (resizeEdge === 'end') direction *= -1;
    setSize(size + direction * (event.shiftKey ? 64 : 16));
  };

  return <div
    ref={splitterRef}
    className={`splitter splitter-${orientation}${className ? ` ${className}` : ''}`}
    role="separator"
    aria-label={ariaLabel ?? 'Resize panes'}
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
    data-testid={testId}
  />;
}
