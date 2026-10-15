import type { DevLogEntry, Impulse } from './api';
import { readDevLine } from './design-log';

export type ArchContext = 'Screen' | 'Employee' | 'Insurance' | 'Carrier' | 'Payroll';

export interface ArchNode {
  id: string;
  context: ArchContext;
  /** Short name shown on the map card. */
  title: string;
  /** One-line role on the map card. */
  blurb: string;
  /** Longer copy in the bottom inspect panel. */
  about: string;
}

/** How the message crosses the link — drives edge style on the map. */
export type ArchHow = 'http' | 'direct' | 'async' | 'bus';

export interface ArchEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  /** http = request/response · direct = same process / await · async = poll or later tick · bus = published event */
  how: ArchHow;
  query?: boolean;
  /** Optional longer blurb for the inspect panel. */
  about?: string;
}

export const ARCH_HOW_ABOUT: Record<ArchHow, string> = {
  http: 'Crosses the network as HTTP. The caller waits for a response (or 202 Accepted).',
  direct: 'Same process, often the same database transaction. Finished before the caller returns.',
  async: 'Not done in the caller’s request. A later poll, worker tick, or drain picks it up.',
  bus: 'A published domain event. Subscribers react; they never write the Enrolment aggregate.',
};

export const ARCH_NODES: ArchNode[] = [
  {
    id: 'ui',
    context: 'Screen',
    title: 'HR admin screen',
    blurb: 'Commands out · status in',
    about:
      'What HR uses in the demo. It posts enrol / dispense / cancel and polls lists for status. It never opens the database or moves the Enrolment FSM — that is the API’s job.',
  },
  {
    id: 'employee',
    context: 'Employee',
    title: 'Employee domain',
    blurb: 'Person & contract owner',
    about:
      'Owns the person and the employment contract. When someone leaves it emits EmployeeTerminated into Insurance. It must not know Enrolment status (PendingExternal / Active) — that is Insurance’s aggregate.',
  },
  {
    id: 'api',
    context: 'Insurance',
    title: 'Insurance API',
    blurb: 'HTTP edge · EnrolEmployee 202',
    about:
      'Command/query edge for the Insurance bounded context. EnrolEmployee returns 202 with PendingExternal in the same request — status is not Active yet. Enforces companyId tenancy and Idempotency-Key.',
  },
  {
    id: 'enrolment',
    context: 'Insurance',
    title: 'Enrolment FSM',
    blurb: 'Aggregate · status truth',
    about:
      'Insurance aggregate and finite-state machine: PendingExternal → Active → Ended, or Dispensed / Failed. Illegal transitions → 409. Only Enrolment decides status; Payroll and Employee never write it.',
  },
  {
    id: 'idempotency',
    context: 'Insurance',
    title: 'Idempotency store',
    blurb: 'Retries stay safe',
    about:
      'Remembers each Idempotency-Key with the first 202 body. A network retry with the same key returns the same enrolment id — it does not create a second Pending row.',
  },
  {
    id: 'audit',
    context: 'Insurance',
    title: 'Audit log',
    blurb: 'Who did what',
    about:
      'Append-only record of actors and actions beside the aggregate (enrol, dispense reason, cancel…). Useful for demos and support. It never chooses the next FSM status.',
  },
  {
    id: 'handoff',
    context: 'Insurance',
    title: 'Activation handoff',
    blurb: 'Pending + work to do',
    about:
      'Durable “please activate” intent written in the same transaction as PendingExternal. The HTTP request does not call the carrier; the worker claims this work on a later tick.',
  },
  {
    id: 'worker',
    context: 'Insurance',
    title: 'Activation worker',
    blurb: 'Carrier then Active',
    about:
      'Background monitor: claims PendingExternal rows, calls InsurerGateway.createMember, then writes Active and the domain outbox — or retries / Failed after transport errors. Never marks Active before the carrier accepts.',
  },
  {
    id: 'gateway',
    context: 'Carrier',
    title: 'Insurer gateway',
    blurb: 'One port · many carriers',
    about:
      'Anti-corruption layer. The domain only speaks createMember / cancelMember and a member id. Alan and AXA stay behind this port so Company 1 and Company 2 share one Insurance product.',
  },
  {
    id: 'alan',
    context: 'Carrier',
    title: 'Alan adapter',
    blurb: 'Company 1 · InsurerGateway',
    about:
      'Carrier ACL adapter for Company 1 (API-style affiliate). Same EnrolEmployee path as AXA; only the adapter DTO differs. Domain events stay free of Alan types.',
  },
  {
    id: 'axa',
    context: 'Carrier',
    title: 'AXA adapter',
    blurb: 'Company 2 · InsurerGateway',
    about:
      'Carrier ACL adapter for Company 2 (OC-style affiliate, optional rate sheet). Domain events leaving Insurance stay carrier-free — only this adapter knows AXA shapes.',
  },
  {
    id: 'events',
    context: 'Insurance',
    title: 'Domain event outbox',
    blurb: 'Commit then publish',
    about:
      'Transactional outbox for EmployeeEnrolledInInsurance and PremiumInstructionIssued. Rows are written with Active in one commit, then published only after that — so Payroll never sees a phantom Active.',
  },
  {
    id: 'publisher',
    context: 'Insurance',
    title: 'Event publisher',
    blurb: 'Outbox → bus',
    about:
      'Drains committed outbox rows onto the bus. If the process crashes mid-publish, the row stays unpublished and the next tick retries. Does not change Enrolment state.',
  },
  {
    id: 'bus',
    context: 'Insurance',
    title: 'Event bus',
    blurb: 'Fan-out to observers',
    about:
      'In-process stand-in for the platform event bus. Observers subscribe by event type. They must not open the Enrolment table — only the published payload crosses the boundary.',
  },
  {
    id: 'payroll',
    context: 'Payroll',
    title: 'Payroll observer',
    blurb: 'Reacts to premiums',
    about:
      'Subscribes to PremiumInstructionIssued (and stop/cancel). Materialises Santé bulletin lines in EUR cents. Never writes Enrolment; Insurance never writes payroll tables.',
  },
  {
    id: 'payslip',
    context: 'Payroll',
    title: 'Santé payroll lines',
    blurb: 'Employer + employee €',
    about:
      'Stored employerShareCents and employeeShareCents for the Paris calendar month of effectiveFrom. They sum to the premium. Demo UI reads these for the payslip strip.',
  },
  {
    id: 'deadletter',
    context: 'Insurance',
    title: 'Dead-letter counter',
    blurb: 'Fail after 3 tries',
    about:
      'Counts createMember transport / timeout failures. After three attempts the enrolment becomes Failed — never a silent Active. Makes carrier outages visible in the demo.',
  },
];

