import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  drag,
  easeCubicInOut,
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  select,
  zoom,
  zoomIdentity,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
  type ZoomBehavior,
} from 'd3';
import { Graph, layout } from '@dagrejs/dagre';
import {
  ARCH_EDGES,
  ARCH_HOW_ABOUT,
  ARCH_NODES,
  type ArchContext,
  type ArchEdge,
  type ArchNode,
  type ArchStep,
} from './architecture';
import { GlassSelect } from './GlassSelect';
import { demoDispatch, demoListen, type DemoArchInspect } from './guided-demo-bus';

/** Square-ish card; edges snap to the box rim. */
const NODE_W = 148;
const NODE_H = 108;
const NODE_HW = NODE_W / 2;
const NODE_HH = NODE_H / 2;
const NODE_RX = 12;
const NODE_GAP = 36;
const LOG_W = 320;
const MINI_LOG_COUNT = 3;
/** Scales node spacing (edge length). 1 = default; lower = shorter edges. */
const EDGE_LEN_MIN = 0.5;
const EDGE_LEN_MAX = 2.2;
const EDGE_LEN_STEP = 0.1;
const EDGE_LEN_DEFAULT = 1.15;
/** Playback rate: 1 = normal, lower = slower, higher = faster. */
const PLAY_RATE_DEFAULT = 1;
const PLAY_EDGE_MS = 1100;
const PLAY_HOLD_MS = 450;
const PLAY_RATE_OPTIONS = [
  { value: '0.5', label: '0.5×' },
  { value: '0.75', label: '0.75×' },
  { value: '1', label: '1×' },
  { value: '1.25', label: '1.25×' },
  { value: '1.5', label: '1.5×' },
  { value: '2', label: '2×' },
];

type LayoutId = 'auto' | 'force' | 'down' | 'across' | 'contexts';
type Point = { x: number; y: number };
type NodeLogEntry = {
  key: string;
  at: string;
  kind: string;
  element: string;
  log: string;
  /** Relative to the node this entry is hung on. */
  dir: 'input' | 'output';
  /** Peer title on the other end of the hop. */
  peer: string;
  /** Travel path for the detail panel. */
  fromTitle: string;
  toTitle: string;
  how: string;
  message: string;
  service: string;
  toUser: boolean;
  /** Compact label for the on-node strip (element only). */
  label: string;
  /** One-line body for the on-node strip. */
  brief: string;
};

type MapApi = {
  apply: (id: LayoutId, animate: boolean, length?: number, remesh?: boolean) => void;
  travel: (edgeId: string, duration: number) => Promise<void>;
  /** Interrupt in-flight packets and clear sending state. */
  haltTravel: () => void;
  setNodeLogs: (
    bags: Map<string, NodeLogEntry[]>,
    expandedId: string | null,
    playingKey?: string | null,
  ) => void;
  /** Dim / inactive under live nodes and edges (SVG paint order). */
  orderDepth: (liveNodes: Set<string>, liveEdges: Set<string>) => void;
  /** Multiply current zoom (guided tour). */
  zoomBy: (factor: number) => void;
};

const LAYOUTS: { id: LayoutId; label: string }[] = [
  { id: 'auto', label: 'Mesh' },
  { id: 'force', label: 'Force' },
  { id: 'down', label: 'Down' },
  { id: 'across', label: 'Across' },
  { id: 'contexts', label: 'By context' },
];

/** Preferred angle / radius for each bounded context in Mesh + Force seeds. */
const CONTEXT_SLOT: Record<ArchContext, { angle: number; radius: number }> = {
  Screen: { angle: -Math.PI * 0.92, radius: 210 },
  Employee: { angle: -Math.PI * 0.55, radius: 250 },
  Insurance: { angle: 0, radius: 40 },
  Carrier: { angle: Math.PI * 0.45, radius: 280 },
  Payroll: { angle: Math.PI * 0.9, radius: 250 },
};

type ForceNode = SimulationNodeDatum & { id: string };
type ForceLink = SimulationLinkDatum<ForceNode> & { id: string };

const CONTEXTS: ArchContext[] = ['Screen', 'Employee', 'Insurance', 'Carrier', 'Payroll'];

const HOW_LABEL: Record<string, string> = {
  http: 'http',
  direct: 'direct',
  async: 'async',
  bus: 'bus',
};

function IconPlay({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M8 5.14v13.72L19 12 8 5.14z" />
    </svg>
  );
}

function IconPause({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  );
}

function IconReset({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"
      />
    </svg>
  );
}

type Transport = 'idle' | 'playing' | 'paused';

const SIDE_W_MIN = 260;
const SIDE_W_MAX = 520;
const SIDE_W_DEFAULT = 320;

type Inspect =
  | { kind: 'node'; node: ArchNode }
  | { kind: 'edge'; edge: ArchEdge };

function nodeTitle(id: string): string {
  return ARCH_NODES.find((node) => node.id === id)?.title ?? id;
}

function describeEdge(edge: ArchEdge): string {
  if (edge.about) return edge.about;
  const from = nodeTitle(edge.from);
  const to = nodeTitle(edge.to);
  const query = edge.query ? ' Read-only query — it does not move the Enrolment FSM.' : '';
  return `${from} → ${to}. Message: “${edge.label}”. ${ARCH_HOW_ABOUT[edge.how]}${query}`;
}

/** Forward-only edges used by dagre (Down) to avoid cycle scramble. */
const LAYOUT_EDGE_IDS = new Set([
  'e-command',
  'e-pending',
  'e-handoff',
  'e-idem',
  'e-audit',
  'e-poll',
  'e-member',
  'e-alan',
  'e-axa',
  'e-domain',
  'e-publish',
  'e-bus',
  'e-observe',
  'e-lines',
  'e-fail',
  'e-left',
]);

/** Context-aware seed so Mesh / Force settle into readable clusters, not a random ring. */
function forceSeedCenters(length = 1): Map<string, Point> {
  const L = Math.max(EDGE_LEN_MIN, Math.min(EDGE_LEN_MAX, length));
  const centers = new Map<string, Point>();
  const origin = { x: 420, y: 340 };
  const byContext = new Map<ArchContext, ArchNode[]>();
  for (const context of CONTEXTS) byContext.set(context, []);
  for (const node of ARCH_NODES) byContext.get(node.context)?.push(node);

  for (const context of CONTEXTS) {
    const group = byContext.get(context) ?? [];
    const slot = CONTEXT_SLOT[context];
    const baseR = slot.radius * L;
    group.forEach((node, index) => {
      const n = Math.max(group.length, 1);
      const fan = n === 1 ? 0 : (index - (n - 1) / 2) * 0.38;
      const angle = slot.angle + fan;
      const ring = baseR + (index % 3) * 22 * L;
      centers.set(node.id, {
        x: origin.x + Math.cos(angle) * ring,
        y: origin.y + Math.sin(angle) * ring,
      });
    });
  }
  return centers;
}

function contextAnchor(context: ArchContext, length: number): Point {
  const L = Math.max(EDGE_LEN_MIN, Math.min(EDGE_LEN_MAX, length));
  const slot = CONTEXT_SLOT[context];
  return {
    x: 420 + Math.cos(slot.angle) * slot.radius * L,
    y: 340 + Math.sin(slot.angle) * slot.radius * L,
  };
}

function buildForceGraph(length: number, remesh: boolean, current: Map<string, Point>) {
  const L = Math.max(EDGE_LEN_MIN, Math.min(EDGE_LEN_MAX, length));
  const seed = !remesh || current.size === 0 ? forceSeedCenters(L) : current;
  const nodes: ForceNode[] = ARCH_NODES.map((node) => {
    const prev = seed.get(node.id);
    return {
      id: node.id,
      x: prev?.x ?? 420,
      y: prev?.y ?? 340,
      vx: 0,
      vy: 0,
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node] as const));

  const pairStrength = new Map<string, { id: string; strength: number; dist: number }>();
  for (const edge of ARCH_EDGES) {
    if (edge.query) continue;
    const a = edge.from < edge.to ? edge.from : edge.to;
    const b = edge.from < edge.to ? edge.to : edge.from;
    const key = `${a}|${b}`;
    const strength =
      edge.how === 'http' ? 0.35 : edge.how === 'bus' ? 0.42 : edge.how === 'async' ? 0.55 : 0.72;
    const dist =
      (edge.how === 'http' ? NODE_W + 52 : edge.how === 'bus' ? NODE_W + 64 : NODE_W + 40) * L;
    const prev = pairStrength.get(key);
    if (!prev || strength > prev.strength) pairStrength.set(key, { id: edge.id, strength, dist });
  }
  const links: ForceLink[] = [];
  const strengthById = new Map<string, number>();
  const distById = new Map<string, number>();
  for (const [key, meta] of pairStrength) {
    const [from, to] = key.split('|');
    const source = byId.get(from);
    const target = byId.get(to);
    if (!source || !target) continue;
    links.push({ id: meta.id, source, target });
    strengthById.set(meta.id, meta.strength);
    distById.set(meta.id, meta.dist);
  }

  const collide = Math.hypot(NODE_HW, NODE_HH) + 22 * L;
  const nodeContext = new Map(ARCH_NODES.map((node) => [node.id, node.context] as const));

  return { nodes, links, byId, strengthById, distById, collide, L, nodeContext };
}

