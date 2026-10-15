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
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setCaption(null);
    setRunning(false);
  }, []);

  const run = useCallback(async () => {
    if (running) return;
    const ac = new AbortController();
    abortRef.current = ac;
    const { signal } = ac;
    setRunning(true);
    onError(null);
    try {
      setCaption('Resetting to a clean seed…');
      await api.resetDemo(companyId);
      onHome();
      await onRefresh();
      await pause(600, signal);

      const fresh = await api.getCompany(companyId);
      const employee =
        fresh.employees.find((e) => e.active && e.id === 'emp-a1') ??
        fresh.employees.find((e) => e.active);
      if (!employee || !fresh.plan) {
        throw new Error('No active employee / plan in catalog');
      }

      setCaption(`Opening Enrol — we’ll put ${employee.name} on Santé Base…`);
      onEnrolView();
      await pause(1400, signal);

      setCaption('Submitting EnrolEmployee (PendingExternal · 202)…');
      const { enrolmentId } = await api.enrol(
        companyId,
        {
          employeeId: employee.id,
          planId: fresh.plan.id,
          coverage: 'collective',
          effectiveFrom: '2026-04-01',
        },
        `guided-demo-${companyId}-${employee.id}-${Date.now()}`,
      );
      await pause(800, signal);

      setCaption('Waiting on the carrier stub (Alan/AXA) — Pending → Active…');
      onHome();
      await waitUntilActive(companyId, enrolmentId, signal);
      await onRefresh();
      await pause(700, signal);

      setCaption('Enlarging the Architecture column…');
      onWidenEvidence();
      await pause(700, signal);

      setCaption('Architecture map — every hop from the Logs…');
      demoDispatch({ type: 'rail-tab', tab: 'architecture' });
      await pause(1200, signal);

      setCaption('Play — watch the packet cross Insurance → carrier → payroll…');
      demoDispatch({ type: 'arch-play', rate: 2 });
      await Promise.race([
        waitForDemo('arch-idle', 180_000),
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
            once: true,
          });
        }),
      ]);
      await pause(800, signal);

      setCaption('Logs — opening EnrolEmployee…');
      demoDispatch({ type: 'rail-tab', tab: 'dev' });
      await pause(500, signal);
      demoDispatch({ type: 'open-log-match', match: 'EnrolEmployee' });
      await pause(2800, signal);

      setCaption('Logs — carrier confirm (PendingExternal → Active)…');
      demoDispatch({ type: 'open-log-match', match: 'PendingExternal → Active' });
      await pause(2800, signal);

      setCaption('Logs — PremiumInstructionIssued / payroll…');
      demoDispatch({ type: 'open-log-match', match: 'PremiumInstructionIssued' });
      await pause(2800, signal);

      demoDispatch({ type: 'rail-tab', tab: 'architecture' });
      setCaption('Done — that’s enrol → wait → covered → payslip. Explore freely.');
      onFlash('Guided demo finished — Architecture + Logs are populated.');
      await pause(3200, signal);
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
      setRunning(false);
    }
  }, [running, companyId, onHome, onEnrolView, onWidenEvidence, onRefresh, onFlash, onError]);

  return (
    <>
      {!running && (
        <button type="button" className="guided-demo-launch" onClick={() => void run()}>
          <span className="guided-demo-kicker">Demo</span>
          <span className="guided-demo-title">Run guided tour</span>
          <span className="guided-demo-sub">Enrol → Architecture play → log details</span>
        </button>
      )}
      {caption && (
        <div className="guided-demo-caption" role="status" aria-live="polite">
          <span className="guided-demo-caption-kicker">{running ? 'Playing' : 'Demo'}</span>
          <p>{caption}</p>
          {running && (
            <button type="button" className="guided-demo-skip" onClick={stop}>
              Stop
            </button>
          )}
        </div>
      )}
      {running && <div className="guided-demo-veil" aria-hidden />}
    </>
  );
}