export const ARCH_EDGES: ArchEdge[] = [
  {
    id: 'e-command',
    from: 'ui',
    to: 'api',
    label: 'command',
    how: 'http',
    about:
      'HR posts an Insurance command (enrol, dispense, cancel…). The API authenticates the company header and starts a transaction. Enrol returns 202, not Active.',
  },
  {
    id: 'e-pending',
    from: 'api',
    to: 'enrolment',
    label: 'write Pending',
    how: 'direct',
    about:
      'Same request: Enrolment is created as PendingExternal. Status must not be Active until InsurerGateway.createMember succeeds.',
  },
  {
    id: 'e-idem',
    from: 'api',
    to: 'idempotency',
    label: 'store key',
    how: 'direct',
    about:
      'Persists the Idempotency-Key with the 202 payload in the enrol transaction so a retry is a no-op create.',
  },
  {
    id: 'e-audit',
    from: 'api',
    to: 'audit',
    label: 'audit',
    how: 'direct',
    about: 'Writes an audit row for the command (who, what, when) without changing FSM status.',
  },
  {
    id: 'e-handoff',
    from: 'api',
    to: 'handoff',
    label: 'handoff row',
    how: 'direct',
    about:
      'ActivateEnrolmentRequested (or equivalent handoff) stored with Pending in one TX. The API does not call Alan/AXA inline.',
  },
  {
    id: 'e-poll',
    from: 'enrolment',
    to: 'worker',
    label: 'scan Pending',
    how: 'async',
    about:
      'Worker claims PendingExternal rows (SKIP LOCKED). This is a later tick — not the original HTTP enrol request.',
  },
  {
    id: 'e-member',
    from: 'worker',
    to: 'gateway',
    label: 'createMember',
    how: 'direct',
    about:
      'Worker asks the gateway to affiliate the employee. Domain still speaks only member id / rate params — no Alan/AXA types.',
  },
  {
    id: 'e-alan',
    from: 'gateway',
    to: 'alan',
    label: 'Alan',
    how: 'direct',
    about: 'InsurerGateway routes Company 1 to the Alan adapter. Request/response JSON is logged for the demo.',
  },
  {
    id: 'e-axa',
    from: 'gateway',
    to: 'axa',
    label: 'AXA',
    how: 'direct',
    about: 'InsurerGateway routes Company 2 to the AXA adapter (optional setup-sheet rates). Same domain result shape as Alan.',
  },
  {
    id: 'e-active',
    from: 'worker',
    to: 'enrolment',
    label: 'write Active',
    how: 'direct',
    about:
      'After carrier success, Enrolment becomes Active. Terminate still wins if the employee left meanwhile.',
  },
  {
    id: 'e-domain',
    from: 'worker',
    to: 'events',
    label: 'outbox write',
    how: 'direct',
    about:
      'EmployeeEnrolledInInsurance and PremiumInstructionIssued written in the same commit as Active.',
  },
  {
    id: 'e-publish',
    from: 'events',
    to: 'publisher',
    label: 'drain',
    how: 'async',
    about: 'Publisher picks unpublished outbox rows on a later tick and pushes them to the bus.',
  },
  {
    id: 'e-bus',
    from: 'publisher',
    to: 'bus',
    label: 'publish',
    how: 'bus',
    about: 'Committed events become visible to subscribers. At-least-once; consumers must be idempotent.',
  },
  {
    id: 'e-observe',
    from: 'bus',
    to: 'payroll',
    label: 'PremiumInstruction',
    how: 'bus',
    about:
      'Payroll receives PremiumInstructionIssued (employer/employee cents). It must not open Enrolment.',
  },
  {
    id: 'e-lines',
    from: 'payroll',
    to: 'payslip',
    label: 'store lines',
    how: 'direct',
    about: 'Payroll observer persists payroll_lines (employerShareCents + employeeShareCents) for the demo projection.',
  },
  {
    id: 'e-left',
    from: 'employee',
    to: 'api',
    label: 'Terminated',
    how: 'http',
    about:
      'EmployeeTerminated from the Employee context. Insurance ends open Enrolment (→ Ended), emits EnrolmentCancelled, and PremiumInstructionStop if Issued already existed. Terminate wins over a racing activate.',
  },
  {
    id: 'e-fail',
    from: 'worker',
    to: 'deadletter',
    label: 'Failed @ 3',
    how: 'direct',
    about:
      'After three createMember transport failures, enrolment is Failed and the dead-letter counter moves. No silent Active.',
  },
  {
    id: 'e-reset',
    from: 'ui',
    to: 'api',
    label: 'reset',
    how: 'http',
    about: 'Demo helper to reseed. Not part of the production Insurance vertical.',
  },
  {
    id: 'e-q-catalog',
    from: 'ui',
    to: 'api',
    label: 'catalog',
    how: 'http',
    query: true,
    about: 'Read-only seed catalog (companies, plans, people). Does not move the Enrolment FSM.',
  },
  {
    id: 'e-q-audit',
    from: 'ui',
    to: 'audit',
    label: 'audit GET',
    how: 'http',
    query: true,
    about: 'Read-only audit trail for the selected company.',
  },
  {
    id: 'e-q-enrol',
    from: 'ui',
    to: 'enrolment',
    label: 'enrolment',
    how: 'http',
    query: true,
    about: 'Read-only enrolment list / detail (including Pending age). Polls for Active after enrol.',
  },
  {
    id: 'e-q-pay',
    from: 'ui',
    to: 'payslip',
    label: 'payslip',
    how: 'http',
    query: true,
    about: 'Read-only Santé payroll lines after a premium instruction was observed.',
  },
];

