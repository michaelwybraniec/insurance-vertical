export type CompanyId = 'company-a' | 'company-b';

export interface CompanyCatalog {
  id: string;
  name: string;
  carrier: 'alan' | 'axa';
  insuranceEnabled: boolean;
  plan: {
    id: string;
    name: string;
    monthlyPremiumCents: number;
    employerSharePct: number;
  } | null;
  employees: Array<{ id: string; name: string; active: boolean }>;
  dispenseReasons: Array<{ code: string; label: string }>;
}

export type ImpulseReality = 'real' | 'mock' | 'seed';

export interface Impulse {
  id: string;
  at: string | null;
  title: string;
  description: string;
  technology: string;
  why: string;
  reality: ImpulseReality;
  layer: string;
  source: string;
  correlationId: string | null;
  enrolmentId: string | null;
  payload: Record<string, unknown>;
}

export interface ImpulseFeed {
  companyId: string;
  contract: Array<{ field: string; means: string }>;
  items: Impulse[];
}

export interface DevLogEntry {
  ts: string;
  level: 'info' | 'warn' | 'error';
  service: string;
  msg: string;
  fields: Record<string, unknown>;
}

export interface AuditEntry {
  id: string;
  companyId: string;
  enrolmentId: string | null;
  action: string;
  correlationId: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface EnrolmentView {
  enrolmentId: string;
  companyId: string;
  employeeId: string;
  planId: string;
  status: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  insurerMemberId?: string | null;
  carrier: string;
  attemptCount?: number;
  pendingAgeSeconds?: number | null;
  lastPremium?: {
    employerShareCents: number;
    employeeShareCents: number;
    periodFrom: string;
    periodTo: string;
  } | null;
}

export interface PayrollLine {
  companyId: string;
  employeeId: string;
  enrolmentId: string;
  kind: string;
  amountCents: number;
  currency: string;
  periodFrom: string;
  periodTo: string;
  active: boolean;
  sourceEventId: string;
}

async function request<T>(
  path: string,
  init: RequestInit & { companyId: string; role?: string; employeeId?: string },
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('X-Role', init.role ?? 'company.admin');
  headers.set('X-Company-Id', init.companyId);
  if (init.employeeId) headers.set('X-Employee-Id', init.employeeId);

  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { message?: string }).message ?? res.statusText;
    throw new Error(explainApiError(res.status, msg));
  }
  return body as T;
}

/** Turn API conflict/validation messages into plain-language UI copy. */
export function explainApiError(status: number, message: string): string {
  const m = message.toLowerCase();
  if (
    m.includes('pending or active enrolment') ||
    m.includes('active or pending enrolment')
  ) {
    return (
      'This person already has open cover (Waiting on carrier or Covered). ' +
      'Cancel that enrolment first — or pick someone else. You cannot enrol and dispense at the same time.'
    );
  }
  if (m.includes('insurance disabled')) {
    return 'Insurance is turned off for this company, so enrol and dispense are blocked.';
  }
  if (m.includes('employee inactive')) {
    return 'This employee is inactive (left / HR-terminated), so they cannot be enrolled.';
  }
  if (m.includes('cannot cancel')) {
    return 'This enrolment cannot be cancelled in its current status (already ended, failed, or exempt).';
  }
  if (status === 403) {
    return 'Forbidden for this company — check you are acting as the right HR agent.';
  }
  if (status === 404) {
    return message || 'Not found.';
  }
  if (status === 409) {
    return message || 'Conflict — the current state does not allow this action.';
  }
  return status ? `${status}: ${message}` : message;
}

export const api = {
  getCompany: (companyId: string) =>
    request<CompanyCatalog>(`/v1/companies/${companyId}`, {
      method: 'GET',
      companyId,
    }),

  listEnrolments: (companyId: string, includeEnded = false) =>
    request<{ items: EnrolmentView[] }>(
      `/v1/companies/${companyId}/enrolments?includeEnded=${includeEnded}`,
      { method: 'GET', companyId },
    ),

  getEnrolment: (companyId: string, enrolmentId: string) =>
    request<EnrolmentView>(`/v1/enrolments/${enrolmentId}`, {
      method: 'GET',
      companyId,
    }),

  enrol: (
    companyId: string,
    payload: {
      employeeId: string;
      planId: string;
      coverage: string;
      effectiveFrom: string;
    },
    idempotencyKey: string,
  ) =>
    request<{ enrolmentId: string; status: string }>(
      `/v1/companies/${companyId}/enrolments`,
      {
        method: 'POST',
        companyId,
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload),
      },
    ),

  dispense: (companyId: string, payload: { employeeId: string; reasonCode: string }) =>
    request<{ enrolmentId: string; status: string; reasonCode: string }>(
      `/v1/companies/${companyId}/dispenses`,
      {
        method: 'POST',
        companyId,
        body: JSON.stringify(payload),
      },
    ),

  cancel: (companyId: string, enrolmentId: string) =>
    request<EnrolmentView>(`/v1/enrolments/${enrolmentId}/cancellations`, {
      method: 'POST',
      companyId,
      body: JSON.stringify({}),
    }),

  payrollLines: (companyId: string) =>
    request<{ items: PayrollLine[] }>(`/v1/companies/${companyId}/payroll-lines`, {
      method: 'GET',
      companyId,
    }),

  myCover: (companyId: string, employeeId: string) =>
    request<{
      employeeId: string;
      planName: string | null;
      status: string;
      effectiveFrom: string | null;
      effectiveTo: string | null;
    }>(`/v1/me/cover`, {
      method: 'GET',
      companyId,
      role: 'employee.self',
      employeeId,
    }),

  audit: (companyId: string, limit = 50) =>
    request<{ items: AuditEntry[] }>(`/v1/companies/${companyId}/audit?limit=${limit}`, {
      method: 'GET',
      companyId,
    }),

  impulses: (companyId: string) =>
    request<ImpulseFeed>(`/v1/companies/${companyId}/impulses`, {
      method: 'GET',
      companyId,
    }),

  devLogs: (companyId: string) =>
    request<{ items: DevLogEntry[] }>(`/v1/companies/${companyId}/dev-logs`, {
      method: 'GET',
      companyId,
    }),

  /** Demo helper — wipe transactional state and reload seed (zero open cover). */
  resetDemo: (companyId: string) =>
    request<{ ok: boolean; message: string }>(`/v1/dev/reset`, {
      method: 'POST',
      companyId,
      body: JSON.stringify({}),
    }),

  /** Demo helper — platform EmployeeTerminated (docs/base.md §7E step 9). */
  terminateEmployee: (
    companyId: string,
    employeeId: string,
    eventId?: string,
  ) =>
    request<{ handled: boolean; duplicate: boolean }>(`/v1/dev/platform-events`, {
      method: 'POST',
      companyId,
      role: 'system.worker',
      body: JSON.stringify({
        type: 'EmployeeTerminated',
        eventId: eventId ?? `ui-term-${companyId}-${employeeId}-${Date.now()}`,
        occurredAt: new Date().toISOString(),
        companyId,
        employeeId,
      }),
    }),
};
