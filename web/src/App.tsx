import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type AuditEntry,
  type CompanyCatalog,
  type CompanyId,
  type EnrolmentView,
  type PayrollLine,
} from './api';
import { GlassSelect } from './GlassSelect';
import { HowItWorks } from './HowItWorks';
import { ImpulseRail } from './ImpulseRail';

const EVIDENCE_WIDTH_KEY = 'payfit-mutuelle-evidence-width';
const EVIDENCE_WIDTH_DEFAULT = 420;
/** Only keeps layout from going negative / past the workspace — no soft max left/right. */
const RESIZER_GAP_PX = 8;

function readEvidenceWidth(): number {
  try {
    const raw = localStorage.getItem(EVIDENCE_WIDTH_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 0) return n;
  } catch {
    /* ignore */
  }
  return EVIDENCE_WIDTH_DEFAULT;
}

function useEvidenceResize(workspaceRef: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(readEvidenceWidth);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const clampToWorkspace = useCallback(
    (next: number) => {
      const workspace = workspaceRef.current;
      const max = workspace
        ? Math.max(0, workspace.clientWidth - RESIZER_GAP_PX)
        : Number.POSITIVE_INFINITY;
      return Math.min(max, Math.max(0, next));
    },
    [workspaceRef],
  );

  useEffect(() => {
    try {
      localStorage.setItem(EVIDENCE_WIDTH_KEY, String(width));
    } catch {
      /* ignore */
    }
  }, [width]);

  useEffect(() => {
    const onWindowResize = () => {
      setWidth((w) => clampToWorkspace(w));
    };
    window.addEventListener('resize', onWindowResize);
    onWindowResize();
    return () => window.removeEventListener('resize', onWindowResize);
  }, [clampToWorkspace]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      // Edge left → wider Evidence; edge right → more app space. No soft min/max.
      const next = drag.startWidth + (drag.startX - e.clientX);
      setWidth(clampToWorkspace(next));
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.classList.remove('is-resizing-evidence');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [clampToWorkspace]);

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: width };
      document.body.classList.add('is-resizing-evidence');
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [width],
  );

  const nudgeWidth = useCallback(
    (delta: number) => {
      setWidth((w) => clampToWorkspace(w + delta));
    },
    [clampToWorkspace],
  );

  const setEvidenceWidth = useCallback(
    (next: number) => {
      setWidth(clampToWorkspace(next));
    },
    [clampToWorkspace],
  );

  const maxWidth = workspaceRef.current
    ? Math.max(0, workspaceRef.current.clientWidth - RESIZER_GAP_PX)
    : undefined;

  return { width, maxWidth, onResizePointerDown, nudgeWidth, setEvidenceWidth };
}

type View =
  | { name: 'home' }
  | { name: 'enrol' }
  | { name: 'dispense' }
  | { name: 'detail'; enrolmentId: string }
  | { name: 'my-cover' }
  | { name: 'guide' };

type StepTone = 'todo' | 'done' | 'current' | 'fail' | 'skip';

type ProcessStep = {
  id: string;
  title: string;
  description: string;
  tone: StepTone;
};

function periodLabel(e: EnrolmentView): string {
  if (e.lastPremium?.periodFrom) return e.lastPremium.periodFrom.slice(0, 7);
  if (e.status === 'Active') return e.effectiveFrom.slice(0, 7);
  return '—';
}

function employeeName(catalog: CompanyCatalog | null, employeeId: string): string {
  return catalog?.employees.find((e) => e.id === employeeId)?.name ?? employeeId;
}

function companySelectLabel(id: CompanyId): string {
  return id === 'company-a' ? 'Company 1 · Alan' : 'Company 2 · AXA';
}

function companyDisplayName(catalog: CompanyCatalog | null, companyId: CompanyId): string {
  return catalog?.name ?? (companyId === 'company-a' ? 'Company 1' : 'Company 2');
}

function statusLabel(status: string): string {
  switch (status) {
    case 'PendingExternal':
      return 'Waiting on carrier';
    case 'Active':
      return 'Covered';
    case 'Failed':
      return 'Failed';
    case 'Dispensed':
      return 'Exempt (dispense)';
    case 'Ended':
      return 'Ended';
    default:
      return status;
  }
}

function statusHint(status: string, pendingAge?: number | null): string {
  if (status === 'PendingExternal') {
    const age = pendingAge != null ? ` · ${pendingAge}s` : '';
    return `Not covered yet — asking the insurer to create membership${age}`;
  }
  if (status === 'Failed') return 'Insurer could not affiliate them — enrol again to retry';
  if (status === 'Dispensed') return 'Legal exemption — no premiums on the payslip';
  if (status === 'Ended') return 'Cover stopped (cancelled or employee left)';
  if (status === 'Active') return 'On the plan — premiums can appear on the payslip';
  return '';
}

function nextStep(status: string): string {
  if (status === 'PendingExternal') return 'Nothing to click — this list updates live';
  if (status === 'Active') return 'Check Payslip preview below, or cancel / simulate leaving';
  if (status === 'Failed') return 'Enrol again with a fresh attempt';
  if (status === 'Dispensed') return 'Open for the exemption reason in the audit';
  if (status === 'Ended') return 'Re-enrol if they need cover again';
  return 'Open';
}