/** One row on the diagram. `edgeIds` play in order. A trailing `~` travels back along that link. */
export interface ArchStep {
  key: string;
  at: string;
  service: string;
  kind: string;
  element: string;
  log: string;
  edgeIds: string[];
  /** Nodes to emphasise when this row has no link to travel. */
  focus: string[];
  /** The packet is the answer arriving at Admin UI. */
  toUser: boolean;
  /** Nodes now waiting on another process. */
  waiting: string[];
  /** Nodes whose wait ended with this row. */
  settled: string[];
}

/** Docs, the evidence column, and Reset to seed are not part of the vertical. */
export function includeInStory(item: DevLogEntry): boolean {
  if (item.msg === 'demo.reset') return false;
  if (item.msg !== 'http') return true;
  const url = String(item.fields.url ?? '').split('?')[0];
  if (url.startsWith('/docs')) return false;
  if (url.endsWith('/impulses') || url.endsWith('/dev-logs')) return false;
  if (url.includes('/dev/reset')) return false;
  return true;
}

function carrierEdge(wired: 'alan' | 'axa' | null): string {
  return wired === 'axa' ? 'e-axa' : 'e-alan';
}

function movements(kind: string, element: string, wired: 'alan' | 'axa' | null): string[] {
  const carrier = carrierEdge(wired);
  if (kind === 'Command') return ['e-command'];
  if (kind === 'Query' && element === 'payroll_lines') return ['e-q-pay'];
  if (kind === 'Query' && element === 'Seed catalog') return ['e-q-catalog'];
  if (kind === 'Query' && element === 'Audit trail') return ['e-q-audit'];
  if (kind === 'Query') return ['e-q-enrol'];
  if (kind === 'Monitor') return ['e-poll'];
  if (kind === 'Aggregate' && element === 'Failed') return ['e-fail'];
  if (
    kind === 'Aggregate' &&
    (element === 'Still PendingExternal' || element === 'Terminate wins')
  ) {
    return ['e-member', carrier];
  }
  if (kind === 'ACL') return ['e-member', carrier];
  if (kind === 'Outbox' && element === 'ActivateEnrolmentRequested') return ['e-handoff'];
  if (kind === 'Outbox') return ['e-publish', 'e-bus'];
  if (
    kind === 'Observer' &&
    (element === 'PremiumInstructionIssued' || element === 'PremiumInstructionStop')
  ) {
    return ['e-observe', 'e-lines'];
  }
  if (kind === 'Observer' && element === 'EmployeeTerminated') {
    return ['e-left'];
  }
  return [];
}

