import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type CompanyCatalog, type CompanyId } from './api';
import { demoDispatch, sleep, waitForDemo } from './guided-demo-bus';

const AUTO_START_SEC = 5;

type Props = {
  companyId: CompanyId;
  catalog: CompanyCatalog | null;
  onHome: () => void;
  onDocs: () => void;
  onEnrolView: () => void;
  onCollapseEvidence: () => void;
  onSplitEvidence: () => void;
  onRefresh: () => Promise<void>;
  onFlash: (msg: string) => void;
  onError: (msg: string | null) => void;
};

type CursorState = {
  x: number;
  y: number;
  visible: boolean;
  clicking: boolean;
};

/**
 * Docs pages after Start (01) — the deck already opens on slide 1.
 * Short flash explainers while we flip quickly.
 */
const DOC_BEATS: Array<{ label: string; flash: string }> = [
  {
    label: 'architecture',
    flash: 'Docs 02 · Architecture — five zones from Cover to carrier / payroll',
  },
  {
    label: 'statuses',
    flash: 'Docs 03 · Statuses — FSM honesty: never invent Active',
  },
  {
    label: 'guarantees',
    flash: 'Docs 04 · Guarantees — idempotency, tenancy, outbox, ACL',
  },
  {
    label: 'scope',
    flash: 'Docs 05 · Scope — built for real vs seed vs out of preview',
  },
  {
    label: 'edges',
    flash: 'Docs 06 · Edges — double-click, wrong company, insurer down…',
  },
  {
    label: 'in cover',
    flash: 'Docs 07 · In Cover — what you can try next in the live UI',
  },
];

async function waitUntilActive(
  companyId: string,
  enrolmentId: string,
  signal: AbortSignal,
): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const row = await api.getEnrolment(companyId, enrolmentId);
    if (row.status === 'Active') return;
    if (row.status === 'Failed' || row.status === 'Ended') {
      throw new Error(`Enrolment ended as ${row.status} before Covered`);
    }
    await sleep(400);
  }
  throw new Error('Timed out waiting for Covered');
}

async function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  await sleep(ms);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
}