/** Build the live process steps for one enrolment (UI, not Mermaid). */
function processSteps(status: string, hasPremium: boolean): ProcessStep[] {
  if (status === 'Dispensed') {
    return [
      {
        id: 'dispense',
        title: 'Dispense recorded',
        description:
          'HR filed a legal exemption instead of joining the company plan (e.g. already covered elsewhere).',
        tone: 'done',
      },
      {
        id: 'no-insurer',
        title: 'No insurer call',
        description: 'We do not ask Alan or AXA to create a membership for this person.',
        tone: 'skip',
      },
      {
        id: 'exempt',
        title: 'Exempt',
        description: 'Compliant out of the collective plan. No employer/employee Santé lines on the payslip.',
        tone: 'current',
      },
    ];
  }

  if (status === 'Failed') {
    return [
      {
        id: 'enrol',
        title: 'HR enrolled',
        description: 'Request was accepted by PayFit Insurance.',
        tone: 'done',
      },
      {
        id: 'wait',
        title: 'Asked the insurer',
        description: 'We tried to create membership with the carrier.',
        tone: 'done',
      },
      {
        id: 'fail',
        title: 'Failed',
        description:
          'The insurer rejected the request, or transport retries ran out (after 3 attempts). Enrol again to start a new journey.',
        tone: 'fail',
      },
    ];
  }

  const waitTone: StepTone = status === 'PendingExternal' ? 'current' : 'done';
  const coverTone: StepTone =
    status === 'PendingExternal'
      ? 'todo'
      : status === 'Active' && !hasPremium
        ? 'current'
        : 'done';
  const payTone: StepTone =
    status === 'Ended'
      ? 'done'
      : hasPremium && status === 'Active'
        ? 'current'
        : status === 'Active'
          ? 'todo'
          : 'todo';

  const steps: ProcessStep[] = [
    {
      id: 'enrol',
      title: 'HR enrolled',
      description:
        'You (or HR) submitted enrol. PayFit accepted immediately — cover is not active yet.',
      tone: 'done',
    },
    {
      id: 'wait',
      title: 'Waiting on insurer',
      description:
        status === 'PendingExternal'
          ? 'A background job is asking the carrier (Alan/AXA) to create membership. This page refreshes until they answer.'
          : 'The insurer confirmed membership successfully.',
      tone: waitTone,
    },
    {
      id: 'cover',
      title: 'Covered',
      description:
        status === 'Active' || status === 'Ended'
          ? 'They are affiliated on the collective mutuelle plan.'
          : 'Happens only after the insurer confirms — not before.',
      tone: coverTone,
    },
    {
      id: 'pay',
      title: 'On the payslip',
      description: hasPremium
        ? 'Insurance sent monthly amounts to Payroll: employer share (patronale) + employee share (salariale).'
        : 'After Covered, two Santé lines appear in Payslip preview below.',
      tone: payTone,
    },
  ];

  if (status === 'Ended') {
    steps.push({
      id: 'end',
      title: 'Cover ended',
      description:
        'Cancelled by HR or the employee left. Membership stopped; any payslip lines were stopped too.',
      tone: 'current',
    });
  }

  return steps;
}

