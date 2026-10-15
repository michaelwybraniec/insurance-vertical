import type { DevLogEntry } from './api';

/** Closed set so every row uses the same word in the Kind column. */
export type DesignKind =
  | 'Process'
  | 'Monitor'
  | 'Observer'
  | 'Outbox'
  | 'Aggregate'
  | 'Command'
  | 'Query'
  | 'ACL'
  | 'Harness';

export interface DesignReading {
  service: string;
  serviceName: string;
  kind: DesignKind;
  /** Short name. Same shape on every row: noun, or noun · detail. */
  element: string;
  /** Short operator-facing description for the closed row (not a product “why”). */
  line: string;
  /**
   * Industry-standard write-up shown when the row is open:
   * intent, boundary, and what is guaranteed.
   */
  detail: string;
}

const SERVICE_NAMES: Record<string, string> = {
  api: 'Insurance API. Commands and queries enter here.',
  worker: 'Insurance worker. Finishes work after the API has returned.',
};

interface Note {
  kind: DesignKind;
  element: string;
  line: string;
  detail: string;
}

const BY_MESSAGE: Record<string, Note> = {
  'api.listen': {
    kind: 'Process',
    element: 'API',
    line: 'HTTP adapter is listening. Commands cross this edge.',
    detail: 'The Enrolment aggregate does not own a port. The API process is the edge where commands and queries enter Insurance.',
  },
  'worker.start': {
    kind: 'Process',
    element: 'Worker',
    line: 'Second process is up. It does not run inside the HTTP request.',
    detail: 'The worker drains the outbox and calls the carrier. The API can return 202 without waiting for Alan or AXA.',
  },
  'worker.tick': {
    kind: 'Monitor',
    element: 'Pending + outbox',
    line: 'Polls Pending enrolments, then unpublished outbox rows.',
    detail: 'This is the monitor. Each tick looks for work instead of being called by the API. Activate runs first, then publish, so a publish failure does not roll back Active.',
  },
  'worker.tick_error': {
    kind: 'Monitor',
    element: 'Tick failed',
    line: 'The poll failed. The aggregate was not moved to Active.',
    detail: 'The monitor reports the failure in the open. A crashed tick must not leave Enrolment Active.',
  },
  'activate.ok': {
    kind: 'Aggregate',
    element: 'PendingExternal → Active',
    line: 'InsurerGateway returned a member id. PendingExternal → Active is legal.',
    detail: 'Aggregate transition PendingExternal → Active after InsurerGateway.createMember succeeds. Same DB transaction records Active, insurerMemberId, EmployeeEnrolledInInsurance, and PremiumInstructionIssued (EUR cents, Paris month, ≥50% employer). Domain remains carrier-agnostic—Alan/AXA types stop at the ACL. Guarantee: no silent Active without a member id.',
  },
  'activate.skipped_after_race': {
    kind: 'Aggregate',
    element: 'Terminate wins',
    line: 'EmployeeTerminated arrived while createMember was in flight.',
    detail: 'EmployeeTerminated won the race. Enrolment must not stay Active. If the carrier already created a member, InsurerGateway.cancelMember runs.',
  },
  'activate.retry': {
    kind: 'Aggregate',
    element: 'Still PendingExternal',
    line: 'Transport failed. Enrolment stays PendingExternal — not Active.',
    detail: 'Pending honesty. Attempt count increments; the monitor retries. Enrolment is not Active.',
  },
  'activate.failed': {
    kind: 'Aggregate',
    element: 'Failed',
    line: 'Three transport failures. Dead-letter counter moves. No silent Active.',
    detail: 'Monitor gave up. Enrolment → Failed and the dead-letter counter moves. Never Active without carrier confirm.',
  },
  'payroll.issued': {
    kind: 'Observer',
    element: 'PremiumInstructionIssued',
    line: 'Payroll observer materialised bulletin lines. It does not write Enrolment.',
    detail: 'Payroll bounded-context observer on PremiumInstructionIssued. After outbox publish, it materialises patronale + salariale lines from the instruction cents. Guarantee: observer never writes Enrolment; Insurance never writes payroll_lines.',
  },
  'payroll.stop': {
    kind: 'Observer',
    element: 'PremiumInstructionStop',
    line: 'Payroll observer deactivated bulletin lines. It does not write Enrolment.',
    detail: 'Same observer on PremiumInstructionStop. Deactivates stored lines. Still does not touch Enrolment.',
  },
  'terminate.no_cover': {
    kind: 'Observer',
    element: 'EmployeeTerminated',
    line: 'EmployeeTerminated arrived. No PendingExternal|Active Enrolment to end.',
    detail: 'Insurance observes EmployeeTerminated. It does not own the person. No open Enrolment here, so nothing ended. Duplicate event id is ignored before this line.',
  },
  'demo.reset': {
    kind: 'Harness',
    element: 'Demo reset',
    line: 'Reloads the seed catalog. This is not a domain command.',
    detail: 'The demo harness wipes enrolments, outbox, audit, and payroll lines, then loads companies, the plan, and people again.',
  },
};