function queryButton(label: string): HTMLElement | null {
  return (
    ([...document.querySelectorAll('button, [role="tab"], [role="button"]')].find((node) => {
      const el = node as HTMLElement;
      if (el.closest('.guided-demo-root')) return false;
      const text = `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      return text.includes(label.toLowerCase());
    }) as HTMLElement | undefined) ?? null
  );
}

function waitForEl(
  finder: () => Element | null,
  signal: AbortSignal,
  tries = 50,
): Promise<Element> {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = () => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const el = finder();
      if (el) {
        resolve(el);
        return;
      }
      n += 1;
      if (n >= tries) {
        reject(new Error('Could not find UI target for guided demo'));
        return;
      }
      window.setTimeout(tick, 120);
    };
    tick();
  });
}

export function GuidedDemo({
  companyId,
  onHome,
  onDocs,
  onCollapseEvidence,
  onSplitEvidence,
  onRefresh,
  onFlash,
  onError,
}: Props) {
  const [running, setRunning] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_START_SEC);
  const [cursor, setCursor] = useState<CursorState>({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    visible: false,
    clicking: false,
  });
  const abortRef = useRef<AbortController | null>(null);
  const cursorPos = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const startedRef = useRef(false);
  const autoUsedRef = useRef(false);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setCursor((c) => ({ ...c, visible: false, clicking: false }));
    setRunning(false);
  }, []);

  const moveCursorTo = useCallback(async (el: Element, signal: AbortSignal, pace: 'normal' | 'fast' = 'normal') => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + Math.min(r.height / 2, 22);
    const dist = Math.hypot(x - cursorPos.current.x, y - cursorPos.current.y);
    const duration =
      pace === 'fast'
        ? Math.min(280, Math.max(90, dist * 0.22))
        : Math.min(850, Math.max(280, dist * 0.48));
    el.scrollIntoView({ block: 'nearest', behavior: pace === 'fast' ? 'auto' : 'smooth', inline: 'nearest' });
    setCursor({ x, y, visible: true, clicking: false });
    cursorPos.current = { x, y };
    await pause(duration, signal);
  }, []);

  const clickEl = useCallback(
    async (el: Element, signal: AbortSignal, pace: 'normal' | 'fast' = 'normal') => {
      await moveCursorTo(el, signal, pace);
      setCursor((c) => ({ ...c, clicking: true }));
      await pause(pace === 'fast' ? 60 : 130, signal);
      if (typeof (el as HTMLElement).click === 'function') {
        (el as HTMLElement).click();
      } else {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }
      await pause(pace === 'fast' ? 70 : 160, signal);
      setCursor((c) => ({ ...c, clicking: false }));
      await pause(pace === 'fast' ? 40 : 200, signal);
    },
    [moveCursorTo],
  );

  const run = useCallback(async () => {
    if (running || startedRef.current) return;
    startedRef.current = true;
    autoUsedRef.current = true;
    const ac = new AbortController();
    abortRef.current = ac;
    const { signal } = ac;
    setRunning(true);
    setCountdown(0);
    onError(null);
    cursorPos.current = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    setCursor({
      x: cursorPos.current.x,
      y: cursorPos.current.y,
      visible: true,
      clicking: false,
    });

    try {
      // —— Docs deck first (already on 01 Start — flip 02→07 quickly) ——
      onCollapseEvidence();
      onFlash('Docs 01 · Start — flipping 02→07…');
      const docsNav = await waitForEl(() => queryButton('docs'), signal);
      await clickEl(docsNav, signal, 'fast');
      onDocs();
      await pause(180, signal);

      for (const beat of DOC_BEATS) {
        onFlash(beat.flash);
        const pageBtn = await waitForEl(() => {
          const buttons = [...document.querySelectorAll('.guide-page-btn')];
          return (
            (buttons.find((n) => {
              const title = n.querySelector('.guide-page-title')?.textContent?.trim().toLowerCase();
              return title === beat.label;
            }) as HTMLElement | undefined) ?? null
          );
        }, signal);
        await clickEl(pageBtn, signal, 'fast');
        await pause(200, signal);
      }

      // —— Cover: enrol ——
      onFlash('Switching to Cover — enrol someone…');
      await clickEl(await waitForEl(() => queryButton('cover'), signal), signal);
      onHome();
      onCollapseEvidence();
      await api.resetDemo(companyId);
      await onRefresh();
      await pause(500, signal);

      const fresh = await api.getCompany(companyId);
      const employee =
        fresh.employees.find((e) => e.active && e.id === 'emp-a1') ??
        fresh.employees.find((e) => e.active);
      if (!employee || !fresh.plan) {
        throw new Error('No active employee / plan in catalog');
      }

      onFlash(`Enrol ${employee.name} on Santé Base…`);
      await clickEl(await waitForEl(() => queryButton('enrol employee'), signal), signal);
      onFlash('Submit enrolment → PendingExternal (202)…');
      await clickEl(await waitForEl(() => queryButton('submit enrolment'), signal), signal);

      let enrolmentId: string | null = null;
      for (let i = 0; i < 20 && !enrolmentId; i += 1) {
        const list = await api.listEnrolments(companyId, false);
        const row = list.items.find(
          (e) =>
            e.employeeId === employee.id &&
            (e.status === 'PendingExternal' || e.status === 'Active'),
        );
        if (row) enrolmentId = row.enrolmentId;
        else await pause(200, signal);
      }
      if (!enrolmentId) {
        const created = await api.enrol(
          companyId,
          {
            employeeId: employee.id,
            planId: fresh.plan.id,
            coverage: 'collective',
            effectiveFrom: '2026-04-01',
          },
          `guided-demo-${companyId}-${employee.id}-${Date.now()}`,
        );
        enrolmentId = created.enrolmentId;
      }

      onFlash('Waiting on carrier — Pending → Covered…');
      onHome();
      await waitUntilActive(companyId, enrolmentId, signal);
      await onRefresh();
      await pause(700, signal);

      const covered = [...document.querySelectorAll('.person-card')].find((n) =>
        /covered/i.test(n.textContent ?? ''),
      ) as HTMLElement | undefined;
      if (covered) {
        await moveCursorTo(covered, signal);
        await pause(800, signal);
      }

      // —— Split view: Cover stays visible; Architecture gets more width ——
      onFlash('Opening Architecture beside Cover…');
      onSplitEvidence();
      await pause(500, signal);
      const archTab = await waitForEl(
        () =>
          ([...document.querySelectorAll('.log-tabs [role="tab"]')].find((n) =>
            /^architecture$/i.test((n.textContent ?? '').trim()),
          ) as HTMLElement | null),
        signal,
      );
      await moveCursorTo(archTab, signal);
      setCursor((c) => ({ ...c, clicking: true }));
      await pause(130, signal);
      demoDispatch({ type: 'rail-tab', tab: 'architecture' });
      await pause(160, signal);
      setCursor((c) => ({ ...c, clicking: false }));
      await waitForEl(
        () => document.querySelector('.arch-edge[data-id="e-command"]') as Element | null,
        signal,
        60,
      );
      await pause(400, signal);

      onFlash('Zoom in on the flow…');
      demoDispatch({ type: 'arch-zoom', factor: 1.45 });
      await pause(650, signal);

      // SVG nodes use d3-drag (not click) — ImpulseRail holds inspect intent so the
      // details panel opens even if ArchitectureMap mounted a tick late.
      onFlash('Inspect a hop — command edge (UI → API)…');
      const edge = await waitForEl(
        () => document.querySelector('.arch-edge[data-id="e-command"]') as Element | null,
        signal,
      );
      await moveCursorTo(edge, signal);
      setCursor((c) => ({ ...c, clicking: true }));
      await pause(130, signal);
      demoDispatch({ type: 'arch-inspect-edge', edgeId: 'e-command' });
      await waitForEl(
        () => document.querySelector('.arch-side[data-arch-inspect="edge:e-command"]') as Element | null,
        signal,
        40,
      );
      await pause(160, signal);
      setCursor((c) => ({ ...c, clicking: false }));
      await pause(1200, signal);

      onFlash('Inspect a node — Insurance API…');
      const node = await waitForEl(
        () => document.querySelector('.arch-node[data-id="api"]') as Element | null,
        signal,
      );
      await moveCursorTo(node, signal);
      setCursor((c) => ({ ...c, clicking: true }));
      await pause(130, signal);
      demoDispatch({ type: 'arch-inspect-node', nodeId: 'api' });
      await waitForEl(
        () => document.querySelector('.arch-side[data-arch-inspect="node:api"]') as Element | null,
        signal,
        40,
      );
      await pause(160, signal);
      setCursor((c) => ({ ...c, clicking: false }));
      await pause(1100, signal);

      onFlash('Open a log on that node…');
      const nodeLog = await waitForEl(
        () =>
          (document.querySelector(
            '.arch-node[data-id="api"] .arch-node-log-line, .arch-node.is-expanded .arch-node-log-line',
          ) as Element | null) ??
          (document.querySelector('.arch-node-log-line') as Element | null),
        signal,
        40,
      ).catch(() => null);
      if (nodeLog) {
        await moveCursorTo(nodeLog, signal);
        setCursor((c) => ({ ...c, clicking: true }));
        await pause(130, signal);
        demoDispatch({ type: 'arch-replay-log', nodeId: 'api' });
        await pause(160, signal);
        setCursor((c) => ({ ...c, clicking: false }));
        await pause(1200, signal);
      } else {
        // Enrol already filled the story — replay even if the mini-log DOM lagged.
        await moveCursorTo(node, signal);
        setCursor((c) => ({ ...c, clicking: true }));
        await pause(130, signal);
        demoDispatch({ type: 'arch-replay-log', nodeId: 'api' });
        await pause(160, signal);
        setCursor((c) => ({ ...c, clicking: false }));
        await pause(900, signal);
      }

      const playBtn = await waitForEl(
        () => document.querySelector('.arch-player-btn[aria-label="Play"]') as HTMLElement | null,
        signal,
      );
      await moveCursorTo(playBtn, signal);
      setCursor((c) => ({ ...c, clicking: true }));
      await pause(130, signal);
      demoDispatch({ type: 'arch-play', rate: 2 });
      await pause(160, signal);
      setCursor((c) => ({ ...c, clicking: false }));

      onFlash('Architecture play — hops across Insurance → carrier → payroll…');
      await Promise.race([
        waitForDemo('arch-idle', 180_000),
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
            once: true,
          });
        }),
      ]);

      onFlash('Logs beside Cover — EnrolEmployee…');
      await clickEl(
        await waitForEl(
          () =>
            ([...document.querySelectorAll('.log-tabs [role="tab"]')].find((n) =>
              /^logs$/i.test((n.textContent ?? '').trim()),
            ) as HTMLElement | null),
          signal,
        ),
        signal,
      );
      await clickEl(
        await waitForEl(
          () =>
            ([...document.querySelectorAll('.dev-line')].find((n) =>
              /EnrolEmployee/i.test(n.textContent ?? ''),
            ) as HTMLElement | null),
          signal,
        ),
        signal,
      );
      await pause(1800, signal);

      onFlash('Logs — PendingExternal → Active…');
      await clickEl(
        await waitForEl(
          () =>
            ([...document.querySelectorAll('.dev-line')].find((n) =>
              /PendingExternal → Active/i.test(n.textContent ?? ''),
            ) as HTMLElement | null),
          signal,
        ),
        signal,
      );
      await pause(1800, signal);

      onFlash('Logs — PremiumInstructionIssued…');
      await clickEl(
        await waitForEl(
          () =>
            ([...document.querySelectorAll('.dev-line')].find((n) =>
              /PremiumInstructionIssued/i.test(n.textContent ?? ''),
            ) as HTMLElement | null),
          signal,
        ),
        signal,
      );
      await pause(1800, signal);

      const archTabAgain = [...document.querySelectorAll('.log-tabs [role="tab"]')].find((n) =>
        /^architecture$/i.test((n.textContent ?? '').trim()),
      ) as HTMLElement | undefined;
      if (archTabAgain) await clickEl(archTabAgain, signal);

      onFlash('Tour done — Docs → enrol → Covered → Architecture/Logs. Explore freely.');
      await pause(2400, signal);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        onFlash('Guided tour stopped.');
      } else {
        const message = err instanceof Error ? err.message : String(err);
        onError(message);
        await sleep(1600);
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setCursor((c) => ({ ...c, visible: false, clicking: false }));
      setRunning(false);
      startedRef.current = false;
    }
  }, [
    running,
    companyId,
    onHome,
    onDocs,
    onCollapseEvidence,
    onSplitEvidence,
    onRefresh,
    onFlash,
    onError,
    clickEl,
    moveCursorTo,
  ]);

  const runRef = useRef(run);
  runRef.current = run;

  // Auto-start once after AUTO_START_SEC unless the visitor clicks sooner.
  useEffect(() => {
    if (running || autoUsedRef.current) return;
    setCountdown(AUTO_START_SEC);
    const startedAt = Date.now();
    const tick = window.setInterval(() => {
      if (autoUsedRef.current) {
        window.clearInterval(tick);
        return;
      }
      const left = Math.max(
        0,
        AUTO_START_SEC - Math.floor((Date.now() - startedAt) / 1000),
      );
      setCountdown(left);
      if (left <= 0) {
        window.clearInterval(tick);
        autoUsedRef.current = true;
        void runRef.current();
      }
    }, 250);
    return () => window.clearInterval(tick);
  }, [running]);

  return (
    <div className="guided-demo-root">
      {!running && (
        <div className="guided-demo-hero">
          <p className="guided-demo-hello">Hello</p>
          <h2 className="guided-demo-hero-title">MutuelleFit guided tour</h2>
          <p className="guided-demo-hero-lead">
            A cursor will walk the product for you: flip the Docs slides, enrol an employee until
            Covered, then play Architecture and open a few Logs — so you see enrol → wait → payslip
            without guessing where to click.
          </p>
          <button type="button" className="btn guided-demo-launch" onClick={() => void run()}>
            Start guided tour
          </button>
          <p className="guided-demo-auto" aria-live="polite">
            Starts automatically in <strong>{countdown}s</strong>
          </p>
        </div>
      )}

      {running && (
        <>
          {cursor.visible && (
            <div
              className={`guided-demo-cursor${cursor.clicking ? ' is-clicking' : ''}`}
              style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
              aria-hidden
            >
              <svg width="48" height="48" viewBox="0 0 24 24">
                <path
                  d="M5 3l1.5 16.5L11 14l3.5 7 2-1-3.5-7H19L5 3z"
                  fill="var(--ink)"
                  stroke="#f6faf8"
                  strokeWidth="1.1"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          )}
          <button type="button" className="btn secondary compact guided-demo-stop" onClick={stop}>
            Stop tour
          </button>
        </>
      )}
    </div>
  );
}