function ProcessTrack({
  status,
  hasPremium,
  title = 'Where they are in the process',
  compact = false,
}: {
  status: string;
  hasPremium: boolean;
  title?: string;
  compact?: boolean;
}) {
  const steps = processSteps(status, hasPremium);
  const current = steps.find((s) => s.tone === 'current' || s.tone === 'fail');

  return (
    <div className={`process-track ${compact ? 'compact' : ''}`}>
      <div className="process-track-head">
        <h3>{title}</h3>
        {current && (
          <p className="process-now">
            <span className="process-now-label">Now</span>
            {current.title}
          </p>
        )}
      </div>
      <ol className="process-steps">
        {steps.map((step, index) => (
          <li key={step.id} className={`process-step ${step.tone}`}>
            <div className="process-marker" aria-hidden>
              <span className="process-num">{index + 1}</span>
              {index < steps.length - 1 && <span className="process-line" />}
            </div>
            <div className="process-body">
              <strong>{step.title}</strong>
              <p>{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ProcessOverview() {
  return (
    <div className="process-overview">
      <div className="process-overview-col">
        <h3>Usual path — enrol</h3>
        <ol className="process-steps static">
          <li className="process-step todo">
            <div className="process-marker" aria-hidden>
              <span className="process-num">1</span>
              <span className="process-line" />
            </div>
            <div className="process-body">
              <strong>Enrol employee</strong>
              <p>HR puts someone on the company mutuelle. Status becomes Waiting first.</p>
            </div>
          </li>
          <li className="process-step todo">
            <div className="process-marker" aria-hidden>
              <span className="process-num">2</span>
              <span className="process-line" />
            </div>
            <div className="process-body">
              <strong>Waiting on insurer</strong>
              <p>We ask Alan or AXA to affiliate them. Not covered yet — that wait is normal.</p>
            </div>
          </li>
          <li className="process-step todo">
            <div className="process-marker" aria-hidden>
              <span className="process-num">3</span>
              <span className="process-line" />
            </div>
            <div className="process-body">
              <strong>Covered</strong>
              <p>Insurer confirmed. They are on the plan.</p>
            </div>
          </li>
          <li className="process-step todo">
            <div className="process-marker" aria-hidden>
              <span className="process-num">4</span>
            </div>
            <div className="process-body">
              <strong>On the payslip</strong>
              <p>Employer + employee Santé amounts show in Payslip preview.</p>
            </div>
          </li>
        </ol>
      </div>
      <div className="process-overview-col alt">
        <h3>Other path — dispense</h3>
        <ol className="process-steps static">
          <li className="process-step todo">
            <div className="process-marker" aria-hidden>
              <span className="process-num">1</span>
              <span className="process-line" />
            </div>
            <div className="process-body">
              <strong>Record dispense</strong>
              <p>Only if they must not join (legal exemption). No open Waiting/Covered cover allowed.</p>
            </div>
          </li>
          <li className="process-step todo">
            <div className="process-marker" aria-hidden>
              <span className="process-num">2</span>
            </div>
            <div className="process-body">
              <strong>Exempt</strong>
              <p>Reason kept in audit. No premiums, no payslip Santé lines.</p>
            </div>
          </li>
        </ol>
      </div>
    </div>
  );
}

function Glossary() {
  return (
    <details className="glossary">
      <summary>Glossary · mutuelle, carrier, dispense, payslip…</summary>
      <dl>
        <div>
          <dt>Mutuelle</dt>
          <dd>Company health insurance France requires employers to offer.</dd>
        </div>
        <div>
          <dt>Carrier</dt>
          <dd>Insurer (Alan / AXA) that affiliates the employee. Seeded per company.</dd>
        </div>
        <div>
          <dt>Waiting on carrier</dt>
          <dd>Not covered yet — background job is talking to the insurer.</dd>
        </div>
        <div>
          <dt>Covered</dt>
          <dd>Insurer confirmed membership; premiums can go to the payslip.</dd>
        </div>
        <div>
          <dt>Dispense / Exempt</dt>
          <dd>Legal reason not to join — no premiums.</dd>
        </div>
        <div>
          <dt>Patronale / salariale</dt>
          <dd>Employer share / employee share of the monthly premium.</dd>
        </div>
        <div>
          <dt>Idempotency-Key</dt>
          <dd>Stops double-clicks from creating two enrolments.</dd>
        </div>
      </dl>
    </details>
  );
}

export default function App() {
  const [companyId, setCompanyId] = useState<CompanyId>('company-a');
  const [includeEnded, setIncludeEnded] = useState(false);
  const [catalog, setCatalog] = useState<CompanyCatalog | null>(null);
  const [enrolments, setEnrolments] = useState<EnrolmentView[]>([]);
  const [payroll, setPayroll] = useState<PayrollLine[]>([]);
  const [view, setView] = useState<View>({ name: 'home' });
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const { width: evidenceWidth, maxWidth: evidenceMaxWidth, onResizePointerDown, nudgeWidth, setEvidenceWidth } =
    useEvidenceResize(workspaceRef);

  const refresh = useCallback(async () => {
    setError(null);
    const [c, list, pay] = await Promise.all([
      api.getCompany(companyId),
      api.listEnrolments(companyId, includeEnded),
      api.payrollLines(companyId),
    ]);
    setCatalog(c);
    setEnrolments(list.items);
    setPayroll(pay.items);
  }, [companyId, includeEnded]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refresh()
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    const pending = enrolments.some((e) => e.status === 'PendingExternal');
    if (!pending) return;
    const t = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 1200);
    return () => clearInterval(t);
  }, [enrolments, refresh]);

  const activeEmployees = useMemo(
    () => catalog?.employees.filter((e) => e.active) ?? [],
    [catalog],
  );

  const terminable = useMemo(
    () =>
      enrolments.filter((e) => e.status === 'PendingExternal' || e.status === 'Active'),
    [enrolments],
  );

  return (
    <div className="app-shell split">
      <header className="topbar">
        <h1 className="brand">
          <img
            className="brand-logo"
            src={`${import.meta.env.BASE_URL}favicon.svg`}
            alt=""
            width={36}
            height={36}
          />
          <span className="brand-name">MutuelleFit</span>
          <span className="brand-sep" aria-hidden="true">
            :
          </span>
          <span className="brand-tag">An insurance model for PayFit Mutuelle</span>
        </h1>
        <div className="topbar-right">
          <div className="topbar-field">
            <span className="topbar-label">View</span>
            <nav className="main-nav" aria-label="Primary">
              <button
                type="button"
                className={view.name !== 'guide' ? 'nav-link active' : 'nav-link'}
                onClick={() => setView({ name: 'home' })}
              >
                Cover
              </button>
              <button
                type="button"
                className={view.name === 'guide' ? 'nav-link active' : 'nav-link'}
                onClick={() => setView({ name: 'guide' })}
              >
                Docs
              </button>
            </nav>
          </div>
          <label className="topbar-field">
            <span className="topbar-label">Company</span>
            <GlassSelect
              className="topbar-control"
              aria-label="Company"
              value={companyId}
              onChange={(next) => {
                setCompanyId(next as CompanyId);
                setView({ name: 'home' });
                setFlash(null);
              }}
              options={[
                { value: 'company-a', label: companySelectLabel('company-a') },
                { value: 'company-b', label: companySelectLabel('company-b') },
              ]}
            />
          </label>
          <div className="topbar-field">
            <span className="topbar-label">Demo</span>
            <button
              type="button"
              className="topbar-control demo-reset-btn"
              disabled={resetting || loading}
              title="Wipe enrolments, payslip lines, audit, and outbox — reload seed catalog"
              onClick={() => {
                if (
                  !window.confirm(
                    'Reset demo to zero?\n\nThis deletes all enrolments, payslip lines, audit, and outbox events for every company, then reloads the seed catalog.',
                  )
                ) {
                  return;
                }
                setResetting(true);
                setError(null);
                void api
                  .resetDemo(companyId)
                  .then(async () => {
                    setFlash('Demo reset — back to seed, no open cover.');
                    setView({ name: 'home' });
                    setIncludeEnded(false);
                    await refresh();
                  })
                  .catch((err: Error) => setError(err.message))
                  .finally(() => setResetting(false));
              }}
            >
              {resetting ? 'Resetting…' : 'Reset to seed'}
            </button>
          </div>
        </div>
      </header>

      <div
        ref={workspaceRef}
        className={`workspace${view.name === 'guide' ? ' workspace-guide' : ''}`}
        style={{ ['--evidence-width' as string]: `${evidenceWidth}px` }}
      >
      <div className="workspace-main">
      <dl className={`hero-meta ${view.name === 'guide' ? 'hero-meta-guide' : ''}`}>
        {view.name === 'guide' ? (
          <>
            <div className="meta-block">
              <dt>Who it’s for</dt>
              <dd>HR · employees · curious readers</dd>
              <dd className="meta-hint">Written for the wide public</dd>
            </div>
            <div className="meta-block">
              <dt>Insurers</dt>
              <dd>Alan · AXA</dd>
              <dd className="meta-hint">Company setup chooses the insurer</dd>
            </div>
            <div className="meta-block">
              <dt>Payslip</dt>
              <dd>Santé employer + employee</dd>
              <dd className="meta-hint">Amounts appear after cover is confirmed</dd>
            </div>
            <div className="meta-block">
              <dt>Try it</dt>
              <dd>Cover tab</dd>
              <dd className="meta-hint">Enrol, exempt, cancel, or reset to seed</dd>
            </div>
          </>
        ) : (
          <>
            <div className="meta-block">
              <dt>Insurer (carrier)</dt>
              <dd>
                {catalog ? (catalog.carrier === 'alan' ? 'Alan' : 'AXA') : '…'}
              </dd>
              <dd className="meta-hint">Who affiliates employees for this company</dd>
            </div>
            <div className="meta-block">
              <dt>Collective plan</dt>
              <dd>{catalog?.plan?.name ?? '…'}</dd>
              <dd className="meta-hint">Company health offer (mutuelle)</dd>
            </div>
            <div className="meta-block">
              <dt>Employer pays</dt>
              <dd>≥ {catalog?.plan?.employerSharePct ?? '…'}%</dd>
              <dd className="meta-hint">Legal minimum is 50% of the premium</dd>
            </div>
            <div className="meta-block">
              <dt>Insurance module</dt>
              <dd>
                {catalog ? (catalog.insuranceEnabled ? 'On for this company' : 'Off') : '…'}
              </dd>
              <dd className="meta-hint">Seed flag — demo companies are enabled</dd>
            </div>
          </>
        )}
      </dl>

      {(error || flash) && (
        <div className="flash-slot" aria-live="polite">
          {error && <p className="flash error">{error}</p>}
          {flash && !error && <p className="flash">{flash}</p>}
        </div>
      )}

      {view.name === 'guide' && <HowItWorks />}

      {view.name === 'home' && (
        <Home
          loading={loading}
          catalog={catalog}
          enrolments={enrolments}
          payroll={payroll}
          includeEnded={includeEnded}
          terminable={terminable}
          onIncludeEnded={setIncludeEnded}
          onEnrol={() => setView({ name: 'enrol' })}
          onDispense={() => setView({ name: 'dispense' })}
          onDetail={(id) => setView({ name: 'detail', enrolmentId: id })}
          onMyCover={() => setView({ name: 'my-cover' })}
          onTerminate={async (employeeId, name) => {
            try {
              await api.terminateEmployee(companyId, employeeId);
              setFlash(
                `${name} left the company — cover ended and any payslip Santé lines were stopped.`,
              );
              await refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      )}

      {view.name === 'enrol' && catalog && (
        <EnrolForm
          catalog={catalog}
          employees={activeEmployees}
          openCoverIds={new Set(
            enrolments
              .filter((e) => e.status === 'PendingExternal' || e.status === 'Active')
              .map((e) => e.employeeId),
          )}
          onBack={() => setView({ name: 'home' })}
          onDone={async (msg) => {
            setFlash(msg);
            await refresh();
            setView({ name: 'home' });
          }}
          onError={setError}
        />
      )}

      {view.name === 'dispense' && catalog && (
        <DispenseForm
          catalog={catalog}
          employees={activeEmployees}
          openCoverIds={new Set(
            enrolments
              .filter((e) => e.status === 'PendingExternal' || e.status === 'Active')
              .map((e) => e.employeeId),
          )}
          onBack={() => setView({ name: 'home' })}
          onDone={async (msg) => {
            setFlash(msg);
            await refresh();
            setView({ name: 'home' });
          }}
          onError={setError}
        />
      )}

      {view.name === 'detail' && (
        <Detail
          companyId={companyId}
          enrolmentId={view.enrolmentId}
          catalog={catalog}
          onBack={() => setView({ name: 'home' })}
          onChanged={async (msg) => {
            setFlash(msg);
            await refresh();
            setView({ name: 'home' });
          }}
          onError={setError}
        />
      )}

      {view.name === 'my-cover' && catalog && (
        <MyCover
          companyId={companyId}
          employees={activeEmployees}
          onBack={() => setView({ name: 'home' })}
          onError={setError}
        />
      )}
      </div>
      {view.name !== 'guide' && (
        <>
          <div
            className="workspace-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Evidence column"
            aria-valuemin={0}
            aria-valuemax={evidenceMaxWidth ?? undefined}
            aria-valuenow={evidenceWidth}
            tabIndex={0}
            onPointerDown={onResizePointerDown}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                nudgeWidth(16);
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                nudgeWidth(-16);
              } else if (e.key === 'Home') {
                e.preventDefault();
                setEvidenceWidth(Number.POSITIVE_INFINITY);
              } else if (e.key === 'End') {
                e.preventDefault();
                setEvidenceWidth(0);
              }
            }}
          />
          <ImpulseRail companyId={companyId} />
        </>
      )}
      </div>
    </div>
  );
}

function Home({
  loading,
  catalog,
  enrolments,
  payroll,
  includeEnded,
  terminable,
  onIncludeEnded,
  onEnrol,
  onDispense,
  onDetail,
  onMyCover,
  onTerminate,
}: {
  loading: boolean;
  catalog: CompanyCatalog | null;
  enrolments: EnrolmentView[];
  payroll: PayrollLine[];
  includeEnded: boolean;
  terminable: EnrolmentView[];
  onIncludeEnded: (v: boolean) => void;
  onEnrol: () => void;
  onDispense: () => void;
  onDetail: (id: string) => void;
  onMyCover: () => void;
  onTerminate: (employeeId: string, name: string) => Promise<void>;
}) {
  const activePayroll = payroll.filter((p) => p.active);
  const pending = enrolments.filter((e) => e.status === 'PendingExternal');
  const active = enrolments.filter((e) => e.status === 'Active');
  const carrierName = catalog?.carrier === 'axa' ? 'AXA' : 'Alan';
  const companyLabel = catalog
    ? companyDisplayName(catalog, catalog.id as CompanyId)
    : '…';

  return (
    <>
      <section className="panel callout starter">
        <p className="eyebrow">How to use Cover</p>
        <h2>Enrol → wait → covered → payslip</h2>
        <p className="lede">
          You are the <strong>HR agent</strong> for <strong>{companyLabel}</strong> ({carrierName}).
          Click <strong>Enrol employee</strong>, then watch the highlighted step on their process
          list. Or <strong>Record dispense</strong> if they must not join. Use{' '}
          <strong>Reset demo</strong> in the top bar to wipe everything and start from seed zero.
        </p>
        <ProcessOverview />
        <Glossary />
      </section>

      {pending.length > 0 && (
        <div className="ux-banner pending" role="status">
          <div>
            <strong>What’s happening now</strong>
            <p>
              {pending.length} person{pending.length > 1 ? 's are' : ' is'} waiting on{' '}
              {carrierName}. A background job is creating their insurer membership. This page
              updates by itself until they are Covered or Failed — you do not need to refresh.
            </p>
          </div>
          <span className="ux-pulse">Live</span>
        </div>
      )}

      {pending.length === 0 && active.length > 0 && (
        <div className="ux-banner ok" role="status">
          <div>
            <strong>Cover is active</strong>
            <p>
              {active.length} employee{active.length > 1 ? 's are' : ' is'} on the plan. Scroll to{' '}
              <em>Payslip preview</em> to see the monthly employer / employee amounts.
            </p>
          </div>
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>People on cover</h2>
          <label className="toggle">
            <input
              type="checkbox"
              checked={includeEnded}
              onChange={(e) => onIncludeEnded(e.target.checked)}
            />
            Show ended history
          </label>
        </div>
        <p className="lede">
          Each person has a step list. The highlighted step is where they are right now, with a short
          explanation under every step.
        </p>

        {loading && <p className="muted">Loading cover for this company…</p>}
        {!loading && enrolments.length === 0 && (
          <div className="empty-state">
            <p>
              Nobody on cover yet. Click <strong>Enrol employee</strong> to start a real journey.
            </p>
          </div>
        )}

        {enrolments.length > 0 && (
          <div className="person-list">
            {enrolments.map((e) => {
              const hasPremium = Boolean(e.lastPremium);
              return (
                <article
                  key={e.enrolmentId}
                  className={`person-card ${e.status === 'PendingExternal' ? 'live' : ''}`}
                >
                  <header className="person-head">
                    <div>
                      <h3>{employeeName(catalog, e.employeeId)}</h3>
                      <p className="person-sub">{statusHint(e.status, e.pendingAgeSeconds)}</p>
                    </div>
                    <div className="person-meta">
                      <span className={`status ${e.status}`}>{statusLabel(e.status)}</span>
                      <span className="period-chip">Period {periodLabel(e)}</span>
                    </div>
                  </header>
                  <ProcessTrack status={e.status} hasPremium={hasPremium} compact />
                  <div className="person-actions">
                    <p className="next-line">{nextStep(e.status)}</p>
                    <button
                      type="button"
                      className="btn secondary compact"
                      onClick={() => onDetail(e.enrolmentId)}
                    >
                      Open
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="actions bottom">
          <button type="button" className="btn" onClick={onEnrol}>
            Enrol employee
          </button>
          <button type="button" className="btn secondary" onClick={onDispense}>
            Record dispense
          </button>
          <button type="button" className="btn secondary" onClick={onMyCover}>
            Employee view
          </button>
        </div>
      </section>

      <section className="panel sub">
        <h2>Payslip preview (bulletin)</h2>
        <p className="lede">
          After someone is <strong>Covered</strong>, Insurance tells Payroll the monthly amounts.
          You should see two lines per person:{' '}
          <strong>patronale</strong> = employer share, <strong>salariale</strong> = employee share.
          They always add up to the full premium.
        </p>
        {activePayroll.length === 0 ? (
          <div className="empty-state compact">
            <p>
              No payslip Santé lines yet.
              {pending.length > 0
                ? ' Waiting for the insurer to confirm cover…'
                : ' Enrol someone first; lines appear when status becomes Covered.'}
            </p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Who pays</th>
                <th>Amount</th>
                <th>Month</th>
              </tr>
            </thead>
            <tbody>
              {activePayroll.map((p) => (
                <tr key={`${p.sourceEventId}-${p.kind}`}>
                  <td>{employeeName(catalog, p.employeeId)}</td>
                  <td>
                    {p.kind === 'patronale' ? 'Employer' : 'Employee'}
                    <div className="status-code">
                      {p.kind} · {p.kind === 'patronale' ? 'company share' : 'deducted from salary'}
                    </div>
                  </td>
                  <td>
                    {(p.amountCents / 100).toFixed(2)} {p.currency}
                  </td>
                  <td>{p.periodFrom.slice(0, 7)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {terminable.length > 0 && (
        <section className="panel sub demo">
          <h2>Simulate employee leaving</h2>
          <p className="lede">
            In real PayFit this arrives as a platform event when HR ends the contract. Here you
            click to pretend they left — cover becomes <strong>Ended</strong> and payslip lines
            stop. Useful to show the last step of the journey without leaving the UI.
          </p>
          <div className="actions">
            {terminable.map((e) => (
              <button
                key={e.enrolmentId}
                type="button"
                className="btn danger"
                onClick={() =>
                  void onTerminate(e.employeeId, employeeName(catalog, e.employeeId))
                }
              >
                {employeeName(catalog, e.employeeId)} left the company
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function EnrolForm({
  catalog,
  employees,
  openCoverIds,
  onBack,
  onDone,
  onError,
}: {
  catalog: CompanyCatalog;
  employees: Array<{ id: string; name: string }>;
  openCoverIds: Set<string>;
  onBack: () => void;
  onDone: (msg: string) => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const available = useMemo(
    () => employees.filter((e) => !openCoverIds.has(e.id)),
    [employees, openCoverIds],
  );
  const [employeeId, setEmployeeId] = useState(available[0]?.id ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState('2026-04-01');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const idemKey = useMemo(
    () => `ui-enrol-${catalog.id}-${employeeId || 'x'}-${effectiveFrom}`,
    [catalog.id, employeeId, effectiveFrom],
  );

  useEffect(() => {
    if (available.length && !available.some((e) => e.id === employeeId)) {
      setEmployeeId(available[0].id);
    }
  }, [available, employeeId]);

  return (
    <section className="panel">
      <div className="nav-row">
        <button type="button" className="btn secondary" onClick={onBack}>
          ← Back
        </button>
      </div>
      <h2>Enrol employee</h2>
      <p className="lede">
        Put someone on the mutuelle with{' '}
        <strong>{catalog.carrier === 'axa' ? 'AXA' : 'Alan'}</strong>. After submit they land on
        step 2 (amber) until the insurer answers — that wait is intentional.
      </p>
      <ProcessTrack status="PendingExternal" hasPremium={false} title="What happens after you submit" compact />
      {available.length === 0 ? (
        <div className="form-alert">
          <strong>Everyone with open cover is already listed</strong>
          Cancel an existing Waiting/Covered enrolment first (Open → Cancel), or switch company.
          The API returns a conflict if you try to enrol them again.
        </div>
      ) : openCoverIds.size > 0 ? (
        <div className="form-alert">
          <strong>Some people are hidden from this list</strong>
          Anyone already Waiting or Covered cannot be enrolled again until that cover ends.
        </div>
      ) : null}
      {(localError || null) && <p className="flash error">{localError}</p>}
      <form
        className="form-grid"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!employeeId || openCoverIds.has(employeeId)) {
            setLocalError(
              'This person already has open cover. Cancel it first, or pick someone else.',
            );
            return;
          }
          setBusy(true);
          setLocalError(null);
          onError(null);
          void api
            .enrol(
              catalog.id,
              {
                employeeId,
                planId: catalog.plan?.id ?? 'sante-base',
                coverage: 'collective',
                effectiveFrom,
              },
              idemKey,
            )
            .then(() =>
              onDone(
                `Accepted — they are Waiting on ${catalog.carrier === 'axa' ? 'AXA' : 'Alan'}. Watch their diagram: amber moves to Covered when the insurer answers.`,
              ),
            )
            .catch((err: Error) => {
              setLocalError(err.message);
              onError(err.message);
            })
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Employee
          <GlassSelect
            value={employeeId}
            onChange={setEmployeeId}
            required
            disabled={available.length === 0}
            aria-label="Employee"
            options={available.map((e) => ({ value: e.id, label: e.name }))}
          />
          <span className="field-hint">Only people without Waiting/Covered cover</span>
        </label>
        <label>
          Plan (company mutuelle)
          <input value={catalog.plan?.name ?? ''} readOnly />
          <span className="field-hint">Seeded for this company — not a marketplace picker</span>
        </label>
        <label>
          Cover starts on
          <input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            required
          />
          <span className="field-hint">First day they should be on the plan</span>
        </label>
        <label>
          Idempotency-Key (auto)
          <input value={idemKey} readOnly />
          <span className="field-hint">Stops double-clicks creating two memberships</span>
        </label>
        <button type="submit" className="btn" disabled={busy || !employeeId || available.length === 0}>
          {busy ? 'Submitting…' : 'Submit enrolment'}
        </button>
      </form>
    </section>
  );
}

function DispenseForm({
  catalog,
  employees,
  openCoverIds,
  onBack,
  onDone,
  onError,
}: {
  catalog: CompanyCatalog;
  employees: Array<{ id: string; name: string }>;
  openCoverIds: Set<string>;
  onBack: () => void;
  onDone: (msg: string) => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const reasons = catalog.dispenseReasons?.length
    ? catalog.dispenseReasons
    : [{ code: 'HAS_OWN_COVER', label: 'Has own cover' }];
  const available = useMemo(
    () => employees.filter((e) => !openCoverIds.has(e.id)),
    [employees, openCoverIds],
  );
  const [employeeId, setEmployeeId] = useState(available[0]?.id ?? '');
  const [reasonCode, setReasonCode] = useState(reasons[0]?.code ?? 'HAS_OWN_COVER');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (available.length && !available.some((e) => e.id === employeeId)) {
      setEmployeeId(available[0].id);
    }
  }, [available, employeeId]);

  return (
    <section className="panel">
      <div className="nav-row">
        <button type="button" className="btn secondary" onClick={onBack}>
          ← Back
        </button>
      </div>
      <h2>Record dispense (exemption)</h2>
      <p className="lede">
        Use when they must <strong>not</strong> join (e.g. already covered elsewhere). No premiums.
      </p>
      <ProcessTrack status="Dispensed" hasPremium={false} title="What dispense does" compact />
      {available.length === 0 ? (
        <div className="form-alert">
          <strong>Cannot dispense while open cover exists</strong>
          Everyone eligible already has Waiting or Covered status. Open their card → Cancel
          enrolment, then record the dispense. That is the 409 the API returns.
        </div>
      ) : (
        <div className="form-alert">
          <strong>Rule: enrol or dispense — not both</strong>
          People with Waiting/Covered cover are hidden. Dispense only when there is no open
          enrolment.
        </div>
      )}
      {localError && <p className="flash error">{localError}</p>}
      <form
        className="form-grid"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!employeeId || openCoverIds.has(employeeId)) {
            setLocalError(
              'This person already has open cover (Waiting or Covered). Cancel it first.',
            );
            return;
          }
          setBusy(true);
          setLocalError(null);
          onError(null);
          void api
            .dispense(catalog.id, { employeeId, reasonCode })
            .then((r) => onDone(`Exemption recorded (${r.reasonCode}) — status Exempt, no payslip lines.`))
            .catch((err: Error) => {
              setLocalError(err.message);
              onError(err.message);
            })
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Employee
          <GlassSelect
            value={employeeId}
            onChange={setEmployeeId}
            disabled={available.length === 0}
            aria-label="Employee"
            options={available.map((e) => ({ value: e.id, label: e.name }))}
          />
          <span className="field-hint">Hidden if they already have Waiting/Covered cover</span>
        </label>
        <label>
          Legal reason
          <GlassSelect
            value={reasonCode}
            onChange={setReasonCode}
            aria-label="Legal reason"
            options={reasons.map((r) => ({
              value: r.code,
              label: `${r.label} (${r.code})`,
            }))}
          />
          <span className="field-hint">Stored on the audit trail for compliance</span>
        </label>
        <button type="submit" className="btn" disabled={busy || !employeeId || available.length === 0}>
          {busy ? 'Saving…' : 'Record dispense'}
        </button>
      </form>
    </section>
  );
}

function Timeline({
  status,
  hasPremium,
  audit,
}: {
  status: string;
  hasPremium: boolean;
  audit: AuditEntry[];
}) {
  return (
    <div className="timeline">
      <ProcessTrack status={status} hasPremium={hasPremium} title="Where they are in the process" />
      <h3>Audit trail</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        System log — prove what happened.
      </p>
      {audit.length === 0 ? (
        <p className="muted">No audit rows for this enrolment yet.</p>
      ) : (
        <ul className="audit-list">
          {audit.map((a) => (
            <li key={a.id}>
              <strong>{a.action}</strong>
              <span>{new Date(a.createdAt).toLocaleString()}</span>
              {a.detail && Object.keys(a.detail).length > 0 && (
                <code>{JSON.stringify(a.detail)}</code>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Detail({
  companyId,
  enrolmentId,
  catalog,
  onBack,
  onChanged,
  onError,
}: {
  companyId: string;
  enrolmentId: string;
  catalog: CompanyCatalog | null;
  onBack: () => void;
  onChanged: (msg: string) => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [item, setItem] = useState<EnrolmentView | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([
      api.getEnrolment(companyId, enrolmentId),
      api.audit(companyId, 100),
    ])
      .then(([enrolment, aud]) => {
        setItem(enrolment);
        setAudit(aud.items.filter((a) => a.enrolmentId === enrolmentId));
      })
      .catch((err: Error) => onError(err.message));
  }, [companyId, enrolmentId, onError]);

  useEffect(() => {
    if (item?.status !== 'PendingExternal') return;
    const t = setInterval(() => {
      void api
        .getEnrolment(companyId, enrolmentId)
        .then(setItem)
        .catch(() => undefined);
    }, 1200);
    return () => clearInterval(t);
  }, [item?.status, companyId, enrolmentId]);

  if (!item) {
    return (
      <section className="panel">
        <p className="muted">Loading detail…</p>
      </section>
    );
  }

  const canCancel = item.status === 'PendingExternal' || item.status === 'Active';

  return (
    <section className="panel">
      <div className="nav-row">
        <button type="button" className="btn secondary" onClick={onBack}>
          ← Back
        </button>
      </div>
      <h2>{employeeName(catalog, item.employeeId)}</h2>
      <p className="lede">Full story for this enrolment — journey, money, and the system audit.</p>
      <div className={`ux-banner ${item.status === 'PendingExternal' ? 'pending' : item.status === 'Active' ? 'ok' : 'neutral'}`}>
        <div>
          <strong>Now: {statusLabel(item.status)}</strong>
          <p>{statusHint(item.status, item.pendingAgeSeconds)}</p>
          <p className="banner-next">What you can do: {nextStep(item.status)}</p>
        </div>
        {item.status === 'PendingExternal' && <span className="ux-pulse">Live</span>}
      </div>

      <Timeline
        status={item.status}
        hasPremium={Boolean(item.lastPremium)}
        audit={audit}
      />

      <h3 className="detail-heading">Facts</h3>
      <dl className="detail-grid">
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`status ${item.status}`}>{statusLabel(item.status)}</span>
          </dd>
        </div>
        <div>
          <dt>Insurer</dt>
          <dd>
            {item.carrier === 'alan' ? 'Alan' : item.carrier === 'axa' ? 'AXA' : item.carrier}
            <span className="status-code">seed-configured for this company</span>
          </dd>
        </div>
        <div>
          <dt>Cover starts</dt>
          <dd>{item.effectiveFrom}</dd>
        </div>
        <div>
          <dt>Cover ends</dt>
          <dd>{item.effectiveTo ?? 'Still open'}</dd>
        </div>
        <div>
          <dt>Insurer member id</dt>
          <dd>
            {item.insurerMemberId ?? 'Not yet — filled when Covered'}
            <span className="status-code">id returned by the carrier</span>
          </dd>
        </div>
        <div>
          <dt>Insurer attempts</dt>
          <dd>
            {item.attemptCount ?? 0}
            <span className="status-code">fails after 3 transport errors</span>
          </dd>
        </div>
        {item.lastPremium && (
          <>
            <div>
              <dt>Employer share</dt>
              <dd>{(item.lastPremium.employerShareCents / 100).toFixed(2)} EUR</dd>
            </div>
            <div>
              <dt>Employee share</dt>
              <dd>{(item.lastPremium.employeeShareCents / 100).toFixed(2)} EUR</dd>
            </div>
            <div>
              <dt>Premium month</dt>
              <dd>
                {item.lastPremium.periodFrom} → {item.lastPremium.periodTo}
              </dd>
            </div>
          </>
        )}
      </dl>

      {canCancel && (
        <button
          type="button"
          className="btn danger"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void api
              .cancel(companyId, enrolmentId)
              .then(() =>
                onChanged(
                  'Enrolment cancelled — cover Ended. Any premiums were stopped for Payroll.',
                ),
              )
              .catch((err: Error) => onError(err.message))
              .finally(() => setBusy(false));
          }}
        >
          Cancel this enrolment
        </button>
      )}
    </section>
  );
}

function MyCover({
  companyId,
  employees,
  onBack,
  onError,
}: {
  companyId: string;
  employees: Array<{ id: string; name: string }>;
  onBack: () => void;
  onError: (msg: string | null) => void;
}) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? '');
  const [cover, setCover] = useState<{
    planName: string | null;
    status: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  } | null>(null);

  useEffect(() => {
    if (!employeeId) return;
    void api
      .myCover(companyId, employeeId)
      .then(setCover)
      .catch((err: Error) => onError(err.message));
  }, [companyId, employeeId, onError]);

  return (
    <section className="panel">
      <div className="nav-row">
        <button type="button" className="btn secondary" onClick={onBack}>
          ← Back
        </button>
      </div>
      <h2>My cover (employee view)</h2>
      <p className="lede">
        What an employee would see: only their plan, status, and dates. They cannot enrol, cancel, or
        see payroll admin detail. Pick a seeded employee to preview.
      </p>
      <div className="form-grid">
        <label>
          Employee
          <GlassSelect
            value={employeeId}
            onChange={setEmployeeId}
            aria-label="Employee"
            options={employees.map((e) => ({ value: e.id, label: e.name }))}
          />
        </label>
      </div>
      {cover && (
        <dl className="detail-grid" style={{ marginTop: '1.25rem' }}>
          <div>
            <dt>Plan</dt>
            <dd>{cover.planName ?? '—'}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <span className={`status ${cover.status}`}>{statusLabel(cover.status)}</span>
            </dd>
          </div>
          <div>
            <dt>Effective from</dt>
            <dd>{cover.effectiveFrom ?? '—'}</dd>
          </div>
          <div>
            <dt>Effective to</dt>
            <dd>{cover.effectiveTo ?? '—'}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
