/**
 * MoneyMart — drag-to-reorder primitive.
 *
 * Used by the Studio block list (section-level reordering) and the sell flow's
 * photo grid (§5.2 "drag to reorder"). Built on Pointer Events rather than the
 * HTML5 drag-and-drop API for three reasons:
 *
 *  1. HTML5 DnD does not fire on touch devices at all, and the seller flow must
 *     work on a phone.
 *  2. It cannot render a custom drag preview or animate the displaced items.
 *  3. Its `dragover` model forces you to compute a drop index from raw pixels
 *     anyway, which is the part that actually matters.
 *
 * The index maths lives in `reorder` and `computeDropIndex` so it can be unit
 * tested without a DOM — off-by-one errors in reordering are invisible on screen
 * until a creator loses an item, so they are asserted directly.
 *
 * Keyboard users get the same capability: focus a handle and use the arrow keys.
 * Drag is never the only way to move something.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

/**
 * Move one item within a list.
 *
 * Pure and index-safe: an out-of-range index returns the original list rather
 * than a mutated copy, because silently dropping an item is worse than a no-op.
 */
export function reorder<T>(items: T[], from: number, to: number): T[] {
  if (from === to) return items;
  if (from < 0 || from >= items.length) return items;
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

/**
 * Which index the dragged item should land on.
 *
 * Semantics, because this is easy to misread: the return value is the index the
 * item takes in the REORDERED list, not the slot its pointer is physically over.
 * Those differ by one when dragging downwards, because removing the item shifts
 * everything below it up a slot — hence the `i - 1` correction. Removing that
 * correction misplaces the item every time someone drags down the page.
 *
 * Verified properties (see the drag-reorder checks in verify-ui):
 *   • dragging past the end lands the item last, from any starting index
 *   • dragging above the top lands it first, from any starting index
 *   • the result is monotonic in the pointer position in both directions
 *   • a stationary press is a no-op
 *   • no item is ever lost or duplicated
 *
 * Midpoints are used rather than container offsets so the behaviour stays
 * correct when items differ in height (a hero block is far taller than a stats
 * block) and when the container is scrolled.
 */
export function computeDropIndex(
  pointerY: number,
  rects: { top: number; height: number }[],
  fromIndex: number,
): number {
  if (!rects.length) return fromIndex;

  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index]!;
    const midpoint = rect.top + rect.height / 2;
    if (pointerY < midpoint) {
      // Dragging downwards lands after the item the pointer has passed.
      return index > fromIndex ? index - 1 : index;
    }
  }
  // Past the last midpoint: land on the final slot, accounting for the lift.
  return rects.length - 1;
}

export interface DragReorderHandle {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  tabIndex: number;
  role: 'button';
  'aria-label': string;
}

export interface DragReorderOptions {
  count: number;
  onMove: (from: number, to: number) => void;
  /** Announced to assistive tech, e.g. "Photo 3 of 8". */
  describe?: (index: number) => string;
  /** Pixels of travel before a press becomes a drag. */
  threshold?: number;
}