const OUTBOX: Record<string, Note> = {
  EmployeeEnrolledInInsurance: {
    kind: 'Outbox',
    element: 'EmployeeEnrolledInInsurance',
    line: 'Published. Other contexts learn Active from this event, not from the Enrolment table.',
    detail: 'Publisher handed EmployeeEnrolledInInsurance to the bus. Observers subscribe. They do not read Enrolment. Payload is ids + member id, not a carrier DTO.',
  },
  PremiumInstructionIssued: {
    kind: 'Outbox',
    element: 'PremiumInstructionIssued',
    line: 'Published employerShareCents + employeeShareCents for the Paris month.',
    detail: 'Insurance computed ANI shares in EUR cents. Payroll owns the bulletin and must not invent the amounts.',
  },
  EnrolmentCancelled: {
    kind: 'Outbox',
    element: 'EnrolmentCancelled',
    line: 'Published. CancelEnrolment and EmployeeTerminated share this event.',
    detail: 'Admin CancelEnrolment and EmployeeTerminated both emit EnrolmentCancelled so Payroll does not special-case the cause. The person is not deleted.',
  },
  PremiumInstructionStop: {
    kind: 'Outbox',
    element: 'PremiumInstructionStop',
    line: 'Published only because PremiumInstructionIssued already existed.',
    detail: 'Dispense, or cancel before Active, must not invent a payslip reversal. The Payroll observer deactivates lines it already stored.',
  },
  ActivateEnrolmentRequested: {
    kind: 'Outbox',
    element: 'ActivateEnrolmentRequested',
    line: 'Internal handoff row. Not on the bus; worker scans PendingExternal.',
    detail: 'Written in the EnrolEmployee transaction with PendingExternal so a crash cannot lose the work. Worker selects PendingExternal, reads this row for correlationId, marks it published. Payroll never sees it.',
  },
};

function note(partial: Note): Note {
  return partial;
}

