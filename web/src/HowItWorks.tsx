import { useEffect, useRef, useState, type ReactNode } from 'react';
import { demoListen } from './guided-demo-bus';
import { Mermaid } from './Mermaid';

/** Mermaid subgraph / node ids → architecture piece number. */
const ARCH_CLICK_MAP: Record<string, string> = {
  UI: '1',
  W: '1',
  API: '2',
  F: '2',
  AUTH: '2',
  CORE: '3',
  FSM: '3',
  PG: '3',
  OB: '3',
  WRK: '4',
  ACT: '4',
  PUB: '4',
  EXT: '5',
  ALAN: '5',
  AXA: '5',
  PAY: '5',
  PLAT: '5',
};

const ARCH_PIECE_IDS: Record<string, readonly string[]> = {
  '1': ['UI', 'W'],
  '2': ['API', 'F', 'AUTH'],
  '3': ['CORE', 'FSM', 'PG', 'OB'],
  '4': ['WRK', 'ACT', 'PUB'],
  '5': ['EXT', 'ALAN', 'AXA', 'PAY', 'PLAT'],
};

const ARCH = `
flowchart LR
  subgraph UI["1 · Your screen"]
    W["Cover app"]
  end
  subgraph API["2 · Insurance service"]
    F["Secure company API"]
    AUTH["Who you are + which company"]
  end
  subgraph CORE["3 · Records"]
    FSM["Cover status"]
    PG[("Database")]
    OB["Reliable handoff"]
  end
  subgraph WRK["4 · Background jobs"]
    ACT["Ask the insurer"]
    PUB["Tell Payroll"]
  end
  subgraph EXT["5 · Outside PayFit"]
    ALAN["Alan"]
    AXA["AXA"]
    PAY["Payroll"]
    PLAT["Employee left event"]
  end
  W --> F
  F --> AUTH
  F --> FSM
  FSM --> PG
  ACT --> ALAN
  ACT --> AXA
  ACT --> FSM
  FSM --> OB
  PUB --> PAY
  PLAT --> FSM
`;

const FSM = `
stateDiagram-v2
  [*] --> PendingExternal: enrol
  PendingExternal --> Active: insurer confirmed
  PendingExternal --> Failed: insurer never answered
  PendingExternal --> Ended: cancel or left company
  Active --> Ended: cancel or left company
  [*] --> Dispensed: legal exemption
  Failed --> [*]
  Dispensed --> [*]
  Ended --> [*]
`;

/** Critical path for the opening slide — same sequence style as enrolment. */
const ONE_MIN = `
sequenceDiagram
  participant HR as HR · Cover
  participant API as Insurance API
  participant W as Worker
  participant C as Alan / AXA
  participant P as Payroll
  HR->>API: POST enrol + Idempotency-Key
  API-->>HR: 202 PendingExternal
  Note over API,W: enrolment + outbox · one TX
  W->>C: InsurerGateway · createMember
  C-->>W: member confirmed
  W->>API: Active
  W->>P: PremiumInstructionIssued · cents
`;

const PROCESS = `
flowchart TB
  NEED["What this product covers"] --> MUST

  subgraph MUST["Built for real"]
    direction LR
    M1["Cover statuses"] --> M2["Company-safe API"] --> M3["Background jobs"]
    M3 --> M4["Insurer adapters"] --> M5["Safe retries"] --> M6["Company isolation"]
  end

  MUST --> SEED

  subgraph SEED["Starter data"]
    direction LR
    S1["Sample companies"] --> S2["Sample people + plan"] --> S3["Exemption reasons"]
  end

  SEED --> MOCK

  subgraph MOCK["Not in this preview"]
    direction LR
    K1["Live Alan/AXA APIs"] --> K2["Full cloud stack"] --> K3["Company SSO"] --> K4["Auto-enrol on hire"]
  end
`;