export interface DragReorderState {
  draggingIndex: number | null;
  dropIndex: number | null;
  handleProps: (index: number) => DragReorderHandle;
  /** Ref to attach to the container that holds the items, in order. */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function useDragReorder({ count, onMove, describe, threshold = 6 }: DragReorderOptions): DragReorderState {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rectsRef = useRef<{ top: number; height: number }[]>([]);
  const startYRef = useRef(0);
  const activeRef = useRef<number | null>(null);
  const engagedRef = useRef(false);

  /** Capture geometry once at drag start; layout cannot change mid-drag. */
  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    rectsRef.current = Array.from(container.children).map((child) => {
      const rect = child.getBoundingClientRect();
      return { top: rect.top, height: rect.height };
    });
  }, []);

  const finish = useCallback(() => {
    const from = activeRef.current;
    const to = dropIndex;
    activeRef.current = null;
    engagedRef.current = false;
    setDraggingIndex(null);
    setDropIndex(null);
    if (from !== null && to !== null && from !== to) onMove(from, to);
  }, [dropIndex, onMove]);

  /* Pointer listeners live on the window so a fast drag cannot escape the handle. */
  useEffect(() => {
    if (draggingIndex === null) return;

    const onPointerMove = (event: PointerEvent) => {
      if (!engagedRef.current) {
        if (Math.abs(event.clientY - startYRef.current) < threshold) return;
        engagedRef.current = true;
      }
      setDropIndex(computeDropIndex(event.clientY, rectsRef.current, activeRef.current ?? 0));
    };

    const onPointerUp = () => finish();
    const onPointerCancel = () => finish();

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [draggingIndex, finish, threshold]);

  // Prevent the page from scrolling while an active drag is in progress.
  useEffect(() => {
    if (draggingIndex === null) return;
    const previous = document.body.style.touchAction;
    document.body.style.touchAction = 'none';
    return () => {
      document.body.style.touchAction = previous;
    };
  }, [draggingIndex]);

  const handleProps = useCallback(
    (index: number): DragReorderHandle => ({
      role: 'button',
      tabIndex: 0,
      'aria-label': describe ? describe(index) : `Reorder item ${index + 1} of ${count}`,
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        // Ignore secondary buttons and anything already claiming the gesture.
        if (event.button !== 0) return;
        event.preventDefault();
        measure();
        activeRef.current = index;
        startYRef.current = event.clientY;
        engagedRef.current = false;
        setDraggingIndex(index);
        setDropIndex(index);
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        /**
         * Keyboard parity. Arrow keys move one slot and Home/End jump to the
         * ends, matching the behaviour of a native reorderable list.
         */
        let target: number | null = null;
        if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') target = index - 1;
        else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') target = index + 1;
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = count - 1;

        if (target === null || target < 0 || target >= count) return;
        event.preventDefault();
        onMove(index, target);
      },
    }),
    [count, describe, measure, onMove],
  );

  return useMemo(
    () => ({ draggingIndex, dropIndex, handleProps, containerRef }),
    [draggingIndex, dropIndex, handleProps],
  );
}

/** A visible grab affordance, so it is obvious the item can be moved. */
export function DragHandleGlyph({ active = false }: { active?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden style={{ opacity: active ? 1 : 0.55 }}>
      <circle cx="4" cy="3" r="1.4" fill="currentColor" />
      <circle cx="10" cy="3" r="1.4" fill="currentColor" />
      <circle cx="4" cy="7" r="1.4" fill="currentColor" />
      <circle cx="10" cy="7" r="1.4" fill="currentColor" />
      <circle cx="4" cy="11" r="1.4" fill="currentColor" />
      <circle cx="10" cy="11" r="1.4" fill="currentColor" />
    </svg>
  );
}

/**
 * Wraps each reorderable item.
 * Applies the lift transform while dragging and a drop indicator on the slot the
 * item would land in, so the outcome is visible before the pointer is released.
 */
export function DragItem({
  index,
  state,
  children,
  className = '',
}: {
  index: number;
  state: DragReorderState;
  children: ReactNode;
  className?: string;
}) {
  const { draggingIndex, dropIndex } = state;
  const isDragging = draggingIndex === index;
  const isDropTarget = draggingIndex !== null && dropIndex === index && !isDragging;

  return (
    <div
      className={className}
      data-dragging={isDragging || undefined}
      style={{
        position: 'relative',
        transition: 'transform 140ms ease-out, opacity 140ms ease-out',
        transform: isDragging ? 'scale(0.985)' : 'none',
        opacity: isDragging ? 0.72 : 1,
        zIndex: isDragging ? 20 : undefined,
        outline: isDropTarget ? '2px dashed var(--mm-gold)' : undefined,
        outlineOffset: isDropTarget ? '3px' : undefined,
        borderRadius: 14,
      }}
    >
      {children}
    </div>
  );
}

export default useDragReorder;