function httpReading(fields: Record<string, unknown>): Note {
  const method = String(fields.method ?? 'HTTP');
  const url = String(fields.url ?? '').split('?')[0];

  if (method === 'POST' && /\/enrolments$/.test(url)) {
    return note({
      kind: 'Command',
      element: 'EnrolEmployee',
      line: 'Accepts the command. Pending and the outbox row share one transaction.',
      detail: 'Command EnrolEmployee within the company tenant. Creates PendingExternal + ActivateEnrolmentRequested in one transaction, returns HTTP 202. Status is not Active in this request — the worker completes affiliation asynchronously. Guarantees: idempotent on Idempotency-Key; never Active before InsurerGateway confirms.',
    });
  }
  if (method === 'POST' && url.includes('/dispenses')) {
    return note({
      kind: 'Command',
      element: 'DispenseEmployee',
      line: 'Enrolment → Dispensed. No Active, no PremiumInstructionIssued.',
      detail: 'Command DispenseEmployee for legal exemption. Transition to Dispensed with audit reason. No Active, no PremiumInstructionIssued. Blocked if PendingExternal|Active already exists.',
    });
  }
  if (method === 'POST' && url.includes('/cancellations')) {
    return note({
      kind: 'Command',
      element: 'CancelEnrolment',
      line: 'Enrolment → Ended. Payroll learns via EnrolmentCancelled, not the table.',
      detail: 'Command CancelEnrolment ends PendingExternal or Active for this companyId. Always emits EnrolmentCancelled; PremiumInstructionStop only if PremiumInstructionIssued already existed. Payroll must not read Enrolment.',
    });
  }
  if (method === 'GET' && url.includes('/enrolments')) {
    return note({
      kind: 'Query',
      element: 'Enrolment',
      line: 'Read Enrolment projection. The FSM does not move.',
      detail: 'Query enrolments scoped by X-Company-Id. Admin UI polls for status. Does not mutate the Enrolment FSM and never calls InsurerGateway. Side effects limited to audit/telemetry.',
    });
  }
  if (url.includes('/webhooks/carriers')) {
    return note({
      kind: 'ACL',
      element: 'Carrier webhook',
      line: 'Carrier language stops at this edge. A duplicate event id is a no-op.',
      detail: 'Inbound anti-corruption layer. The domain sees a confirmation, not the partner DTO.',
    });
  }
  if (url.includes('/platform-events')) {
    return note({
      kind: 'Observer',
      element: 'EmployeeTerminated',
      line: 'EmployeeTerminated. Insurance ends open Enrolment only.',
      detail: 'Insurance does not own the person. Terminate wins over concurrent activate. Duplicate event id is a no-op.',
    });
  }
  if (url.includes('/payroll-lines')) {
    return note({
      kind: 'Query',
      element: 'payroll_lines',
      line: 'Read payroll_lines (Payroll context). Does not write Enrolment.',
      detail: 'Query payroll_lines for the company. Rows are written by the Payroll observer after PremiumInstructionIssued (employerShareCents + employeeShareCents). GET only projects stored cents — no recompute, no Enrolment write.',
    });
  }
  if (url.includes('/audit')) {
    return note({
      kind: 'Query',
      element: 'Audit trail',
      line: 'Reads who did what. It does not decide the next status.',
      detail: 'Audit sits beside the aggregate. The finite-state machine still lives on Enrolment.',
    });
  }
  if (url.includes('/dev/reset')) return BY_MESSAGE['demo.reset'];
  if (/\/companies\/[^/]+$/.test(url)) {
    return note({
      kind: 'Query',
      element: 'Seed catalog',
      line: 'Screen monitor reads company, plan, and people. Carrier is not chosen here.',
      detail: 'Catalog query returning seeded company, plan (≥50% employer share), and employees. Carrier binding is configuration (Company 1→Alan, Company 2→AXA), not a runtime marketplace choice. Guarantee: same EnrolEmployee command shape across carriers; only the ACL adapter differs.',
    });
  }
  if (url.includes('/me/cover')) {
    return note({
      kind: 'Query',
      element: 'GET /me/cover',
      line: 'employee.self reads own Enrolment projection. Cannot EnrolEmployee.',
      detail: 'employee.self scoped to one employeeId + companyId. Read-only Enrolment status; cannot see another company or issue commands.',
    });
  }
  return note({
    kind: 'Query',
    element: 'HTTP',
    line: 'A request crossed the API edge. Company on the URL must match the header.',
    detail: 'Tenancy: X-Company-Id must match the company in the URL, or the call is refused.',
  });
}

export function readDevLine(item: DevLogEntry): DesignReading {
  const service = item.service || 'app';
  const serviceName = SERVICE_NAMES[service] ?? `${service} process`;
  const known =
    item.msg === 'http'
      ? httpReading(item.fields)
      : item.msg === 'outbox.published'
        ? OUTBOX[String(item.fields.eventType ?? '')] ?? {
            kind: 'Outbox' as const,
            element: 'Published',
            line: 'A committed row was handed to the bus.',
            detail: 'Observers see the event, not the Enrolment table. An unpublished row survives a crash and the monitor takes it on a later tick.',
          }
        : BY_MESSAGE[item.msg] ?? {
            kind: 'Process' as const,
            element: item.msg,
            line: 'A process wrote this line.',
            detail: 'Open the row for the payload that crossed this hop.',
          };
  return { service, serviceName, ...known };
}