const EDGE = `
flowchart TB
  subgraph Happy["Usual path"]
    direction LR
    E[Enrol] --> P[Waiting] --> A[Covered] --> Pay[Payslip amounts]
  end

  subgraph Edges["Failure modes"]
    direction LR
    A1["A Double-click → one cover"]
    A2["B Wrong company → 403"]
    A3["C Insurer down → Failed"]
    A4["D Dup reply → ignored"]
    A5["E Left early → stopped"]
    A6["F Exemption → no Santé"]
  end
`;

const GUIDE_PAGES = [
  { id: 'guide-01', n: '01', label: 'Start' },
  { id: 'guide-02', n: '02', label: 'Architecture' },
  { id: 'guide-03', n: '03', label: 'Statuses' },
  { id: 'guide-04', n: '04', label: 'Guarantees' },
  { id: 'guide-05', n: '05', label: 'Scope' },
  { id: 'guide-06', n: '06', label: 'Edges' },
  { id: 'guide-07', n: '07', label: 'In Cover' },
] as const;

type GuidePageId = (typeof GUIDE_PAGES)[number]['id'];

function isGuidePageId(id: string): id is GuidePageId {
  return GUIDE_PAGES.some((page) => page.id === id);
}

function Slide({
  id,
  n,
  kicker,
  title,
  dek,
  children,
  className = '',
}: {
  id: string;
  n: string;
  kicker: string;
  title: string;
  dek: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`guide-slide panel ${className}`.trim()} data-guide-slide={n}>
      <header className="guide-slide-head">
        <p className="guide-slide-kicker">
          <span>{n}</span>
          {kicker}
        </p>
        <h2>{title}</h2>
        <p className="lede">{dek}</p>
      </header>
      <div className="guide-slide-body">{children}</div>
    </section>
  );
}