function dagreCenters(dir: 'TB' | 'LR', length = 1): Map<string, Point> {
  const graph = new Graph({ multigraph: true });
  const L = Math.max(EDGE_LEN_MIN, Math.min(EDGE_LEN_MAX, length));
  graph.setGraph({
    rankdir: dir,
    align: 'UL',
    nodesep: Math.round(44 * L),
    ranksep: Math.round(52 * L),
    edgesep: 16,
    marginx: 20,
    marginy: 20,
    acyclicer: 'greedy',
    ranker: 'network-simplex',
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of ARCH_NODES) graph.setNode(node.id, { width: NODE_W, height: NODE_H });
  // Spine / forward edges only — avoid cycles (poll ↔ Active) scrambling ranks.
  for (const edge of ARCH_EDGES) {
    if (!LAYOUT_EDGE_IDS.has(edge.id)) continue;
    const weight = edge.how === 'http' && edge.query ? 1 : edge.how === 'bus' ? 4 : 8;
    graph.setEdge(edge.from, edge.to, { width: 14, height: 8, weight, minlen: 1 }, edge.id);
  }
  layout(graph);
  const centers = new Map<string, Point>();
  for (const node of ARCH_NODES) {
    const laid = graph.node(node.id);
    if (!laid) continue;
    centers.set(node.id, { x: laid.x, y: laid.y });
  }
  return centers;
}

function layoutByContext(mode: 'columns' | 'bands', length = 1): Map<string, Point> {
  const L = Math.max(EDGE_LEN_MIN, Math.min(EDGE_LEN_MAX, length));
  const centers = new Map<string, Point>();
  const step = Math.round((NODE_H + NODE_GAP) * L);
  const colPitch = Math.round((NODE_W + 56) * L);
  if (mode === 'columns') {
    let x = NODE_HW + 28;
    for (const context of CONTEXTS) {
      const group = ARCH_NODES.filter((node) => node.context === context);
      group.forEach((node, index) => {
        centers.set(node.id, { x, y: NODE_HH + 28 + index * step });
      });
      x += colPitch;
    }
    return centers;
  }
  let y = NODE_HH + 28;
  for (const context of CONTEXTS) {
    const group = ARCH_NODES.filter((node) => node.context === context);
    const perRow = context === 'Insurance' ? 4 : Math.max(group.length, 1);
    group.forEach((node, index) => {
      const col = index % perRow;
      const row = Math.floor(index / perRow);
      centers.set(node.id, {
        x: col * colPitch + NODE_HW + 28,
        y: y + row * step,
      });
    });
    const rows = Math.ceil(group.length / perRow);
    y += rows * step + Math.round(28 * L);
  }
  return centers;
}

/** Point on the node box rim (center → toward). */
function onRim(center: Point, toward: Point): Point {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return { x: center.x + NODE_HW, y: center.y };
  const sx = dx !== 0 ? NODE_HW / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const sy = dy !== 0 ? NODE_HH / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const t = Math.min(sx, sy);
  return { x: center.x + dx * t, y: center.y + dy * t };
}

function laneOffset(id: string, from: string, to: string): number {
  const twins = ARCH_EDGES.filter(
    (edge) => (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from),
  );
  const index = Math.max(
    0,
    twins.findIndex((edge) => edge.id === id),
  );
  return (index - (twins.length - 1) / 2) * 9;
}

function formatHopTime(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function contextSlug(context: ArchContext): string {
  return context.toLowerCase();
}

const EDGE_ENDS = new Map(ARCH_EDGES.map((edge) => [edge.id, edge]));

function nodesForStep(step: ArchStep): string[] {
  const ids = new Set<string>(step.focus);
  for (const raw of step.edgeIds) {
    const id = raw.endsWith('~') ? raw.slice(0, -1) : raw;
    const edge = EDGE_ENDS.get(id);
    if (!edge) continue;
    ids.add(edge.from);
    ids.add(edge.to);
  }
  return [...ids];
}

/** Primary hop for a step, oriented in the direction the packet travels. */
function travelHop(step: ArchStep): {
  edge: ArchEdge;
  fromId: string;
  toId: string;
} | null {
  const raw = step.edgeIds[step.edgeIds.length - 1] ?? step.edgeIds[0];
  if (!raw) return null;
  const reverse = raw.endsWith('~');
  const edge = EDGE_ENDS.get(reverse ? raw.slice(0, -1) : raw);
  if (!edge) return null;
  return {
    edge,
    fromId: reverse ? edge.to : edge.from,
    toId: reverse ? edge.from : edge.to,
  };
}

/** Input/output + from→to relative to one node on the hop. */
function routeOnNode(step: ArchStep, nodeId: string) {
  const hop = travelHop(step);
  if (!hop) {
    const here = nodeTitle(nodeId);
    return {
      dir: (step.toUser ? 'input' : 'output') as 'input' | 'output',
      peer: step.service || 'local',
      fromTitle: step.toUser ? step.service || 'upstream' : here,
      toTitle: step.toUser ? here : step.service || 'downstream',
      how: '',
      message: step.element,
    };
  }
  const fromTitle = nodeTitle(hop.fromId);
  const toTitle = nodeTitle(hop.toId);
  if (nodeId === hop.toId) {
    return {
      dir: 'input' as const,
      peer: fromTitle,
      fromTitle,
      toTitle,
      how: hop.edge.how,
      message: hop.edge.label,
    };
  }
  if (nodeId === hop.fromId) {
    return {
      dir: 'output' as const,
      peer: toTitle,
      fromTitle,
      toTitle,
      how: hop.edge.how,
      message: hop.edge.label,
    };
  }
  // Focus-only node on a multi-hop step — still show the path.
  return {
    dir: (step.toUser ? 'input' : 'output') as 'input' | 'output',
    peer: nodeId === hop.fromId ? toTitle : fromTitle,
    fromTitle,
    toTitle,
    how: hop.edge.how,
    message: hop.edge.label,
  };
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Short clock for mini-log rows (HH:MM). */
function formatClock(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatMiniTime(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** Compact one-line description that fits the mini strip. */
function briefLog(log: string, element: string): string {
  let cleaned = log.replace(/\s+/g, ' ').trim();
  cleaned = cleaned
    .replace(/^Screen monitor reads?\s+/i, '')
    .replace(/^The screen (still )?/i, '')
    .replace(/^You receive the answer\.?\s*/i, '')
    .replace(/^Worker (tick )?selects?\s+/i, 'scan ')
    .replace(/^Worker calls?\s+/i, '')
    .replace(/^Request reaches\s+/i, '→ ')
    .replace(/^claimUnpublished drains?\s+/i, 'drain ')
    .replace(/^Domain outbox row committed[^.]*\.?\s*/i, 'outbox committed. ')
    .replace(/^ActivateEnrolmentRequested is inserted[^.]*\.?\s*/i, 'handoff row. ')
    .replace(/^Accepts the command\.?\s*/i, 'accepted. ')
    .replace(/\s+/g, ' ')
    .trim();
  const first = cleaned.split(/(?<=[.!?])\s+/)[0] ?? cleaned;
  const el = element.trim().toLowerCase();
  const stripped =
    el && first.toLowerCase().startsWith(el) ? first.slice(element.length).replace(/^[:\s·-]+/, '') : first;
  return clip(stripped || first, 36);
}

/** Full log history per node (story order). Mini-logs show the last few. */
function nodeLogBags(
  steps: readonly ArchStep[],
  untilKey: string | null,
): Map<string, NodeLogEntry[]> {
  const bags = new Map<string, NodeLogEntry[]>();
  for (const step of steps) {
    for (const id of nodesForStep(step)) {
      const route = routeOnNode(step, id);
      const entry: NodeLogEntry = {
        key: step.key,
        at: step.at,
        kind: step.toUser ? 'Response' : step.kind,
        element: step.element,
        log: step.log,
        dir: route.dir,
        peer: route.peer,
        fromTitle: route.fromTitle,
        toTitle: route.toTitle,
        how: route.how,
        message: route.message,
        service: step.service,
        toUser: step.toUser,
        label: clip(route.message || step.element, 16),
        brief: clip(
          route.dir === 'input' ? `from ${route.peer}` : `to ${route.peer}`,
          28,
        ),
      };
      const list = bags.get(id) ?? [];
      list.push(entry);
      bags.set(id, list);
    }
    if (untilKey && step.key === untilKey) break;
  }
  return bags;
}

function storyPaint(steps: readonly ArchStep[], untilKey: string | null) {
  const activeNodes = new Set<string>();
  const waiting = new Set<string>();
  const processing = new Set<string>();
  const traveled = new Set<string>();

  const touch = (step: ArchStep, nodes: Set<string>, recordEdge: boolean) => {
    for (const id of step.focus) nodes.add(id);
    for (const raw of step.edgeIds) {
      const id = raw.endsWith('~') ? raw.slice(0, -1) : raw;
      const edge = EDGE_ENDS.get(id);
      if (!edge) continue;
      if (recordEdge) traveled.add(id);
      nodes.add(edge.from);
      nodes.add(edge.to);
    }
  };

  for (const step of steps) {
    if (untilKey && step.key === untilKey) {
      touch(step, processing, false);
      for (const id of step.settled) waiting.delete(id);
      for (const id of step.waiting) waiting.add(id);
      break;
    }
    for (const id of step.settled) waiting.delete(id);
    for (const id of step.waiting) waiting.add(id);
    touch(step, activeNodes, true);
  }

  for (const id of waiting) activeNodes.delete(id);
  for (const id of processing) {
    activeNodes.delete(id);
    waiting.delete(id);
  }

  const activeEdges = new Set<string>();
  for (const id of traveled) {
    const edge = EDGE_ENDS.get(id);
    if (edge && activeNodes.has(edge.from) && activeNodes.has(edge.to)) activeEdges.add(id);
  }
  return { activeNodes, activeEdges, processing, waiting };
}

async function playEdges(
  travel: MapApi['travel'] | undefined,
  edgeIds: readonly string[],
  duration: number,
) {
  for (const edgeId of edgeIds) {
    await (travel?.(edgeId, duration) ?? Promise.resolve());
  }
}

export function ArchitectureMap({
  steps,
  chromeHost = null,
  demoInspect = null,
}: {
  steps: readonly ArchStep[];
  /** When set, toolbar renders here (one row with Cards / Logs / Architecture). */
  chromeHost?: HTMLElement | null;
  /** Guided-tour inspect intent from ImpulseRail (applies on mount + updates). */
  demoInspect?: DemoArchInspect | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const apiRef = useRef<MapApi | null>(null);
  const centers = useRef(new Map<string, Point>());
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const scaleRef = useRef(1);
  const dirty = useRef(false);
  const moved = useRef(0);
  const layoutRef = useRef<LayoutId>('auto');
  const edgeLengthRef = useRef(EDGE_LEN_DEFAULT);
  const chain = useRef(Promise.resolve());
  const [layoutId, setLayoutId] = useState<LayoutId>('auto');
  const [edgeLength, setEdgeLength] = useState(EDGE_LEN_DEFAULT);
  const [showLogs, setShowLogs] = useState(true);
  const [transport, setTransport] = useState<Transport>('idle');
  const [playRate, setPlayRate] = useState(PLAY_RATE_DEFAULT);
  edgeLengthRef.current = edgeLength;
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const [sideW, setSideW] = useState(SIDE_W_DEFAULT);
  const [current, setCurrent] = useState<string | null>(null);
  const played = useRef(new Set<string>());
  const batch = useRef(0);
  const armed = useRef(false);
  const transportRef = useRef<Transport>('idle');
  transportRef.current = transport;
  const playCursorRef = useRef(0);
  const playRateRef = useRef(PLAY_RATE_DEFAULT);
  playRateRef.current = playRate;
  const skipLayout = useRef(true);
  const feedRef = useRef<HTMLOListElement>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const edgeDuration = () => Math.round(PLAY_EDGE_MS / playRateRef.current);
  const holdDuration = () => Math.round(PLAY_HOLD_MS / playRateRef.current);

  /**
   * Queue hops on the animation chain.
   * `replace` — from the start · `append` — continue / live follow.
   */
  const enqueueSteps = (
    list: readonly ArchStep[],
    mode: 'replace' | 'append',
    fromIndex = 0,
  ) => {
    if (list.length === 0) return;
    const gen = mode === 'replace' ? ++batch.current : batch.current;
    if (mode === 'replace') {
      apiRef.current?.haltTravel();
      chain.current = Promise.resolve();
      playCursorRef.current = fromIndex;
    }
    list.forEach((step, offset) => {
      const index = fromIndex + offset;
      chain.current = chain.current.then(() => {
        if (batch.current !== gen) return;
        if (transportRef.current !== 'playing') return;
        playCursorRef.current = index;
        setCurrent(step.key);
        if (step.edgeIds.length === 0) {
          return new Promise<void>((resolve) => {
            window.setTimeout(resolve, holdDuration());
          });
        }
        return playEdges(apiRef.current?.travel, step.edgeIds, edgeDuration());
      });
    });
    chain.current = chain.current.then(() => {
      if (batch.current !== gen) return;
      playCursorRef.current = fromIndex + list.length;
      setCurrent(null);
      if (transportRef.current === 'playing') {
        transportRef.current = 'idle';
        setTransport('idle');
        demoDispatch({ type: 'arch-idle' });
      }
    });
  };

  const playTransport = () => {
    const all = stepsRef.current;
    if (all.length === 0) {
      demoDispatch({ type: 'arch-idle' });
      return;
    }
    if (transportRef.current === 'playing') return;
    const resume = transportRef.current === 'paused';
    const from = resume ? playCursorRef.current : 0;
    transportRef.current = 'playing';
    setTransport('playing');
    if (resume) {
      enqueueSteps(all.slice(from), 'append', from);
    } else {
      enqueueSteps(all, 'replace', 0);
    }
  };

  const playTransportRef = useRef(playTransport);
  playTransportRef.current = playTransport;

  /** Replay a recorded hop — pauses live transport first. */
  const replayRef = useRef<(key: string) => void>(() => {});

  const pauseTransport = () => {
    if (transportRef.current !== 'playing') return;
    batch.current += 1;
    apiRef.current?.haltTravel();
    chain.current = Promise.resolve();
    transportRef.current = 'paused';
    setTransport('paused');
  };

  const resetTransport = () => {
    batch.current += 1;
    apiRef.current?.haltTravel();
    chain.current = Promise.resolve();
    playCursorRef.current = 0;
    setCurrent(null);
    transportRef.current = 'idle';
    setTransport('idle');
  };

  const replayStep = (key: string) => {
    const step = stepsRef.current.find((item) => item.key === key);
    if (!step) return;
    const index = stepsRef.current.findIndex((item) => item.key === key);
    batch.current += 1;
    apiRef.current?.haltTravel();
    playCursorRef.current = Math.max(0, index);
    transportRef.current = 'paused';
    setTransport('paused');
    const gen = ++batch.current;
    chain.current = Promise.resolve()
      .then(() => {
        if (batch.current !== gen) return;
        setCurrent(step.key);
        if (step.edgeIds.length === 0) {
          return new Promise<void>((resolve) => {
            window.setTimeout(resolve, Math.round(700 / playRateRef.current));
          });
        }
        return playEdges(apiRef.current?.travel, step.edgeIds, edgeDuration());
      })
      .then(() => {
        if (batch.current === gen) setCurrent(null);
      });
  };
  replayRef.current = replayStep;

  // Apply guided-tour inspect from ImpulseRail (always listening — survives late mount).
  useEffect(() => {
    if (!demoInspect) return;
    if (demoInspect.kind === 'edge') {
      const edge = ARCH_EDGES.find((item) => item.id === demoInspect.id);
      if (edge) setInspect({ kind: 'edge', edge });
      return;
    }
    const node = ARCH_NODES.find((item) => item.id === demoInspect.id);
    if (node) setInspect({ kind: 'node', node });
  }, [demoInspect]);

  useEffect(() => {
    return demoListen((command) => {
      if (command.type === 'arch-zoom') {
        const factor =
          typeof command.factor === 'number' && Number.isFinite(command.factor)
            ? command.factor
            : 1.4;
        apiRef.current?.zoomBy(factor);
        return;
      }
      if (command.type === 'arch-replay-log') {
        const root = svgRef.current;
        if (!root) return;
        const scope = command.nodeId
          ? root.querySelector(`.arch-node[data-id="${command.nodeId}"]`)
          : root;
        const line = scope?.querySelector('.arch-node-log-line') as HTMLElement | null;
        if (line) {
          line.click();
          return;
        }
        // No mini-log yet — replay first story hop that touches this node (or any).
        const bags = nodeLogBags(stepsRef.current, null);
        const entries = command.nodeId
          ? (bags.get(command.nodeId) ?? [])
          : [...bags.values()].flat();
        const key = entries[0]?.key;
        if (key) replayRef.current(key);
        return;
      }
      if (command.type !== 'arch-play') return;
      if (typeof command.rate === 'number' && Number.isFinite(command.rate)) {
        setPlayRate(command.rate);
        playRateRef.current = command.rate;
      }
      // Let React apply speed + architecture tab paint before play starts.
      window.setTimeout(() => playTransportRef.current(), 80);
    });
  }, []);

  useEffect(() => {
    const svgEl = svgRef.current;
    const frame = host.current;
    if (!svgEl || !frame) return;

    const svg = select(svgEl);
    svg.selectAll('*').remove();

    const root = svg.append('g').attr('class', 'arch-root');
    const edgeLayer = root.append('g').attr('class', 'arch-edges');
    const nodeLayer = root.append('g').attr('class', 'arch-nodes');
    const packetLayer = root.append('g').attr('class', 'arch-packets');
    /** Dragged / expanded nodes are reparented here so they (and logs) paint above edges + packets. */
    const raiseLayer = root.append('g').attr('class', 'arch-raise');

    let draggingEl: SVGGElement | null = null;
    /** Drag end fires a follow-up canvas click — ignore that one clear. */
    let suppressCanvasClear = false;
    let forceSim: Simulation<ForceNode, ForceLink> | null = null;
    const forceNodes = new Map<string, ForceNode>();
    /** Absolute graph-space bend handles (label drag). */
    const edgeBends = new Map<string, Point>();
    let labelMoved = 0;
    const bringFront = (el: SVGGElement) => {
      raiseLayer.node()?.appendChild(el);
    };
    const parkNode = (el: SVGGElement) => {
      nodeLayer.node()?.appendChild(el);
    };
    const raiseEdge = (el: SVGGElement) => {
      edgeLayer.node()?.appendChild(el);
    };
    const selectNode = (el: SVGGElement, node: ArchNode) => {
      suppressCanvasClear = true;
      setInspect((current) => {
        if (current?.kind === 'node' && current.node.id === node.id) {
          parkNode(el);
          return null;
        }
        bringFront(el);
        return { kind: 'node', node };
      });
      window.setTimeout(() => {
        suppressCanvasClear = false;
      }, 0);
    };
    const stopForce = () => {
      forceSim?.stop();
      forceSim = null;
      forceNodes.clear();
    };

    const placeEdge = (el: SVGGElement) => {
      const fromId = el.getAttribute('data-from') ?? '';
      const toId = el.getAttribute('data-to') ?? '';
      const edgeId = el.getAttribute('data-id') ?? '';
      const from = centers.current.get(fromId);
      const to = centers.current.get(toId);
      if (!from || !to) return;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const off = laneOffset(edgeId, fromId, toId);
      const nx = -dy / len;
      const ny = dx / len;
      const bend = edgeBends.get(edgeId);
      let start: Point;
      let end: Point;
      let labelAt: Point;
      let d: string;
      if (bend) {
        start = onRim(from, bend);
        end = onRim(to, bend);
        d = `M ${start.x} ${start.y} Q ${bend.x} ${bend.y} ${end.x} ${end.y}`;
        // Point on the quadratic at t=0.5
        labelAt = {
          x: 0.25 * start.x + 0.5 * bend.x + 0.25 * end.x,
          y: 0.25 * start.y + 0.5 * bend.y + 0.25 * end.y,
        };
      } else {
        // Straight rim-to-rim; parallel edges get a small lateral offset only.
        const start0 = onRim(from, to);
        const end0 = onRim(to, from);
        start = { x: start0.x + nx * off, y: start0.y + ny * off };
        end = { x: end0.x + nx * off, y: end0.y + ny * off };
        d = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
        labelAt = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      }
      select(el).select('path.arch-edge-line').attr('d', d);
      select(el).select('path.arch-edge-hit').attr('d', d);

      const label = select(el).select<SVGGElement>('.arch-edge-label');
      if (!label.empty()) {
        label.attr('transform', `translate(${labelAt.x},${labelAt.y})`);
        const text = label.select('text');
        const width = Math.max(36, (text.node()?.getComputedTextLength() ?? 40) + 12);
        label
          .select('rect')
          .attr('x', -width / 2)
          .attr('width', width);
      }
    };

    const placeNode = (el: SVGGElement) => {
      const id = el.getAttribute('data-id') ?? '';
      const at = centers.current.get(id);
      if (!at) return;
      select(el).attr('transform', `translate(${at.x},${at.y})`);
    };

    const placeAll = () => {
      nodeLayer.selectAll<SVGGElement, unknown>('.arch-node').each(function () {
        placeNode(this);
      });
      raiseLayer.selectAll<SVGGElement, unknown>('.arch-node').each(function () {
        placeNode(this);
      });
      edgeLayer.selectAll<SVGGElement, unknown>('.arch-edge').each(function () {
        placeEdge(this);
      });
    };

    const fit = (animate: boolean) => {
      const width = frame.clientWidth;
      const height = frame.clientHeight;
      const behavior = zoomRef.current;
      if (width < 40 || height < 40 || !behavior) return;
      if (centers.current.size === 0) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const at of centers.current.values()) {
        minX = Math.min(minX, at.x - NODE_HW - 8);
        minY = Math.min(minY, at.y - NODE_HH - 8);
        maxX = Math.max(maxX, at.x + NODE_HW + 8);
        maxY = Math.max(maxY, at.y + NODE_HH + 8);
      }
      const gw = Math.max(1, maxX - minX);
      const gh = Math.max(1, maxY - minY);
      const pad = 36;
      const fitted = Math.min((width - pad) / gw, (height - pad) / gh);
      const next = Math.min(Math.max(fitted, 0.22), 1.15);
      const tx = (width - gw * next) / 2 - minX * next;
      const ty = (height - gh * next) / 2 - minY * next;
      const transform = zoomIdentity.translate(tx, ty).scale(next);
      svg.interrupt();
      if (animate) svg.transition().duration(280).call(behavior.transform, transform);
      else svg.call(behavior.transform, transform);
      scaleRef.current = next;
    };

    const pushForceCenters = () => {
      for (const node of forceNodes.values()) {
        if (node.x == null || node.y == null) continue;
        centers.current.set(node.id, { x: node.x, y: node.y });
      }
      placeAll();
    };

    const attachForceForces = (
      sim: Simulation<ForceNode, ForceLink>,
      graph: ReturnType<typeof buildForceGraph>,
      live: boolean,
    ) => {
      const { links, strengthById, distById, collide, L, nodeContext } = graph;
      // Mesh: context X/Y anchors cluster by bounded context.
      // Force (live): strong collide + charge so cards stay apart; friction keeps it calm.
      const liveCollide = Math.hypot(NODE_HW, NODE_HH) + 40 * L;
      sim
        .force(
          'link',
          forceLink<ForceNode, ForceLink>(links)
            .id((node) => node.id)
            .distance((link) => {
              const base = distById.get(link.id) ?? NODE_W + 48;
              return live ? base * 1.45 : base;
            })
            .strength((link) => (strengthById.get(link.id) ?? 0.5) * (live ? 0.55 : 1)),
        )
        .force(
          'charge',
          forceManyBody()
            .strength(live ? -560 * L : -640 * L)
            .distanceMax(live ? 520 : 800)
            .theta(0.9),
        )
        .force('center', forceCenter(420, 340).strength(live ? 0.035 : 0.12))
        .force(
          'collide',
          forceCollide<ForceNode>(live ? liveCollide : collide)
            .strength(1)
            .iterations(live ? 5 : 3),
        );

      if (!live) {
        sim
          .force(
            'x',
            forceX<ForceNode>((node) => {
              const ctx = nodeContext.get(node.id) ?? 'Insurance';
              return contextAnchor(ctx, L).x;
            }).strength(0.14),
          )
          .force(
            'y',
            forceY<ForceNode>((node) => {
              const ctx = nodeContext.get(node.id) ?? 'Insurance';
              return contextAnchor(ctx, L).y;
            }).strength(0.14),
          );
      } else {
        sim.force('x', null).force('y', null);
      }
    };

    /** Settle force off-DOM, paint once. `remesh` keeps current positions as the seed. */
    const runForceMesh = (length: number, remesh: boolean) => {
      stopForce();
      const graph = buildForceGraph(length, remesh, centers.current);
      for (const node of graph.nodes) forceNodes.set(node.id, node);
      forceSim = forceSimulation(graph.nodes).alpha(1).alphaDecay(0.028).stop();
      attachForceForces(forceSim, graph, false);
      for (let i = 0; i < 180; i++) forceSim.tick();
      pushForceCenters();
      stopForce();
      dirty.current = false;
      fit(false);
    };

    /** Live simulation — keeps ticking; drag pins via fx/fy. */
    const runLiveForce = (length: number, remesh: boolean) => {
      stopForce();
      const graph = buildForceGraph(length, remesh, centers.current);
      for (const node of graph.nodes) forceNodes.set(node.id, node);
      forceSim = forceSimulation(graph.nodes)
        .alpha(1)
        .alphaDecay(0.022)
        .alphaMin(0.012)
        .velocityDecay(0.58);
      attachForceForces(forceSim, graph, true);
      forceSim.on('tick', () => {
        pushForceCenters();
      });
      dirty.current = false;
      // Fit once after a short settle so the camera does not chase every tick.
      window.setTimeout(() => {
        if (layoutRef.current === 'force') fit(true);
      }, 420);
    };

    const apply = (
      id: LayoutId,
      animate: boolean,
      length = edgeLengthRef.current,
      remesh = false,
    ) => {
      edgeBends.clear();
      if (id === 'auto') {
        runForceMesh(length, remesh);
        return;
      }
      if (id === 'force') {
        runLiveForce(length, remesh);
        return;
      }
      stopForce();
      centers.current =
        id === 'across'
          ? layoutByContext('bands', length)
          : id === 'contexts'
            ? layoutByContext('columns', length)
            : dagreCenters('TB', length);
      dirty.current = false;
      placeAll();
      fit(animate);
    };

    const labelDrag = drag<SVGGElement, unknown>()
      .clickDistance(4)
      .on('start', function (event) {
        labelMoved = 0;
        event.sourceEvent?.stopPropagation();
        const edgeEl = this.parentNode as SVGGElement | null;
        if (edgeEl) raiseEdge(edgeEl);
      })
      .on('drag', function (event) {
        labelMoved += Math.abs(event.dx) + Math.abs(event.dy);
        const edgeEl = this.parentNode as SVGGElement | null;
        const edgeId = edgeEl?.getAttribute('data-id') ?? '';
        if (!edgeEl || !edgeId) return;
        const fromId = edgeEl.getAttribute('data-from') ?? '';
        const toId = edgeEl.getAttribute('data-to') ?? '';
        const from = centers.current.get(fromId);
        const to = centers.current.get(toId);
        if (!from || !to) return;
        let bend = edgeBends.get(edgeId);
        if (!bend) {
          bend = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
          edgeBends.set(edgeId, bend);
        }
        bend.x += event.dx;
        bend.y += event.dy;
        placeEdge(edgeEl);
        dirty.current = true;
      })
      .on('end', function (event) {
        event.sourceEvent?.stopPropagation();
        // d3-drag swallows click on the label — inspect on tap, keep drag for bends.
        if (labelMoved > 4) return;
        const edgeEl = this.parentNode as SVGGElement | null;
        const edgeId = edgeEl?.getAttribute('data-id') ?? '';
        const edge = ARCH_EDGES.find((item) => item.id === edgeId);
        if (!edge) return;
        setInspect((current) =>
          current?.kind === 'edge' && current.edge.id === edge.id
            ? null
            : { kind: 'edge', edge },
        );
      });

    for (const edge of ARCH_EDGES) {
      const group = edgeLayer
        .append('g')
        .attr('class', `arch-edge how-${edge.how}`)
        .attr('data-id', edge.id)
        .attr('data-from', edge.from)
        .attr('data-to', edge.to)
        .attr('data-how', edge.how)
        .classed('is-query', Boolean(edge.query))
        .attr('role', 'button')
        .attr('aria-label', `Edge ${edge.label}: ${edge.from} to ${edge.to}`)
        .style('cursor', 'pointer')
        .on('click', (event) => {
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          if (labelMoved > 4) return;
          setInspect((current) =>
            current?.kind === 'edge' && current.edge.id === edge.id
              ? null
              : { kind: 'edge', edge },
          );
        });
      group.append('path').attr('class', 'arch-edge-hit');
      group.append('path').attr('class', 'arch-edge-line');
      const pill = group
        .append('g')
        .attr('class', 'arch-edge-label')
        .attr('role', 'button')
        .attr('aria-label', `Inspect edge ${edge.label}`)
        .style('cursor', 'pointer')
        .call(labelDrag)
        .on('dblclick', (event) => {
          event.stopPropagation();
          edgeBends.delete(edge.id);
          placeEdge(group.node() as SVGGElement);
        });
      pill.append('rect').attr('y', -9).attr('height', 18).attr('rx', 4);
      pill
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .text(`${edge.label} · ${HOW_LABEL[edge.how] ?? edge.how}`);
    }

    // d3-drag swallows click on the node — select on pointer-up when it was a tap, not a drag.
    const nodeDrag = drag<SVGGElement, unknown>()
      .clickDistance(6)
      .on('start', function (event) {
        moved.current = 0;
        event.sourceEvent?.stopPropagation();
        draggingEl = this;
        bringFront(this);
        const id = this.getAttribute('data-id') ?? '';
        const simNode = forceNodes.get(id);
        if (simNode && forceSim) {
          simNode.fx = simNode.x ?? null;
          simNode.fy = simNode.y ?? null;
          forceSim.alphaTarget(0.06).restart();
        }
      })
      .on('drag', function (event) {
        const id = this.getAttribute('data-id') ?? '';
        const at = centers.current.get(id);
        if (!at) return;
        moved.current += Math.abs(event.dx) + Math.abs(event.dy);
        // dx/dy are already in the zoomed group's local (graph) space via SVG CTM —
        // do not divide by zoom scale or the node overshoots.
        at.x += event.dx;
        at.y += event.dy;
        const simNode = forceNodes.get(id);
        if (simNode && forceSim) {
          simNode.fx = at.x;
          simNode.fy = at.y;
          simNode.x = at.x;
          simNode.y = at.y;
          simNode.vx = 0;
          simNode.vy = 0;
        }
        placeNode(this);
        edgeLayer.selectAll<SVGGElement, unknown>('.arch-edge').each(function () {
          const from = this.getAttribute('data-from');
          const to = this.getAttribute('data-to');
          if (from === id || to === id) placeEdge(this);
        });
      })
      .on('end', function (event) {
        const el = this;
        draggingEl = null;
        const id = el.getAttribute('data-id') ?? '';
        const simNode = forceNodes.get(id);
        if (simNode && forceSim) {
          // Live Force: release pin so the graph reflows; Mesh already stopped.
          if (layoutRef.current === 'force') {
            simNode.fx = null;
            simNode.fy = null;
            forceSim.alphaTarget(0);
          } else {
            simNode.fx = simNode.x ?? null;
            simNode.fy = simNode.y ?? null;
          }
        }
        if (moved.current > 6) {
          dirty.current = true;
          if (!el.classList.contains('is-expanded')) parkNode(el);
          return;
        }
        // Mini-log row owns the click — replay that hop instead of toggling inspect.
        const hit = event.sourceEvent?.target as Element | null | undefined;
        if (hit?.closest?.('.arch-node-log-line')) return;
        const target = ARCH_NODES.find((item) => item.id === id);
        if (target) selectNode(el, target);
        else if (!el.classList.contains('is-expanded')) parkNode(el);
      });

    for (const node of ARCH_NODES) {
      const group = nodeLayer
        .append('g')
        .attr('class', `arch-node ctx-${contextSlug(node.context)}`)
        .attr('data-id', node.id)
        .attr('data-context', node.context)
        .attr('role', 'button')
        .attr('aria-label', `${node.context}: ${node.title}`)
        .call(nodeDrag);

      group
        .append('rect')
        .attr('class', 'arch-node-disk')
        .attr('x', -NODE_HW)
        .attr('y', -NODE_HH)
        .attr('width', NODE_W)
        .attr('height', NODE_H)
        .attr('rx', NODE_RX)
        .attr('ry', NODE_RX);
      const card = group
        .append('foreignObject')
        .attr('class', 'arch-node-title-box')
        .attr('x', -NODE_HW + 10)
        .attr('y', -NODE_HH + 10)
        .attr('width', NODE_W - 20)
        .attr('height', NODE_H - 20);
      const cardBody = card
        .append('xhtml:div')
        .attr('xmlns', 'http://www.w3.org/1999/xhtml')
        .attr('class', 'arch-node-card');
      cardBody.append('xhtml:div').attr('class', 'arch-node-title').text(node.title);
      cardBody.append('xhtml:div').attr('class', 'arch-node-blurb').text(node.blurb);
      group
        .append('text')
        .attr('class', 'arch-wait')
        .attr('text-anchor', 'middle')
        .attr('y', -NODE_HH - 8)
        .text('');

      // Fixed square ring — dashes march along the path (no rotation of the box).
      group
        .append('rect')
        .attr('class', 'arch-spin-ring')
        .attr('x', -NODE_HW - 4)
        .attr('y', -NODE_HH - 4)
        .attr('width', NODE_W + 8)
        .attr('height', NODE_H + 8)
        .attr('rx', NODE_RX + 2)
        .attr('ry', NODE_RX + 2)
        .attr('fill', 'none')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '10 8');

      // Docked at the right rim. Vertically recentered when height is known.
      const log = group
        .append('g')
        .attr('class', 'arch-node-log')
        .attr('transform', `translate(${NODE_HW},0)`)
        .style('cursor', 'pointer');
      // Filled connector from disk rim into the panel (no floating stem gap).
      log.append('path').attr('class', 'arch-node-log-dock');
      const glass = log
        .append('foreignObject')
        .attr('class', 'arch-node-log-glass')
        .attr('x', 10)
        .attr('y', 0)
        .attr('width', LOG_W)
        .attr('height', 0);
      const frost = glass
        .append('xhtml:div')
        .attr('xmlns', 'http://www.w3.org/1999/xhtml')
        .attr('class', 'arch-node-log-frost');
      frost.append('xhtml:div').attr('class', 'arch-node-log-head');
      frost.append('xhtml:div').attr('class', 'arch-node-log-lines');
      frost.append('xhtml:div').attr('class', 'arch-node-log-more');
    }

    const eachNode = (fn: (el: SVGGElement) => void) => {
      nodeLayer.selectAll<SVGGElement, unknown>('.arch-node').each(function () {
        fn(this);
      });
      raiseLayer.selectAll<SVGGElement, unknown>('.arch-node').each(function () {
        fn(this);
      });
    };

    const orderDepth = (liveNodes: Set<string>, liveEdges: Set<string>) => {
      const edgeRoot = edgeLayer.node();
      if (edgeRoot) {
        const edges = [...edgeRoot.querySelectorAll<SVGGElement>(':scope > .arch-edge')];
        edges.sort((a, b) => {
          const aId = a.getAttribute('data-id') ?? '';
          const bId = b.getAttribute('data-id') ?? '';
          const aLive =
            liveEdges.has(aId) ||
            a.classList.contains('is-sending') ||
            a.classList.contains('is-selected');
          const bLive =
            liveEdges.has(bId) ||
            b.classList.contains('is-sending') ||
            b.classList.contains('is-selected');
          return Number(aLive) - Number(bLive);
        });
        for (const el of edges) edgeRoot.appendChild(el);
      }
      // Park dim first, then raise live — inactive always under.
      eachNode((el) => {
        const id = el.getAttribute('data-id') ?? '';
        if (!(liveNodes.has(id) || el === draggingEl || el.classList.contains('is-expanded'))) {
          parkNode(el);
        }
      });
      eachNode((el) => {
        const id = el.getAttribute('data-id') ?? '';
        if (liveNodes.has(id) || el === draggingEl || el.classList.contains('is-expanded')) {
          bringFront(el);
        }
      });
    };

    const setNodeLogs = (
      bags: Map<string, NodeLogEntry[]>,
      expandedId: string | null,
      playingKey: string | null = null,
    ) => {
      eachNode((el) => {
        const id = el.getAttribute('data-id') ?? '';
        const all = bags.get(id) ?? [];
        const recent = all.slice(-MINI_LOG_COUNT).reverse();
        const box = select(el).select('.arch-node-log');
        const expanded = expandedId === id;
        select(el).classed('is-expanded', expanded);
        // Stacking is owned by orderDepth (inactive under live).
        box.classed('is-on', recent.length > 0 || expanded);
        box.classed('is-expanded', expanded);

        const frost = box.select('.arch-node-log-frost');
        frost.select('.arch-node-log-head').text('').style('display', 'none');
        frost.select('.arch-node-log-more').text('').style('display', 'none');
        const linesHost = frost.select('.arch-node-log-lines');
        const lineSel = linesHost
          .selectAll<HTMLDivElement, NodeLogEntry>('div.arch-node-log-line')
          .data(recent, (d) => `${d.key}:${d.at}`);
        lineSel.exit().remove();
        const entered = lineSel.enter().append('xhtml:div').attr('class', 'arch-node-log-line');
        entered.append('xhtml:span').attr('class', 'arch-node-log-time');
        entered.append('xhtml:span').attr('class', 'arch-node-log-dir');
        entered.append('xhtml:span').attr('class', 'arch-node-log-label');
        entered.append('xhtml:span').attr('class', 'arch-node-log-brief');
        const merged = entered.merge(lineSel as never);
        merged
          .classed('is-response', (d) => d.dir === 'input')
          .classed('is-send', (d) => d.dir === 'output')
          .classed('is-playing', (d) => playingKey != null && d.key === playingKey)
          .attr('role', 'button')
          .attr('title', 'Replay this hop')
          .style('cursor', 'pointer')
          .on('click', (event, d) => {
            event.preventDefault();
            event.stopPropagation();
            replayRef.current(d.key);
          })
          .on('mousedown', (event) => {
            event.stopPropagation();
          })
          .on('pointerdown', (event) => {
            event.stopPropagation();
          });
        merged.select('.arch-node-log-time').text((d) => formatClock(d.at));
        merged.select('.arch-node-log-dir').text((d) => {
          if (playingKey != null && d.key === playingKey) {
            return d.dir === 'input' ? '← in' : 'out →';
          }
          return d.dir === 'input' ? 'input' : 'output';
        });
        merged.select('.arch-node-log-label').text((d) => d.label);
        merged.select('.arch-node-log-brief').text((d) => {
          if (playingKey != null && d.key === playingKey) {
            return d.dir === 'input' ? `← ${d.peer}` : `→ ${d.peer}`;
          }
          return d.brief;
        });

        // Temporarily give room to layout, then size the foreignObject to real content.
        const glass = box.select('.arch-node-log-glass').attr('width', LOG_W).attr('y', 0);
        if (recent.length === 0) {
          glass.attr('height', 0);
          box.attr('transform', `translate(${NODE_HW},0)`);
          box.select('.arch-node-log-dock').attr('d', '');
          return;
        }
        glass.attr('height', 420);
        const frostEl = frost.node() as HTMLElement | null;
        const h = Math.max(48, Math.ceil(frostEl?.scrollHeight ?? frostEl?.offsetHeight ?? 48));
        glass.attr('height', h);
        box.attr('transform', `translate(${NODE_HW},${-h / 2})`);
        const mid = h / 2;
        box
          .select('.arch-node-log-dock')
          .attr('d', `M 0 ${mid} L 10 ${Math.max(5, mid - 8)} L 10 ${Math.min(h - 5, mid + 8)} Z`);
      });
    };

    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 2.4])
      .filter((event: Event) => {
        if (event.type === 'wheel') return true;
        const target = event.target as Element | null;
        return !target?.closest('.arch-node, .arch-edge');
      })
      .on('zoom', (event) => {
        scaleRef.current = event.transform.k;
        root.attr('transform', event.transform.toString());
      });
    zoomRef.current = behavior;
    svg.call(behavior);
    // Only clear when the click lands on empty canvas — not when a node/edge handled it.
    svg.on('click', (event) => {
      if (suppressCanvasClear) return;
      const target = event.target as Element | null;
      if (target?.closest?.('.arch-node, .arch-edge')) return;
      setInspect(null);
    });

    const haltTravel = () => {
      packetLayer.selectAll('*').interrupt().remove();
      edgeLayer
        .selectAll<SVGGElement, unknown>('.arch-edge')
        .classed('is-sending', false)
        .classed('is-return', false);
    };

    const travel = (edgeId: string, duration: number) =>
      new Promise<void>((resolve) => {
        const reverse = edgeId.endsWith('~');
        const id = reverse ? edgeId.slice(0, -1) : edgeId;
        const group = edgeLayer.select<SVGGElement>(`.arch-edge[data-id="${id}"]`);
        if (group.empty()) {
          resolve();
          return;
        }
        group.classed('is-return', reverse);
        const path = group.select<SVGPathElement>('path.arch-edge-line').node();
        if (!path) {
          group.classed('is-return', false);
          resolve();
          return;
        }
        const total = path.getTotalLength();
        if (!total) {
          group.classed('is-return', false);
          resolve();
          return;
        }
        group.classed('is-sending', true);
        const edgeEl = group.node();
        if (edgeEl) raiseEdge(edgeEl);
        const packet = packetLayer
          .append('circle')
          .attr('class', reverse ? 'arch-packet is-response' : 'arch-packet is-request')
          .attr('r', reverse ? 5 : 4);
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          group.classed('is-sending', false).classed('is-return', false);
          packet.remove();
          resolve();
        };
        packet
          .transition()
          .duration(duration)
          .ease(easeCubicInOut)
          .attrTween('transform', () => (t) => {
            const at = path.getPointAtLength(total * (reverse ? 1 - t : t));
            return `translate(${at.x},${at.y})`;
          })
          .on('end', finish)
          .on('interrupt', finish);
      });

    const zoomBy = (factor: number) => {
      const behavior = zoomRef.current;
      if (!behavior) return;
      svg.transition().duration(420).call(behavior.scaleBy, factor);
    };

    apiRef.current = { apply, travel, haltTravel, setNodeLogs, orderDepth, zoomBy };
    apply(layoutRef.current, false);

    let seenW = frame.clientWidth;
    let seenH = frame.clientHeight;
    const observer = new ResizeObserver(() => {
      const width = frame.clientWidth;
      const height = frame.clientHeight;
      if (width === seenW && height === seenH) return;
      seenW = width;
      seenH = height;
      // Mesh: only refit zoom — never re-simulate (side panel open was re-rolling the graph).
      if (layoutRef.current === 'auto' || dirty.current) {
        fit(false);
        return;
      }
      apply(layoutRef.current, false);
    });
    observer.observe(frame);
    return () => {
      stopForce();
      observer.disconnect();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    layoutRef.current = layoutId;
    if (skipLayout.current) {
      skipLayout.current = false;
      return;
    }
    apiRef.current?.apply(layoutId, true, edgeLengthRef.current, false);
  }, [layoutId]);

  const skipLength = useRef(true);
  useEffect(() => {
    if (skipLength.current) {
      skipLength.current = false;
      return;
    }
    // Edge length: remesh from current positions so spacing updates without a full reshuffle.
    const live = layoutRef.current === 'auto' || layoutRef.current === 'force';
    apiRef.current?.apply(layoutRef.current, true, edgeLength, live);
  }, [edgeLength]);

  const organize = () => {
    if (layoutId === 'auto' || layoutId === 'force') {
      for (const [id, at] of centers.current) {
        centers.current.set(id, {
          x: at.x + (Math.random() - 0.5) * 72,
          y: at.y + (Math.random() - 0.5) * 72,
        });
      }
      apiRef.current?.apply(layoutId, false, edgeLengthRef.current, true);
    } else setLayoutId('auto');
  };

  // Auto-follow: append newly arrived hops while transport is playing.
  useEffect(() => {
    if (!armed.current) {
      armed.current = true;
      for (const step of steps) played.current.add(step.key);
      return;
    }
    const fresh = steps.filter((step) => !played.current.has(step.key));
    if (fresh.length === 0) return;
    for (const step of fresh) played.current.add(step.key);
    if (transportRef.current !== 'playing') return;
    const from = Math.max(
      0,
      steps.findIndex((step) => step.key === fresh[0]?.key),
    );
    enqueueSteps(fresh, 'append', from);
  }, [steps]);

  // Always full history — replay must not shrink the strip / detail list.
  const logBags = nodeLogBags(steps, null);
  const inspectNode = inspect?.kind === 'node' ? inspect.node : null;
  const inspectEdge = inspect?.kind === 'edge' ? inspect.edge : null;
  const pickedLogs = inspectNode ? (logBags.get(inspectNode.id) ?? []) : [];

  useEffect(() => {
    const done = storyPaint(steps, null);
    const now = current ? storyPaint(steps, current) : done;
    const bags = nodeLogBags(steps, null);
    const svg = svgRef.current;
    if (!svg) return;
    const hasStory = done.activeNodes.size > 0 || now.processing.size > 0 || now.waiting.size > 0;
    const selectedNodeId = inspect?.kind === 'node' ? inspect.node.id : null;
    const selectedEdgeId = inspect?.kind === 'edge' ? inspect.edge.id : null;
    const liveNodes = new Set<string>();
    svg.querySelectorAll<SVGGElement>('.arch-node').forEach((node) => {
      const id = node.getAttribute('data-id') ?? '';
      const processing = now.processing.has(id);
      const waiting = now.waiting.has(id) && !processing;
      const active = done.activeNodes.has(id) && !processing && !waiting;
      const expanded = selectedNodeId === id;
      const live = active || processing || waiting || expanded;
      if (live) liveNodes.add(id);
      node.classList.toggle('is-processing', processing);
      node.classList.toggle('is-waiting', waiting);
      node.classList.toggle('is-active', active || expanded);
      node.classList.toggle('is-selected', expanded);
      node.classList.toggle('is-dim', hasStory && !live);
      const label = node.querySelector('.arch-wait');
      if (label) label.textContent = waiting ? 'waiting' : '';
    });
    const liveEdges = new Set<string>(done.activeEdges);
    if (selectedEdgeId) liveEdges.add(selectedEdgeId);
    svg.querySelectorAll<SVGGElement>('.arch-edge').forEach((edge) => {
      const id = edge.getAttribute('data-id') ?? '';
      const live =
        liveEdges.has(id) ||
        edge.classList.contains('is-sending') ||
        selectedEdgeId === id;
      edge.classList.toggle('is-active', done.activeEdges.has(id));
      edge.classList.toggle('is-selected', selectedEdgeId === id);
      edge.classList.toggle('is-dim', hasStory && !live);
    });
    apiRef.current?.setNodeLogs(bags, showLogs ? selectedNodeId : null, current);
    apiRef.current?.orderDepth(liveNodes, liveEdges);
  }, [steps, current, inspect, showLogs]);

  useEffect(() => {
    const row = feedRef.current?.querySelector('.is-current');
    if (row) row.scrollIntoView({ block: 'nearest' });
    else if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [current, steps]);

  const toolbar = (
    <div className="arch-toolbar">
      <div className="log-filter-options" role="group" aria-label="Layout">
        {LAYOUTS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={layoutId === item.id ? 'log-chip active' : 'log-chip'}
            onClick={() => {
              if (
                (item.id === 'auto' && layoutId === 'auto') ||
                (item.id === 'force' && layoutId === 'force')
              ) {
                organize();
              } else setLayoutId(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="arch-edge-width" role="group" aria-label="Edge length">
        <span className="arch-edge-width-label">Edge length</span>
        <button
          type="button"
          className="log-chip arch-edge-width-btn"
          aria-label="Shorter edges"
          disabled={edgeLength <= EDGE_LEN_MIN}
          onClick={() =>
            setEdgeLength((w) => Math.max(EDGE_LEN_MIN, Math.round((w - EDGE_LEN_STEP) * 10) / 10))
          }
        >
          −
        </button>
        <span className="arch-edge-width-value" aria-live="polite">
          {edgeLength.toFixed(1)}
        </span>
        <button
          type="button"
          className="log-chip arch-edge-width-btn"
          aria-label="Longer edges"
          disabled={edgeLength >= EDGE_LEN_MAX}
          onClick={() =>
            setEdgeLength((w) => Math.min(EDGE_LEN_MAX, Math.round((w + EDGE_LEN_STEP) * 10) / 10))
          }
        >
          +
        </button>
      </div>
      <div className="arch-play-controls" role="group" aria-label="Playback">
        <button
          type="button"
          className={`log-chip arch-player-btn${transport === 'playing' ? ' active is-playing' : ''}`}
          aria-label="Play"
          aria-pressed={transport === 'playing'}
          disabled={transport === 'playing'}
          onClick={playTransport}
          title="Play"
        >
          <IconPlay className="arch-player-icon" />
        </button>
        <button
          type="button"
          className={`log-chip arch-player-btn${transport === 'paused' ? ' active' : ''}`}
          aria-label="Pause"
          aria-pressed={transport === 'paused'}
          disabled={transport !== 'playing'}
          onClick={pauseTransport}
          title="Pause"
        >
          <IconPause className="arch-player-icon" />
        </button>
        <button
          type="button"
          className="log-chip arch-player-btn"
          aria-label="Reset"
          disabled={transport === 'idle' && current == null}
          onClick={resetTransport}
          title="Reset"
        >
          <IconReset className="arch-player-icon" />
        </button>
      </div>
      <GlassSelect
        className="arch-speed-select"
        aria-label="Playback speed"
        value={String(playRate)}
        onChange={(next) => setPlayRate(Number(next))}
        options={PLAY_RATE_OPTIONS}
      />
      <button
        type="button"
        className={`log-chip${showLogs ? ' active' : ''}`}
        aria-pressed={showLogs}
        onClick={() => setShowLogs((on) => !on)}
      >
        Logs
      </button>
    </div>
  );

  return (
    <div className="arch-map">
      {chromeHost ? createPortal(toolbar, chromeHost) : toolbar}
      <div className="arch-body">
        <div className={`arch-stage${showLogs ? '' : ' logs-off'}`} ref={host}>
          <table className="arch-legend" aria-label="Legend">
            <tbody>
              <tr>
                <td>
                  <span className="arch-legend-line how-http" />
                </td>
                <td>http</td>
              </tr>
              <tr>
                <td>
                  <span className="arch-legend-line how-direct" />
                </td>
                <td>direct</td>
              </tr>
              <tr>
                <td>
                  <span className="arch-legend-line how-async" />
                </td>
                <td>async</td>
              </tr>
              <tr>
                <td>
                  <span className="arch-legend-line how-bus" />
                </td>
                <td>bus</td>
              </tr>
              <tr>
                <td>
                  <span className="arch-legend-dot is-request" />
                </td>
                <td>output</td>
              </tr>
              <tr>
                <td>
                  <span className="arch-legend-dot is-response" />
                </td>
                <td>input</td>
              </tr>
            </tbody>
          </table>
          <svg ref={svgRef} role="img" aria-label="System architecture" />
        </div>
        <aside
          className={`arch-side${inspect ? ' is-open' : ''}`}
          style={{ width: sideW }}
          aria-label="Details"
          data-arch-inspect={
            inspect?.kind === 'edge'
              ? `edge:${inspect.edge.id}`
              : inspect?.kind === 'node'
                ? `node:${inspect.node.id}`
                : undefined
          }
        >
          <div
            className="arch-side-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize details panel"
            aria-valuemin={SIDE_W_MIN}
            aria-valuemax={SIDE_W_MAX}
            aria-valuenow={sideW}
            onPointerDown={(event) => {
              event.preventDefault();
              const startX = event.clientX;
              const startW = sideW;
              const target = event.currentTarget;
              target.setPointerCapture(event.pointerId);
              const onMove = (ev: PointerEvent) => {
                const next = Math.min(
                  SIDE_W_MAX,
                  Math.max(SIDE_W_MIN, startW + (startX - ev.clientX)),
                );
                setSideW(next);
              };
              const onUp = (ev: PointerEvent) => {
                target.releasePointerCapture(ev.pointerId);
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
              };
              window.addEventListener('pointermove', onMove);
              window.addEventListener('pointerup', onUp);
            }}
          />
          {inspectNode ? (
            <div className="arch-node-detail">
              <header className="arch-node-detail-head">
                <div>
                  <p className="arch-node-detail-kicker">{inspectNode.context}</p>
                  <h3 className="arch-node-detail-title">{inspectNode.title}</h3>
                </div>
                <button type="button" className="log-chip" onClick={() => setInspect(null)}>
                  Close
                </button>
              </header>
              <p className="arch-node-detail-blurb">{inspectNode.blurb}</p>
              <p className="arch-note">{inspectNode.about}</p>
              <p className="arch-node-detail-count">
                {pickedLogs.length === 0
                  ? 'No recorded traffic'
                  : `${pickedLogs.length} event${pickedLogs.length === 1 ? '' : 's'} · click to replay`}
              </p>
              <ol className="arch-node-detail-logs">
                {pickedLogs.length === 0 ? (
                  <li className="arch-node-detail-empty">
                    Interact with the product to generate traffic on this component.
                  </li>
                ) : (
                  [...pickedLogs].reverse().map((entry, index) => {
                    const playing = current === entry.key;
                    return (
                      <li key={`${entry.key}:${index}`}>
                        <button
                          type="button"
                          className={`arch-node-detail-row${entry.dir === 'input' ? ' is-response' : ' is-send'}${playing ? ' is-current is-playing' : ''}`}
                          onClick={() => replayStep(entry.key)}
                          aria-label={`Replay ${entry.dir} ${entry.fromTitle} to ${entry.toTitle}`}
                          aria-current={playing ? 'true' : undefined}
                        >
                          <div className="arch-node-detail-meta">
                            <span
                              className={`arch-node-detail-dir${entry.dir === 'input' ? ' is-in' : ' is-out'}`}
                            >
                              {playing
                                ? entry.dir === 'input'
                                  ? 'Receiving'
                                  : 'Sending'
                                : entry.dir === 'input'
                                  ? 'Input'
                                  : 'Output'}
                            </span>
                            <span className="arch-node-detail-kind">{entry.kind}</span>
                            {entry.how ? (
                              <span className="arch-node-detail-element">{entry.how}</span>
                            ) : null}
                            <time dateTime={entry.at}>{formatMiniTime(entry.at)}</time>
                          </div>
                          <p className="arch-node-detail-route">
                            {entry.fromTitle}
                            <span className={`arch-node-detail-arrow${playing ? ' is-playing' : ''}`}>
                              {entry.dir === 'input' ? ' ← ' : ' → '}
                            </span>
                            {entry.toTitle}
                            {entry.message ? ` · ${entry.message}` : ''}
                            {playing ? ' · in transit' : ''}
                          </p>
                          <p className="arch-node-detail-log">{entry.log}</p>
                        </button>
                      </li>
                    );
                  })
                )}
              </ol>
            </div>
          ) : inspectEdge ? (
            <div className="arch-node-detail">
              <header className="arch-node-detail-head">
                <div>
                  <p className="arch-node-detail-kicker">
                    Edge · {HOW_LABEL[inspectEdge.how] ?? inspectEdge.how}
                    {inspectEdge.query ? ' · query' : ''}
                  </p>
                  <h3 className="arch-node-detail-title">{inspectEdge.label}</h3>
                </div>
                <button type="button" className="log-chip" onClick={() => setInspect(null)}>
                  Close
                </button>
              </header>
              <p className="arch-note">{describeEdge(inspectEdge)}</p>
              <p className="arch-node-detail-count">
                {nodeTitle(inspectEdge.from)} → {nodeTitle(inspectEdge.to)}
              </p>
            </div>
          ) : (
            <div className="arch-side-idle">
              <p className="arch-side-idle-title">Details</p>
              <p className="arch-note">Click a node, edge, or edge label on the map to inspect it here.</p>
              <ol className="arch-feed" ref={feedRef}>
                {steps.length === 0 && (
                  <li className="arch-hop empty">Traffic from the app will list here.</li>
                )}
                {steps.map((step) => (
                  <li key={step.key}>
                    <button
                      type="button"
                      className={`arch-hop${current === step.key ? ' is-current' : ''}`}
                      onClick={() => replayStep(step.key)}
                      aria-label={`Replay ${step.element}`}
                    >
                      <p className="arch-hop-action">
                        <time dateTime={step.at}>{formatHopTime(step.at)}</time>
                        <span>{step.service}</span>
                        <span className={step.toUser ? 'arch-hop-dir is-back' : 'arch-hop-dir'}>
                          {step.toUser ? '← Response' : step.kind}
                        </span>
                        <span className="arch-hop-element">{step.element}</span>
                        {current === step.key ? <span>in transit</span> : null}
                      </p>
                      <p className="arch-hop-log">{step.log}</p>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

