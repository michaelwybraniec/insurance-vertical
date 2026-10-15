import { useCallback, useRef, useState } from 'react';
import { api, type CompanyCatalog, type CompanyId } from './api';
import { demoDispatch, sleep, waitForDemo } from './guided-demo-bus';

type Props = {
  companyId: CompanyId;
  catalog: CompanyCatalog | null;
  onHome: () => void;
  onEnrolView: () => void;
  onWidenEvidence: () => void;
  onRefresh: () => Promise<void>;
  onFlash: (msg: string) => void;
  onError: (msg: string | null) => void;
};

type CursorState = {
  x: number;
  y: number;
  visible: boolean;
  clicking: boolean;
  label: string;
};

type Spotlight = { top: number; left: number; width: number; height: number };

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
  const needles = [label.toLowerCase()];
  return (
    [...document.querySelectorAll('button, [role="tab"], [role="button"]')].find((node) => {
      const el = node as HTMLElement;
      if (el.closest('.guided-demo-root')) return false;
      const text = `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      return needles.some((n) => text.includes(n));
    }) ?? null
  ) as HTMLElement | null;
}

function waitForEl(
  finder: () => HTMLElement | null,
  signal: AbortSignal,
  tries = 40,
): Promise<HTMLElement> {
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

function rectOf(el: HTMLElement): Spotlight {
  const r = el.getBoundingClientRect();
  return {
    top: r.top,
    left: r.left,
    width: Math.max(r.width, 8),
    height: Math.max(r.height, 8),
  };
}

export function GuidedDemo({
  companyId,
  onHome,
  onEnrolView,
  onWidenEvidence,
  onRefresh,
  onFlash,
  onError,
}: Props) {
  const [running, setRunning] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);
  const [cursor, setCursor] = useState<CursorState>({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    visible: false,
    clicking: false,
    label: '',
  });
  const [spotlight, setSpotlight] = useState<Spotlight | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cursorPos = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setCaption(null);
    setSpotlight(null);
    setCursor((c) => ({ ...c, visible: false, clicking: false, label: '' }));
    setRunning(false);
  }, []);

  const moveCursorTo = useCallback(
    async (el: HTMLElement, label: string, signal: AbortSignal) => {
      const spot = rectOf(el);
      const x = spot.left + spot.width / 2;
      const y = spot.top + Math.min(spot.height / 2, 28);
      const dx = x - cursorPos.current.x;
      const dy = y - cursorPos.current.y;
      const dist = Math.hypot(dx, dy);
      const duration = Math.min(1100, Math.max(420, dist * 0.55));
      setSpotlight(spot);
      setCursor({ x, y, visible: true, clicking: false, label });
      cursorPos.current = { x, y };
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth', inline: 'nearest' });
      await pause(duration, signal);
    },
    [],
  );

  const clickEl = useCallback(
    async (el: HTMLElement, label: string, signal: AbortSignal) => {
      await moveCursorTo(el, label, signal);
      setCursor((c) => ({ ...c, clicking: true, label }));
      await pause(160, signal);
      el.click();
      await pause(220, signal);
      setCursor((c) => ({ ...c, clicking: false }));
      await pause(280, signal);
    },
    [moveCursorTo],
  );

  const pointAt = useCallback(
    async (el: HTMLElement, label: string, signal: AbortSignal, holdMs = 900) => {
      await moveCursorTo(el, label, signal);
      await pause(holdMs, signal);
    },
    [moveCursorTo],
  );

  const run = useCallback(async () => {
    if (running) return;
    const ac = new AbortController();
    abortRef.current = ac;
    const { signal } = ac;
    setRunning(true);
    onError(null);
    cursorPos.current = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    setCursor({
      x: cursorPos.current.x,
      y: cursorPos.current.y,
      visible: true,
      clicking: false,
      label: 'Starting…',
    });

    try {
      setCaption('1 · Reset demo to a clean seed');
      const resetBtn = queryButton('reset to seed');
      if (resetBtn) await pointAt(resetBtn, 'Reset to seed', signal, 700);
      await api.resetDemo(companyId);
      onHome();
      await onRefresh();
      await pause(500, signal);

      const fresh = await api.getCompany(companyId);
      const employee =
        fresh.employees.find((e) => e.active && e.id === 'emp-a1') ??
        fresh.employees.find((e) => e.active);
      if (!employee || !fresh.plan) {
        throw new Error('No active employee / plan in catalog');
      }

      setCaption(`2 · Click Enrol employee — put ${employee.name} on the mutuelle`);
      const enrolBtn = await waitForEl(() => queryButton('enrol employee'), signal);
      await clickEl(enrolBtn, 'Enrol employee', signal);

      setCaption('3 · Submit enrolment (API returns 202 PendingExternal)');
      const submitBtn = await waitForEl(() => queryButton('submit enrolment'), signal);
      // Prefer real form submit via click so UI + logs stay in sync.
      await clickEl(submitBtn, 'Submit enrolment', signal);

      // If the form/API path failed for any reason, fall back to direct enrol.
      let enrolmentId: string | null = null;
      for (let i = 0; i < 20 && !enrolmentId; i += 1) {
        const list = await api.listEnrolments(companyId, false);
        const pending = list.items.find(
          (e) =>
            e.employeeId === employee.id &&
            (e.status === 'PendingExternal' || e.status === 'Active'),
        );
        if (pending) enrolmentId = pending.enrolmentId;
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

      setCaption('4 · Waiting on carrier stub — Pending → Covered');
      onHome();
      await waitUntilActive(companyId, enrolmentId, signal);
      await onRefresh();
      await pause(600, signal);
      const covered = [...document.querySelectorAll('.person-card, .status')].find((n) =>
        /covered/i.test(n.textContent ?? ''),
      ) as HTMLElement | undefined;
      if (covered) await pointAt(covered, 'Covered', signal, 1000);

      setCaption('5 · Enlarge Architecture column');
      const resizer = document.querySelector('.workspace-resizer') as HTMLElement | null;
      if (resizer) await pointAt(resizer, 'Widen evidence', signal, 600);
      onWidenEvidence();
      await pause(800, signal);

      setCaption('6 · Open Architecture tab');
      const archTab = await waitForEl(() => queryButton('architecture'), signal);
      await clickEl(archTab, 'Architecture', signal);
      await pause(700, signal);

      setCaption('7 · Play — packet hops Insurance → carrier → payroll');
      const playBtn = await waitForEl(
        () =>
          (document.querySelector('.arch-player-btn[aria-label="Play"]') as HTMLElement | null) ??
          queryButton('play'),
        signal,
      );
      // Cursor click animation + start play at 2× (avoid double-triggering Play).
      await moveCursorTo(playBtn, 'Play', signal);
      setCursor((c) => ({ ...c, clicking: true, label: 'Play' }));
      await pause(160, signal);
      demoDispatch({ type: 'arch-play', rate: 2 });
      await pause(220, signal);
      setCursor((c) => ({ ...c, clicking: false }));
      await Promise.race([
        waitForDemo('arch-idle', 180_000),
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
            once: true,
          });
        }),
      ]);
      await pause(600, signal);

      setCaption('8 · Logs — open EnrolEmployee detail');
      const railLogs = await waitForEl(
        () =>
          ([...document.querySelectorAll('.log-tabs [role="tab"]')].find((n) =>
            /^logs$/i.test((n.textContent ?? '').trim()),
          ) as HTMLElement | null),
        signal,
      );
      await clickEl(railLogs, 'Logs', signal);
      await pause(500, signal);
      const enrolLog = await waitForEl(
        () =>
          ([...document.querySelectorAll('.dev-line')].find((n) =>
            /EnrolEmployee/i.test(n.textContent ?? ''),
          ) as HTMLElement | null),
        signal,
      );
      await clickEl(enrolLog, 'EnrolEmployee log', signal);
      await pause(2200, signal);

      setCaption('9 · Logs — PendingExternal → Active (carrier confirm)');
      const activeLog = await waitForEl(
        () =>
          ([...document.querySelectorAll('.dev-line')].find((n) =>
            /PendingExternal → Active/i.test(n.textContent ?? ''),
          ) as HTMLElement | null),
        signal,
      );
      await clickEl(activeLog, 'Activate log', signal);
      await pause(2200, signal);

      setCaption('10 · Logs — PremiumInstructionIssued');
      const premiumLog = await waitForEl(
        () =>
          ([...document.querySelectorAll('.dev-line')].find((n) =>
            /PremiumInstructionIssued/i.test(n.textContent ?? ''),
          ) as HTMLElement | null),
        signal,
      );
      await clickEl(premiumLog, 'Premium log', signal);
      await pause(2200, signal);

      setCaption('Done — enrol → wait → covered → payslip. Explore freely.');
      const archAgain = queryButton('architecture');
      if (archAgain) await clickEl(archAgain, 'Architecture', signal);
      onFlash('Guided demo finished — follow the cursor next time, or explore freely.');
      await pause(2800, signal);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        onFlash('Guided demo stopped.');
      } else {
        const message = err instanceof Error ? err.message : String(err);
        onError(message);
        setCaption(`Stopped: ${message}`);
        await sleep(2400);
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setCaption(null);
      setSpotlight(null);
      setCursor((c) => ({ ...c, visible: false, clicking: false, label: '' }));
      setRunning(false);
    }
  }, [
    running,
    companyId,
    onHome,
    onEnrolView,
    onWidenEvidence,
    onRefresh,
    onFlash,
    onError,
    clickEl,
    pointAt,
    moveCursorTo,
  ]);

  return (
    <div className="guided-demo-root">
      {!running && (
        <button type="button" className="guided-demo-launch" onClick={() => void run()}>
          <span className="guided-demo-kicker">Interactive demo</span>
          <span className="guided-demo-title">Start guided tour</span>
          <span className="guided-demo-sub">
            A cursor will click Enrol → Architecture Play → Logs for you
          </span>
        </button>
      )}

      {running && (
        <>
          <div className="guided-demo-veil" aria-hidden />
          {spotlight && (
            <div
              className="guided-demo-spotlight"
              style={{
                top: spotlight.top - 6,
                left: spotlight.left - 6,
                width: spotlight.width + 12,
                height: spotlight.height + 12,
              }}
            />
          )}
          {cursor.visible && (
            <div
              className={`guided-demo-cursor${cursor.clicking ? ' is-clicking' : ''}`}
              style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
              aria-hidden
            >
              <svg className="guided-demo-cursor-svg" width="28" height="28" viewBox="0 0 24 24">
                <path
                  d="M5 3l1.5 16.5L11 14l3.5 7 2-1-3.5-7H19L5 3z"
                  fill="#0f766e"
                  stroke="#ecfdf5"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
              {cursor.clicking && <span className="guided-demo-click-ripple" />}
              {cursor.label && <span className="guided-demo-cursor-label">{cursor.label}</span>}
            </div>
          )}
        </>
      )}

      {caption && (
        <div className="guided-demo-caption" role="status" aria-live="polite">
          <span className="guided-demo-caption-kicker">{running ? 'Tour' : 'Demo'}</span>
          <p>{caption}</p>
          {running && (
            <button type="button" className="guided-demo-skip" onClick={stop}>
              Stop
            </button>
          )}
        </div>
      )}
    </div>
  );
}