function GuidePagesNav({
  activeId,
  onGo,
}: {
  activeId: GuidePageId;
  onGo: (id: GuidePageId) => void;
}) {
  return (
    <nav className="guide-pages" aria-label="Docs pages">
      <p className="guide-pages-label">Pages</p>
      <ol>
        {GUIDE_PAGES.map((page) => (
          <li key={page.id}>
            <button
              type="button"
              className={`guide-page-btn${page.id === activeId ? ' active' : ''}`}
              aria-label={`Page ${page.n} · ${page.label}`}
              aria-current={page.id === activeId ? 'true' : undefined}
              onClick={() => onGo(page.id)}
            >
              <span className="guide-page-n">{page.n}</span>
              <span className="guide-page-title">{page.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

type ArchPiece = {
  n: string;
  title: string;
  principle: string;
  detail: string;
};

/** One principle per box — enough for a tech walkthrough, not a catalog. */
const ARCH_PIECES: ArchPiece[] = [
  {
    n: '1',
    title: 'Your screen',
    principle: 'Thin client — never the source of truth',
    detail:
      'Cover only sends commands and shows status. No carrier calls, no payslip writes, no cover rules in the browser.',
  },
  {
    n: '2',
    title: 'Insurance service',
    principle: 'Company-scoped API that answers before the carrier',
    detail:
      'Every /v1 call is role + companyId. Enrol returns 202 PendingExternal in-process — the insurer is not on the request path.',
  },
  {
    n: '3',
    title: 'Records',
    principle: 'FSM + outbox in one transaction',
    detail:
      'Insurance owns cover status. Status change and the next handoff (outbox) commit together so a crash cannot lose work.',
  },
  {
    n: '4',
    title: 'Background jobs',
    principle: 'Side effects after the HTTP response',
    detail:
      'Workers drain the outbox: InsurerGateway → Active or Failed, then premium / stop events. Retries live here, not in the UI.',
  },
  {
    n: '5',
    title: 'Outside PayFit',
    principle: 'Adapters at the edge — no shared tables',
    detail:
      'Alan/AXA sit behind InsurerGateway. Payroll only consumes money instructions. Insurance never writes Payroll tables.',
  },
];

function ArchOverview() {
  const [active, setActive] = useState(ARCH_PIECES[0].n);
  const piece = ARCH_PIECES.find((p) => p.n === active) ?? ARCH_PIECES[0];

  return (
    <div className="arch-center">
      <div className="arch-diagram-stage">
        <Mermaid
          chart={ARCH}
          panZoom
          fitPad={0.9}
          activeLogicalIds={ARCH_PIECE_IDS[active]}
          onElementClick={(logicalId) => {
            const n = ARCH_CLICK_MAP[logicalId];
            if (n) setActive(n);
          }}
        />

        <div className="arch-overlay">
          <aside className="arch-comment" aria-live="polite" key={piece.n}>
            <div className="arch-comment-head">
              <span className="arch-tag">{piece.n}</span>
              <div>
                <h3>{piece.title}</h3>
                <p className="arch-piece-principle">{piece.principle}</p>
              </div>
            </div>
            <p>{piece.detail}</p>
          </aside>

          <div className="arch-tabs" role="tablist" aria-label="Architecture pieces">
            {ARCH_PIECES.map((p) => (
              <button
                key={p.n}
                type="button"
                role="tab"
                aria-selected={p.n === active}
                className={`arch-tab${p.n === active ? ' active' : ''}`}
                onClick={() => setActive(p.n)}
              >
                <span className="arch-tab-n">{p.n}</span>
                <span className="arch-tab-label">{p.title}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const STORIES = [
  {
    id: '1',
    title: 'Enrol on the plan',
    who: 'HR',
    body: 'Affiliate so membership and payroll stay in sync — Waiting first, then Covered + Santé lines.',
    try: 'Cover → Enrol employee',
  },
  {
    id: '2',
    title: 'Switch company / insurer',
    who: 'Company',
    body: 'Same product, different carrier. Company 1 → Alan; Company 2 → AXA. Config, not a cart.',
    try: 'Header → Company 2 → enrol',
  },
  {
    id: '3',
    title: 'Double-submit safe',
    who: 'HR',
    body: 'Same Idempotency-Key twice → one person, one cover, one deduction pair.',
    try: 'Enrol twice with the same key',
  },
  {
    id: '4',
    title: 'Leaver stops cover',
    who: 'System',
    body: 'Person left → cover ends, carrier cancel, Santé lines off. No leftover charges.',
    try: 'Cover → Simulate employee leaving',
  },
  {
    id: '5',
    title: 'Cancel cover',
    who: 'HR',
    body: 'End Waiting or Covered without a leaver event. Company-scoped — no cross-tenant cancel.',
    try: 'Cover → person → Cancel',
  },
  {
    id: '6',
    title: 'Record dispense',
    who: 'HR',
    body: 'Legal exemption + audit reason. No Active cover, no Santé lines. Blocked if open cover exists.',
    try: 'Cover → Record dispense',
  },
  {
    id: '7',
    title: 'Honest waiting',
    who: 'HR',
    body: 'Never show Covered while the insurer works. Waiting → Covered, or Failed after retries.',
    try: 'Enrol and watch Waiting → Covered',
  },
  {
    id: '8',
    title: 'Employee self-view',
    who: 'Employee',
    body: 'Read-only plan + status for me — not HR money detail. Cannot enrol or cancel others.',
    try: 'Cover → Employee view',
  },
];

const EDGES = [
  {
    id: 'A',
    highlight: true,
    title: 'Double-click / retry',
    expect: 'Same Idempotency-Key → one enrolment, one membership, one deduction pair.',
    evidence: 'Idempotency-Key · 202 same body',
  },
  {
    id: 'B',
    highlight: true,
    title: 'Wrong company',
    expect: 'Wrong companyId → 403. No cross-tenant leak via Cover or API.',
    evidence: 'X-Company-Id must match · 403',
  },
  {
    id: 'C',
    highlight: false,
    title: 'Insurer unreachable',
    expect: 'Stay PendingExternal, then Failed — never silent Covered.',
    evidence: 'Failed @ 3 transport/timeout attempts',
  },
  {
    id: 'D',
    highlight: false,
    title: 'Duplicate insurer reply',
    expect: 'Second confirmation is a no-op. Status and amounts stay stable.',
    evidence: 'insurerEventId dedupe · inbox no-op',
  },
  {
    id: 'E',
    highlight: false,
    title: 'Left while waiting',
    expect: 'Cover ends locally; in-flight membership cancelled — no zombie Active.',
    evidence: 'Terminate wins over concurrent activate',
  },
  {
    id: 'F',
    highlight: false,
    title: 'Exemption instead of enrol',
    expect: 'Dispensed + audit reason. No Active. No Santé payslip lines.',
    evidence: 'DispenseEmployee · no PremiumInstruction',
  },
];

const CRITICAL = [
  {
    n: '1',
    icon: 'outbox',
    title: 'Payroll handoff',
    body: 'Status change and Payroll message commit together. Same Idempotency-Key → same enrolment — no duplicate amounts.',
    evidence: 'Outbox + FSM, one TX · Idempotency-Key → 202',
  },
  {
    n: '2',
    icon: 'cents',
    title: 'Money in cents',
    body: 'Whole EUR cents. Employer share ≥ 50% (ANI). Patronale + salariale always sum to the premium.',
    evidence: 'employerShareCents + employeeShareCents · ≥ 50%',
  },
  {
    n: '3',
    icon: 'calendar',
    title: 'Calendar month',
    body: 'April start → payslip period is the full April month (1 → last day), Europe/Paris.',
    evidence: 'Europe/Paris · month of effectiveFrom',
  },
  {
    n: '4',
    icon: 'wait',
    title: 'Waiting means waiting',
    body: 'Enrol → PendingExternal. Active only on carrier confirm; retries exhausted → Failed — never silent Covered.',
    evidence: 'PendingExternal → Active on confirm · Failed @ 3',
  },
  {
    n: '5',
    icon: 'bounds',
    title: 'Company isolation',
    body: 'Every command scoped by companyId. Wrong company → 403. ≤1 open Waiting/Covered cover per person.',
    evidence: 'X-Company-Id · ≤1 PendingExternal|Active',
  },
  {
    n: '6',
    icon: 'gateway',
    title: 'Insurer at the edge',
    body: 'Carrier is company config, not a cart. Domain talks InsurerGateway — Alan / AXA are swappable adapters.',
    evidence: 'company.insurerId · AlanStub / AxaStub ACL',
  },
] as const;

function GuaranteeIcon({ name }: { name: (typeof CRITICAL)[number]['icon'] }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
  switch (name) {
    case 'outbox':
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
          <path d="M8 12h8M12 8v8" />
        </svg>
      );
    case 'cents':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.25" />
          <path d="M14.5 8.5c-.7-1-2.8-1.4-4 .2-1.4 1.8-1.1 5.2.5 6.6 1.3 1.1 3.5.9 4.3-.2M12 6.5v11" />
        </svg>
      );
    case 'calendar':
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
          <path d="M8 3.5v4M16 3.5v4M3.5 10h17" />
        </svg>
      );
    case 'wait':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.25" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      );
    case 'bounds':
      return (
        <svg {...common}>
          <rect x="3.5" y="4.5" width="7.5" height="7.5" rx="1.5" />
          <rect x="13" y="4.5" width="7.5" height="7.5" rx="1.5" />
          <rect x="8.25" y="12" width="7.5" height="7.5" rx="1.5" />
        </svg>
      );
    case 'gateway':
      return (
        <svg {...common}>
          <path d="M4 12h7M13 12h7" />
          <rect x="9.5" y="8" width="5" height="8" rx="1.5" />
          <circle cx="4" cy="12" r="1.6" />
          <circle cx="20" cy="12" r="1.6" />
        </svg>
      );
  }
}

export function HowItWorks() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<GuidePageId>(GUIDE_PAGES[0].id);
  const goToRef = useRef<(id: GuidePageId) => void>(() => {});

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const scroller = root.closest('.workspace-main') as HTMLElement | null;
    if (!scroller) return;

    const slides = [...root.querySelectorAll<HTMLElement>('[data-guide-slide]')];
    if (slides.length === 0) return;

    let frame = 0;
    const pickActive = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const marker = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.28;
        let bestId: GuidePageId = GUIDE_PAGES[0].id;
        for (const slide of slides) {
          if (!isGuidePageId(slide.id)) continue;
          if (slide.getBoundingClientRect().top <= marker) bestId = slide.id;
        }
        setActiveId((prev) => (prev === bestId ? prev : bestId));
      });
    };

    pickActive();
    scroller.addEventListener('scroll', pickActive, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', pickActive);
    };
  }, []);

  const goTo = (id: GuidePageId) => {
    const root = rootRef.current;
    const el = document.getElementById(id);
    const scroller = root?.closest('.workspace-main') as HTMLElement | null;
    if (!el || !scroller) return;
    setActiveId(id);
    const next =
      scroller.scrollTop + (el.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
    scroller.scrollTo({ top: Math.max(0, next), behavior: 'auto' });
  };
  goToRef.current = goTo;

  useEffect(() => {
    return demoListen((command) => {
      if (command.type !== 'docs-go') return;
      if (!isGuidePageId(command.pageId)) return;
      goToRef.current(command.pageId);
    });
  }, []);

  return (
    <div className="guide-deck" ref={rootRef}>
      <GuidePagesNav activeId={activeId} onGo={goTo} />
      <div className="guide">
      <header className="guide-hero">
        <p className="eyebrow">Docs · for everyone</p>
        <p className="lede">
          Plain-language guide to company health cover (mutuelle) in PayFit: what happens when HR
          enrols someone, how the insurer and payroll stay in sync, and what you can try in Cover.
        </p>
      </header>

      <Slide
        id="guide-01"
        n="01"
        kicker="Start here"
        title="In one minute"
        dek="The async path every engineer asks about — and the rules that keep it honest."
        className="guide-slide-hero"
      >
        <div className="guide-hero-stage guide-hero-lead-chart">
          <p className="guide-open-lead">
            Insurance is its own <strong>bounded context</strong> next to company, employee, and
            payroll. HR talks to <code>/v1</code>; we store cover status in an enrolment{' '}
            <strong>FSM</strong>; carriers sit behind <strong>InsurerGateway</strong> (Alan / AXA
            adapters). Payroll only receives money instructions in EUR cents — Insurance never
            writes payslip tables.
          </p>

          <div className="guide-hero-chart">
            <Mermaid
              chart={ONE_MIN}
              title="Critical path · enrol is async"
              className="mermaid-status"
              fillWidth
              fitPad={0.78}
            />
          </div>
        </div>
      </Slide>

      <Slide
        id="guide-02"
        n="02"
        kicker="Architecture"
        title="How the pieces fit together"
        dek="Five ownership zones from Cover to carrier — what each layer may write, and where the async boundary starts."
        className="guide-slide-hero"
      >
        <ArchOverview />
      </Slide>

      <Slide
        id="guide-03"
        n="03"
        kicker="Statuses"
        title="Cover statuses"
        dek="Enrolment FSM — only these transitions are legal. PendingExternal is honesty; Active is never invented."
        className="guide-slide-hero"
      >
        <div className="guide-hero-stage guide-hero-chart-legend">
          <div className="guide-hero-chart">
            <Mermaid chart={FSM} className="mermaid-status" panZoom fitPad={0.9} />
          </div>

          <div className="guide-fsm-legend">
            <p>
              Cover UI labels map 1:1 to engine names. Illegal jumps are rejected — the diagram is the
              contract.
            </p>
            <ol className="guide-fsm-states" aria-label="Cover statuses">
              <li>
                <strong>PendingExternal</strong>
                <span>Waiting on carrier — never show Covered</span>
              </li>
              <li>
                <strong>Active</strong>
                <span>Affiliated — premiums / payslip amounts may appear</span>
              </li>
              <li>
                <strong>Failed</strong>
                <span>Retries exhausted — enrol again as a new request</span>
              </li>
              <li>
                <strong>Dispensed</strong>
                <span>Legal exemption — no cover, no Santé lines</span>
              </li>
              <li>
                <strong>Ended</strong>
                <span>Cancel or leaver — deductions stop if they started</span>
              </li>
            </ol>
          </div>
        </div>
      </Slide>

      <Slide
        id="guide-04"
        n="04"
        kicker="Guarantees"
        title="What must stay true"
        dek="Reviewer checklist for code and Cover — the contract slide 06 edges rest on."
        className="guide-slide-hero"
      >
        <div className="guide-hero-stage guide-hero-guarantees">
          <div className="critical-grid guide-critical">
            {CRITICAL.map((c) => (
              <article key={c.title} className="critical-card">
                <div className="critical-card-head">
                  <span className="critical-card-icon" aria-hidden="true">
                    <GuaranteeIcon name={c.icon} />
                  </span>
                  <span className="critical-card-n">{c.n}</span>
                  <h3>{c.title}</h3>
                </div>
                <p className="critical-card-body">{c.body}</p>
                <p className="critical-card-evidence">
                  <span>Evidence</span>
                  <code>{c.evidence}</code>
                </p>
              </article>
            ))}
          </div>
        </div>
      </Slide>

      <Slide
        id="guide-05"
        n="05"
        kicker="Scope"
        title="What this preview includes"
        dek="Built for real vs sample data vs out of scope — stubs must never look like production carriers."
        className="guide-slide-hero"
      >
        <div className="guide-hero-stage guide-hero-chart-legend guide-hero-scope">
          <div className="guide-hero-chart">
            <Mermaid chart={PROCESS} className="mermaid-status" panZoom fitPad={0.92} />
          </div>

          <div className="guide-scope-legend">
            <p>
              Engine you can trust · seed for the demo · what we are not faking. A real carrier later
              is an <code>InsurerGateway</code> adapter swap — not a rewrite of enrol → waiting →
              covered.
            </p>
            <div className="guide-scope-bands" aria-label="Scope bands">
              <div className="legend-pill must">
                <strong>Built for real</strong>
                <span>FSM · company API · jobs · adapters · retries · isolation</span>
              </div>
              <div className="legend-pill seed">
                <strong>Sample data</strong>
                <span>2 companies · people · plan ≥50% · dispense reasons</span>
              </div>
              <div className="legend-pill mock">
                <strong>Not in preview</strong>
                <span>Live Alan/AXA · full cloud · SSO · auto-enrol</span>
              </div>
            </div>
          </div>
        </div>
      </Slide>

      <Slide
        id="guide-06"
        n="06"
        kicker="Edges"
        title="When something goes wrong"
        dek="Usual path vs failure modes — try A and B in Cover (double enrol, company switch)."
        className="guide-slide-hero"
      >
        <div className="guide-hero-stage guide-hero-chart-legend guide-hero-edges">
          <div className="guide-hero-chart">
            <Mermaid chart={EDGE} className="mermaid-status" panZoom fitPad={0.9} />
          </div>

          <div className="edge-grid guide-edges">
            {EDGES.map((e) => (
              <article key={e.id} className={`edge-card${e.highlight ? ' demo' : ''}`}>
                <header>
                  <span className="edge-id">{e.id}</span>
                  <h3>{e.title}</h3>
                  {e.highlight && <span className="edge-badge">Try this</span>}
                </header>
                <p className="edge-card-body">{e.expect}</p>
                <p className="edge-card-evidence">
                  <span>Evidence</span>
                  <code>{e.evidence}</code>
                </p>
              </article>
            ))}
          </div>
        </div>
      </Slide>

      <Slide
        id="guide-07"
        n="07"
        kicker="In Cover"
        title="What you can do"
        dek="Eight clicks in Cover — promise, outcome, and where to press."
        className="guide-slide-hero"
      >
        <div className="guide-hero-stage guide-hero-stories">
          <div className="story-grid guide-stories">
            {STORIES.map((s) => (
              <article key={s.id} className="story-card">
                <header>
                  <span className="story-id">{s.id}</span>
                  <h3>{s.title}</h3>
                  <span className="story-who">{s.who}</span>
                </header>
                <p className="story-card-body">{s.body}</p>
                <p className="story-try">
                  <span>Try</span>
                  <code>{s.try}</code>
                </p>
              </article>
            ))}
          </div>
        </div>
      </Slide>
      </div>
    </div>
  );
}
