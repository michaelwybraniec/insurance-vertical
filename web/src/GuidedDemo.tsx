import { useCallback, useRef, useState } from 'react';
import { api, type CompanyCatalog, type CompanyId } from './api';
import { demoDispatch, sleep, waitForDemo } from './guided-demo-bus';

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

/** Short explainers shown in the app flash while Docs pages flip. */
const DOC_BEATS: Array<{ label: string; flash: string }> = [
  {
    label: 'start',
    flash: 'Docs 01 · Start — enrol is async: 202 PendingExternal before Covered',
  },
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
  finder: () => HTMLElement | null,
  signal: AbortSignal,
  tries = 50,
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
  const [cursor, setCursor] = useState<CursorState>({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    visible: false,
    clicking: false,
  });
  const abortRef = useRef<AbortController | null>(null);
  const cursorPos = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setCursor((c) => ({ ...c, visible: false, clicking: false }));
    setRunning(false);
  }, []);

  const moveCursorTo = useCallback(async (el: HTMLElement, signal: AbortSignal) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + Math.min(r.height / 2, 22);
    const dist = Math.hypot(x - cursorPos.current.x, y - cursorPos.current.y);
    const duration = Math.min(850, Math.max(280, dist * 0.48));
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth', inline: 'nearest' });
    setCursor({ x, y, visible: true, clicking: false });
    cursorPos.current = { x, y };
    await pause(duration, signal);
  }, []);

  const clickEl = useCallback(
    async (el: HTMLElement, signal: AbortSignal) => {
      await moveCursorTo(el, signal);
      setCursor((c) => ({ ...c, clicking: true }));
      await pause(130, signal);
      el.click();
      await pause(160, signal);
      setCursor((c) => ({ ...c, clicking: false }));
      await pause(200, signal);
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
    });

    try {
      // —— Docs deck first (quick flip + explain) ——
      onCollapseEvidence();
      onFlash('Guided tour — opening Docs…');
      const docsNav = await waitForEl(() => queryButton('docs'), signal);
      await clickEl(docsNav, signal);
      onDocs();
      await pause(700, signal);

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
        await clickEl(pageBtn, signal);
        await pause(1150, signal);
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

      // —— Split view: Cover stays visible beside Architecture / Logs ——
      onFlash('Opening Architecture beside Cover…');
      onSplitEvidence();
      await pause(550, signal);
      await clickEl(
        await waitForEl(
          () =>
            ([...document.querySelectorAll('.log-tabs [role="tab"]')].find((n) =>
              /^architecture$/i.test((n.textContent ?? '').trim()),
            ) as HTMLElement | null),
          signal,
        ),
        signal,
      );
      await pause(500, signal);

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

      const archTab = [...document.querySelectorAll('.log-tabs [role="tab"]')].find((n) =>
        /^architecture$/i.test((n.textContent ?? '').trim()),
      ) as HTMLElement | undefined;
      if (archTab) await clickEl(archTab, signal);

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

  return (
    <div className="guided-demo-root">
      {!running && (
        <button type="button" className="btn guided-demo-launch" onClick={() => void run()}>
          Start guided tour
        </button>
      )}

      {running && (
        <>
          {cursor.visible && (
            <div
              className={`guided-demo-cursor${cursor.clicking ? ' is-clicking' : ''}`}
              style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
              aria-hidden
            >
              <svg width="22" height="22" viewBox="0 0 24 24">
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
