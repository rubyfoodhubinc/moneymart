/**
 * MoneyMart TV — D-pad spatial navigation engine (§7.2).
 *
 * The blueprint is unambiguous: "D-pad navigation only — no touch input assumed;
 * all interactive elements navigable via Up / Down / Left / Right / Select / Back
 * / Home keys."
 *
 * Spatial navigation is not CSS tab order: on a TV the next focus target is
 * whichever registered element lies geometrically nearest in the pressed
 * direction, weighted so that alignment in the cross axis beats raw distance.
 * That is what makes row/column layouts feel correct under a remote.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface FocusableEntry {
  id: string;
  element: HTMLElement;
  /** Higher priority wins when two candidates are geometrically similar. */
  priority?: number;
  /** Elements only become eligible when their group is active. */
  group?: string;
  onSelect?: () => void;
  onFocus?: () => void;
}

interface FocusContextValue {
  activeId: string | null;
  activeGroup: string | null;
  setActiveGroup: (group: string | null) => void;
  register: (entry: FocusableEntry) => void;
  unregister: (id: string) => void;
  focus: (id: string) => void;
  move: (direction: Direction) => boolean;
  select: () => void;
  focusFirst: (group?: string) => void;
}

const FocusContext = createContext<FocusContextValue | null>(null);

/** Key codes across Tizen, webOS, HbbTV and Android TV remotes. */
const KEY_MAP: Record<string, Direction | 'select' | 'back'> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'select',
  ' ': 'select',
  // Tizen / webOS / generic TV remote codes
  '37': 'left',
  '38': 'up',
  '39': 'right',
  '40': 'down',
  '13': 'select',
  '461': 'back', // webOS back
  '10009': 'back', // Tizen back
  GoBack: 'back',
  Backspace: 'back',
  Escape: 'back',
};

/** Horizontal bias: TV rows are read left-to-right, so favour sideways travel. */
const AXIS_WEIGHT = { primary: 1, cross: 3.2 };
/** Ignore candidates that are almost directly behind the pressed direction. */
const MIN_PROGRESS = 4;

function rectOf(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    cx: rect.left + rect.width / 2,
    cy: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height,
  };
}

type Rect = ReturnType<typeof rectOf>;

/**
 * Score a candidate in a given direction. Lower is better.
 * `primary` is distance along the pressed axis; `cross` is misalignment on the
 * other axis — heavily penalised so D-pad travel stays predictable.
 */
function score(from: Rect, to: Rect, direction: Direction): number | null {
  let primary: number;
  let cross: number;

  switch (direction) {
    case 'right':
      if (to.cx <= from.cx) return null;
      primary = to.left - from.right;
      cross = Math.abs(to.cy - from.cy);
      break;
    case 'left':
      if (to.cx >= from.cx) return null;
      primary = from.left - to.right;
      cross = Math.abs(to.cy - from.cy);
      break;
    case 'down':
      if (to.cy <= from.cy) return null;
      primary = to.top - from.bottom;
      cross = Math.abs(to.cx - from.cx);
      break;
    case 'up':
    default:
      if (to.cy >= from.cy) return null;
      primary = from.top - to.bottom;
      cross = Math.abs(to.cx - from.cx);
      break;
  }

  const forward = Math.max(0, primary);
  if (forward < -MIN_PROGRESS) return null;

  // Overlapping ranges make a candidate feel "in line"; reward that explicitly.
  const overlaps =
    direction === 'left' || direction === 'right'
      ? to.top < from.bottom && to.bottom > from.top
      : to.left < from.right && to.right > from.left;

  return forward * AXIS_WEIGHT.primary + (overlaps ? 0 : cross * AXIS_WEIGHT.cross);
}