interface Piece {
  kind: string;
  element: string;
  log: string;
  edgeIds?: string[];
  focus?: string[];
  toUser?: boolean;
  waiting?: string[];
  settled?: string[];
}

function replyEdge(element: string): string {
  if (element === 'payroll_lines') return 'e-q-pay';
  if (element === 'Seed catalog') return 'e-q-catalog';
  if (element === 'Audit trail') return 'e-q-audit';
  return 'e-q-enrol';
}

/** One dev log, opened into every element that log actually touches. */
function pieces(kind: string, element: string, line: string, wired: 'alan' | 'axa' | null): Piece[] {
  const carrier = carrierEdge(wired);
  const carrierName = wired === 'axa' ? 'AXA' : 'Alan';
  const carrierNode = wired === 'axa' ? 'axa' : 'alan';

  if (kind === 'Command' && element === 'EnrolEmployee') {
    return [
      { kind, element, log: line, edgeIds: ['e-command'] },
      {
        kind: 'Aggregate',
        element: 'PendingExternal',
        log: 'Enrolment written as PendingExternal in this request. Status is not Active.',
        edgeIds: ['e-pending'],
      },
      {
        kind: 'Outbox',
        element: 'ActivateEnrolmentRequested',
        log: 'ActivateEnrolmentRequested outbox row in the same TX. Not published on the bus; the worker scans PendingExternal later.',
        edgeIds: ['e-handoff'],
        waiting: ['handoff', 'enrolment', 'worker'],
      },
      {
        kind: 'Process',
        element: 'Audit',
        log: 'Audit row beside the aggregate. It does not choose the next FSM status.',
        edgeIds: ['e-audit'],
      },
      {
        kind: 'Process',
        element: 'Idempotency',
        log: 'Idempotency-Key and 202 body stored. A retry returns the same enrolment id.',
        edgeIds: ['e-idem'],
      },
      {
        kind: 'Response',
        element: '202 Accepted',
        log: 'HTTP 202 now. Enrolment stays PendingExternal until worker + InsurerGateway confirm.',
        edgeIds: ['e-command~'],
        toUser: true,
        settled: ['ui'],
      },
    ];
  }

  if (kind === 'Command' && element === 'DispenseEmployee') {
    return [
      { kind, element, log: line, edgeIds: ['e-command'] },
      {
        kind: 'Aggregate',
        element: 'Dispensed',
        log: 'Enrolment → Dispensed. No Active, no PremiumInstructionIssued.',
        edgeIds: ['e-pending'],
      },
      {
        kind: 'Process',
        element: 'Audit',
        log: 'Dispense reason stored on the audit log. No Santé cotisation instruction.',
        edgeIds: ['e-audit'],
      },
      {
        kind: 'Response',
        element: 'Dispensed',
        log: 'Response: Enrolment is Dispensed. No premium instruction.',
        edgeIds: ['e-command~'],
        toUser: true,
        settled: ['ui'],
      },
    ];
  }

  if (kind === 'Command' && element === 'CancelEnrolment') {
    return [
      { kind, element, log: line, edgeIds: ['e-command'] },
      {
        kind: 'Aggregate',
        element: 'Ended',
        log: 'Enrolment → Ended in this request. Payroll learns via events, not by reading Enrolment.',
        edgeIds: ['e-pending'],
      },
      {
        kind: 'Outbox',
        element: 'EnrolmentCancelled',
        log: 'EnrolmentCancelled committed to the domain outbox. Publisher has not handed it to the bus yet.',
        edgeIds: ['e-domain'],
        waiting: ['events', 'publisher'],
      },
      {
        kind: 'Process',
        element: 'Audit',
        log: 'Cancel actor stored on the audit log beside the aggregate.',
        edgeIds: ['e-audit'],
      },
      {
        kind: 'Response',
        element: 'Ended',
        log: 'Response: Enrolment status is Ended.',
        edgeIds: ['e-command~'],
        toUser: true,
        settled: ['ui'],
      },
    ];
  }

  if (kind === 'Aggregate' && element === 'PendingExternal → Active') {
    return [
      {
        kind: 'Monitor',
        element: 'Worker',
        log: 'Worker tick selects PendingExternal enrolments (SKIP LOCKED). The handoff row supplies correlationId; it is not bus-published.',
        edgeIds: ['e-poll'],
        settled: ['enrolment', 'worker', 'handoff'],
      },
      {
        kind: 'ACL',
        element: 'InsurerGateway',
        log: 'Worker calls InsurerGateway.createMember (no Alan/AXA types in the domain).',
        edgeIds: ['e-member'],
        waiting: ['gateway', carrierNode],
      },
      {
        kind: 'ACL',
        element: carrierName,
        log: `Request reaches the ${carrierName} adapter through InsurerGateway (ACL).`,
        edgeIds: [carrier],
        waiting: [carrierNode],
      },
      {
        kind: 'ACL',
        element: `${carrierName} · member id`,
        log: `${carrierName} returns a member id on the same call. Gateway wait ends.`,
        edgeIds: [`${carrier}~`],
        settled: ['gateway', 'alan', 'axa'],
      },
      {
        kind,
        element,
        log: line,
        edgeIds: ['e-active'],
        settled: ['enrolment'],
      },
      {
        kind: 'Outbox',
        element: 'EmployeeEnrolledInInsurance',
        log: 'Domain outbox row committed with Active in the same TX. Not on the bus yet.',
        edgeIds: ['e-domain'],
        waiting: ['events', 'publisher'],
      },
      {
        kind: 'Outbox',
        element: 'PremiumInstructionIssued',
        log: 'Premium cents (Paris month, ANI split) committed in the same TX. Publishing is the next worker step.',
        edgeIds: ['e-domain'],
        waiting: ['events', 'publisher', 'payroll'],
      },
    ];
  }

  if (
    kind === 'Aggregate' &&
    (element === 'Still PendingExternal' || element === 'Terminate wins')
  ) {
    return [
      {
        kind: 'ACL',
        element: 'createMember',
        log: line,
        edgeIds: ['e-member', carrier],
        waiting: ['gateway', carrierNode],
      },
      {
        kind: 'Aggregate',
        element,
        log:
          element === 'Terminate wins'
            ? 'EmployeeTerminated won the race. Enrolment is not left Active.'
            : 'Transport failed. Enrolment stays PendingExternal — never silent Active.',
        focus: ['enrolment', 'worker'],
        settled: ['gateway', 'alan', 'axa'],
      },
    ];
  }

  if (kind === 'Query') {
    const edge = replyEdge(element);
    const enrolmentQuery =
      element === 'Enrolment' || element === 'Enrolment list' || element === 'Enrolment by id';    return [
      {
        kind: 'Query',
        element,
        log: enrolmentQuery
          ? 'GET enrolment projection (PendingExternal | Active | …). The FSM does not move.'
          : line,
        edgeIds: [edge],
      },
      {
        kind: 'Response',
        element: enrolmentQuery ? 'Enrolment status' : element,
        log: enrolmentQuery
          ? 'Response body is current Enrolment status. Active only after it is already stored — never invented on read.'
          : line,
        edgeIds: [`${edge}~`],
        toUser: true,
        settled: ['ui'],
      },
    ];
  }

  if (kind === 'Outbox' && element === 'ActivateEnrolmentRequested') {
    return [
      {
        kind,
        element,
        log: line,
        edgeIds: ['e-handoff'],
        waiting: ['handoff', 'enrolment', 'worker'],
      },
    ];
  }

  if (kind === 'Outbox') {
    const payrollToo = element === 'PremiumInstructionIssued';
    return [
      {
        kind: 'Process',
        element: 'Publisher',
        log: 'claimUnpublished drains domain outbox (ActivateEnrolmentRequested is excluded).',
        edgeIds: ['e-publish'],
        settled: ['events'],
      },
      {
        kind: 'Process',
        element: 'Bus',
        log: line,
        edgeIds: ['e-bus'],
        settled: payrollToo ? ['publisher', 'payroll'] : ['publisher'],
      },
    ];
  }

  if (
    kind === 'Observer' &&
    (element === 'PremiumInstructionIssued' || element === 'PremiumInstructionStop')
  ) {
    return [
      {
        kind,
        element,
        log: line,
        edgeIds: ['e-observe'],
        settled: ['payroll'],
      },
      {
        kind: 'Process',
        element: 'payroll_lines',
        log: 'Payroll observer writes patronale + salariale lines. It never writes Enrolment.',
        edgeIds: ['e-lines'],
      },
    ];
  }

  if (kind === 'Monitor') {
    return [{ kind, element, log: line, edgeIds: ['e-poll'], settled: ['worker', 'enrolment'] }];
  }

  if (kind === 'Process' && element === 'API') {
    return [{ kind, element, log: line, focus: ['api'] }];
  }
  if (kind === 'Process' && element === 'Worker') {
    return [{ kind, element, log: line, focus: ['worker'] }];
  }

  const edgeIds = movements(kind, element, wired);
  if (edgeIds.length === 0) {
    return [{ kind, element, log: line, focus: [kind === 'Monitor' ? 'worker' : 'api'] }];
  }
  return [{ kind, element, log: line, edgeIds }];
}