export function FocusProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, FocusableEntry>());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeGroup, setActiveGroupState] = useState<string | null>(null);
  const activeGroupRef = useRef<string | null>(null);

  const eligible = useCallback(() => {
    const group = activeGroupRef.current;
    return [...entries.current.values()].filter((entry) => {
      if (!entry.element.isConnected) return false;
      if (entry.element.offsetParent === null && entry.element.tagName !== 'BODY') {
        // Not rendered (display:none / collapsed row)
        if (entry.element.getClientRects().length === 0) return false;
      }
      if (group && entry.group && entry.group !== group) return false;
      return true;
    });
  }, []);

  const focus = useCallback((id: string) => {
    const entry = entries.current.get(id);
    if (!entry) return;
    setActiveId(id);
    entry.element.focus({ preventScroll: false });
    entry.element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    entry.onFocus?.();
  }, []);

  const focusFirst = useCallback(
    (group?: string) => {
      const candidates = eligible()
        .slice()
        .sort((a, b) => {
          const ra = rectOf(a.element);
          const rb = rectOf(b.element);
          return ra.top - rb.top || ra.left - rb.left;
        });
      const target = (group ? candidates.find((entry) => entry.group === group) : candidates[0]) ?? candidates[0];
      if (target) focus(target.id);
    },
    [eligible, focus],
  );

  const move = useCallback(
    (direction: Direction) => {
      const candidates = eligible();
      if (!candidates.length) return false;

      const current = activeId ? entries.current.get(activeId) : undefined;
      if (!current || !current.element.isConnected) {
        focusFirst(activeGroupRef.current ?? undefined);
        return true;
      }

      const from = rectOf(current.element);
      let best: { id: string; score: number } | null = null;

      for (const candidate of candidates) {
        if (candidate.id === current.id) continue;
        const value = score(from, rectOf(candidate.element), direction);
        if (value === null) continue;
        const weighted = value - (candidate.priority ?? 0);
        if (!best || weighted < best.score) best = { id: candidate.id, score: weighted };
      }

      if (!best) return false;
      focus(best.id);
      return true;
    },
    [activeId, eligible, focus, focusFirst],
  );

  const select = useCallback(() => {
    if (!activeId) return;
    entries.current.get(activeId)?.onSelect?.();
  }, [activeId]);

  const register = useCallback((entry: FocusableEntry) => {
    entries.current.set(entry.id, entry);
    // First element to appear becomes focus, so a screen is never unfocused.
    setActiveId((current) => current ?? entry.id);
  }, []);

  const unregister = useCallback((id: string) => {
    entries.current.delete(id);
    setActiveId((current) => (current === id ? null : current));
  }, []);

  const setActiveGroup = useCallback(
    (group: string | null) => {
      activeGroupRef.current = group;
      setActiveGroupState(group);
    },
    [],
  );

  // Global key handling — one listener for the whole app.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mapped = KEY_MAP[event.key] ?? KEY_MAP[String(event.keyCode)];
      if (!mapped) return;
      // Let form fields own their own keys.
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && mapped !== 'back') return;

      if (mapped === 'select') {
        event.preventDefault();
        select();
        return;
      }
      if (mapped === 'back') {
        event.preventDefault();
        window.history.back();
        return;
      }
      event.preventDefault();
      move(mapped);
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [move, select]);

  // Keep the focused element in view and scrolled when content loads.
  useEffect(() => {
    if (!activeId) return;
    const entry = entries.current.get(activeId);
    entry?.element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeId]);

  const value = useMemo<FocusContextValue>(
    () => ({
      activeId,
      activeGroup,
      setActiveGroup,
      register,
      unregister,
      focus,
      move,
      select,
      focusFirst,
    }),
    [activeId, activeGroup, setActiveGroup, register, unregister, focus, move, select, focusFirst],
  );

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

export function useFocus() {
  const context = useContext(FocusContext);
  if (!context) throw new Error('useFocus must be used inside FocusProvider');
  return context;
}

/**
 * Make an element D-pad focusable.
 * Returns the ref to attach and whether it currently holds focus.
 */
export function useFocusable(options: {
  id: string;
  group?: string;
  priority?: number;
  onSelect?: () => void;
  onFocus?: () => void;
}) {
  const { id, group, priority, onSelect, onFocus } = options;
  const ref = useRef<HTMLElement | null>(null);
  const { register, unregister, activeId } = useFocus();

  // Keep the latest callbacks without re-registering on every render.
  const handlers = useRef({ onSelect, onFocus });
  handlers.current = { onSelect, onFocus };

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    register({
      id,
      element,
      group,
      priority,
      onSelect: () => handlers.current.onSelect?.(),
      onFocus: () => handlers.current.onFocus?.(),
    });
    return () => unregister(id);
  }, [id, group, priority, register, unregister]);

  const focused = activeId === id;

  return {
    ref: ref as React.RefObject<never>,
    focused,
    /** §7.2: focus state is a 4px gold border with a subtle highlight. */
    focusProps: {
      tabIndex: focused ? 0 : -1,
      'aria-selected': focused,
      style: focused
        ? {
            outline: '4px solid var(--mm-gold)',
            outlineOffset: '2px',
            background: 'rgba(245, 166, 35, 0.12)',
          }
        : undefined,
    },
  };
}

/** TV screen padding — 5% overscan-safe margins are standard on TVs. */
export const OVERSCAN = '3.5rem';