/** Every process log, including the elements inside it and the answer back to the screen. */
export function flowStep(item: DevLogEntry, key: string, wired: 'alan' | 'axa' | null): ArchStep[] {
  const reading = readDevLine(item);
  return pieces(reading.kind, reading.element, reading.line, wired).map((piece, index) => ({
    key: index === 0 ? key : `${key}|${index}`,
    at: item.ts,
    service: reading.service,
    kind: piece.kind,
    element: piece.element,
    log: piece.log,
    edgeIds: piece.edgeIds ?? [],
    focus: piece.focus ?? [],
    toUser: piece.toUser ?? false,
    waiting: piece.waiting ?? [],
    settled: piece.settled ?? [],
  }));
}

/** Ids already present in this company's stored evidence. */
export function seenMarks(item: Impulse): string[] {
  const type = String(item.payload.eventType ?? '');
  if (item.source === 'enrolments' || item.source === 'audit_log') {
    return ['api', 'enrolment', 'audit', 'e-pending', 'e-audit', 'e-command'];
  }
  if (item.source === 'idempotency_keys') return ['api', 'idempotency', 'e-idem'];
  if (item.source === 'outbox' && type === 'ActivateEnrolmentRequested') {
    return ['api', 'handoff', 'worker', 'e-handoff', 'e-poll'];
  }
  if (item.source === 'outbox') {
    return ['worker', 'events', 'publisher', 'bus', 'e-domain', 'e-publish', 'e-bus'];
  }
  if (item.source.includes('last-alan')) return ['worker', 'gateway', 'alan', 'e-member', 'e-alan'];
  if (item.source.includes('last-axa')) return ['worker', 'gateway', 'axa', 'e-member', 'e-axa'];
  if (item.source === 'payroll_lines') return ['payroll', 'payslip', 'bus', 'e-observe', 'e-lines'];
  if (item.source === 'dead_letter_counters') return ['worker', 'deadletter', 'e-fail'];
  return [];
}
