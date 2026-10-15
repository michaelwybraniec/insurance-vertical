/**
 * In-browser stand-in for Fastify + Postgres + worker.
 * Intercepts fetch('/v1/...') so the real web UI can run on GitHub Pages.
 */

type CompanyId = 'company-a' | 'company-b';

interface Plan {
  id: string;
  name: string;
  monthlyPremiumCents: number;
  employerSharePct: number;
}

interface Employee {
  id: string;
  companyId: string;
  name: string;
  active: boolean;
}

interface Enrolment {
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
  reasonCode?: string;
  createdAt: number;
}

interface PayrollLine {
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

interface AuditEntry {
  id: string;
  companyId: string;
  enrolmentId: string | null;
  action: string;
  correlationId: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

interface Impulse {
  id: string;
  at: string | null;
  title: string;
  description: string;
  technology: string;
  why: string;
  reality: 'real' | 'mock' | 'seed';
  layer: string;
  source: string;
  correlationId: string | null;
  enrolmentId: string | null;
  payload: Record<string, unknown>;
}

interface DevLogEntry {
  ts: string;
  level: 'info' | 'warn' | 'error';
  service: string;
  msg: string;
  fields: Record<string, unknown>;
}

const PLAN: Plan = {
  id: 'sante-base',
  name: 'Santé Base',
  monthlyPremiumCents: 10000,
  employerSharePct: 60,
};

const COMPANIES: Record<
  CompanyId,
  { id: CompanyId; name: string; carrier: 'alan' | 'axa'; insuranceEnabled: boolean }
> = {
  'company-a': {
    id: 'company-a',
    name: 'Company 1',
    carrier: 'alan',
    insuranceEnabled: true,
  },
  'company-b': {
    id: 'company-b',
    name: 'Company 2',
    carrier: 'axa',
    insuranceEnabled: true,
  },
};

const SEED_EMPLOYEES: Employee[] = [
  { id: 'emp-a1', companyId: 'company-a', name: 'Employee 1', active: true },
  { id: 'emp-a2', companyId: 'company-a', name: 'Employee 2', active: true },
  { id: 'emp-b1', companyId: 'company-b', name: 'Employee 1', active: true },
  { id: 'emp-inactive', companyId: 'company-a', name: 'Inactive Employee', active: false },
];

const DISPENSE_REASONS = [
  { code: 'HAS_OWN_COVER', label: 'Employee has own complementary cover' },
];

const IMPULSE_CONTRACT = [
  {
    field: 'timestamp',
    means: 'When the fact was stored. Taken from the row, never invented in the UI.',
  },
  {
    field: 'title',
    means: 'Domain name of the fact (Enrol accepted, PremiumInstructionIssued, ACL createMember).',
  },
  {
    field: 'description',
    means: 'One sentence of what happened, in Insurance language.',
  },
  {
    field: 'technology',
    means: 'Which bounded context wrote it, and which mechanism (in-memory mock for this static demo).',
  },
  {
    field: 'why',
    means: 'Why this hop exists: the bounded context, the design element, and the invariant it protects.',
  },
  {
    field: 'payload',
    means: 'The actual JSON that crossed the boundary: ids, companyId, EUR cents.',
  },
  {
    field: 'reality',
    means: 'real = domain fact. mock = stub standing in for a carrier. seed = catalog loaded up front.',
  },
];

interface Store {
  employees: Employee[];
  enrolments: Enrolment[];
  payroll: PayrollLine[];
  audit: AuditEntry[];
  impulses: Impulse[];
  logs: DevLogEntry[];
  idempotency: Map<string, string>;
  timers: number[];
}

let store: Store = emptyStore();

function emptyStore(): Store {
  return {
    employees: SEED_EMPLOYEES.map((e) => ({ ...e })),
    enrolments: [],
    payroll: [],
    audit: [],
    impulses: [],
    logs: [],
    idempotency: new Map(),
    timers: [],
  };
}

function resetStore(): void {
  for (const t of store.timers) window.clearTimeout(t);
  store = emptyStore();
  pushLog('api', 'info', 'Static demo reset — catalog reloaded (no Postgres).', {});
  pushImpulse({
    companyId: 'company-a',
    title: 'Seed catalog loaded',
    description: 'Companies, employees, and Santé Base plan are in memory.',
    technology: 'static mock · seed',
    why: 'Same seed shape as the live POC so the UI can run without Docker.',
    reality: 'seed',
    layer: 'catalog',
    source: 'mock-api',
    enrolmentId: null,
    payload: { companies: Object.keys(COMPANIES), planId: PLAN.id },
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function correlation(headers: Headers): string {
  return headers.get('X-Correlation-Id') ?? uid('corr');
}

function companyFrom(headers: Headers, fallback?: string): string {
  return headers.get('X-Company-Id') ?? fallback ?? 'company-a';
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function err(status: number, message: string): Response {
  return json({ message }, status);
}

function pushLog(
  service: string,
  level: DevLogEntry['level'],
  msg: string,
  fields: Record<string, unknown>,
): void {
  store.logs.unshift({ ts: nowIso(), level, service, msg, fields });
  if (store.logs.length > 400) store.logs.length = 400;
}

function pushAudit(
  companyId: string,
  action: string,
  enrolmentId: string | null,
  correlationId: string,
  detail: Record<string, unknown>,
): void {
  store.audit.unshift({
    id: uid('aud'),
    companyId,
    enrolmentId,
    action,
    correlationId,
    detail,
    createdAt: nowIso(),
  });
}

function pushImpulse(input: {
  companyId: string;
  title: string;
  description: string;
  technology: string;
  why: string;
  reality: Impulse['reality'];
  layer: string;
  source: string;
  enrolmentId: string | null;
  payload: Record<string, unknown>;
  correlationId?: string | null;
}): void {
  store.impulses.unshift({
    id: uid('imp'),
    at: nowIso(),
    title: input.title,
    description: input.description,
    technology: input.technology,
    why: input.why,
    reality: input.reality,
    layer: input.layer,
    source: input.source,
    correlationId: input.correlationId ?? null,
    enrolmentId: input.enrolmentId,
    payload: { companyId: input.companyId, ...input.payload },
  });
}

function shares(): { employerShareCents: number; employeeShareCents: number } {
  const employerShareCents = Math.round(
    (PLAN.monthlyPremiumCents * PLAN.employerSharePct) / 100,
  );
  return {
    employerShareCents,
    employeeShareCents: PLAN.monthlyPremiumCents - employerShareCents,
  };
}

function periodAround(effectiveFrom: string): { periodFrom: string; periodTo: string } {
  const d = new Date(effectiveFrom);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const periodFrom = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const periodTo = `${y}-${String(m + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { periodFrom, periodTo };
}

function viewEnrolment(e: Enrolment): Enrolment {
  const pendingAgeSeconds =
    e.status === 'PendingExternal'
      ? Math.max(0, Math.floor((Date.now() - e.createdAt) / 1000))
      : null;
  return { ...e, pendingAgeSeconds, attemptCount: e.attemptCount ?? 1 };
}

function openCover(companyId: string, employeeId: string): Enrolment | undefined {
  return store.enrolments.find(
    (e) =>
      e.companyId === companyId &&
      e.employeeId === employeeId &&
      (e.status === 'PendingExternal' || e.status === 'Active'),
  );
}

function activateEnrolment(enrolmentId: string, correlationId: string): void {
  const e = store.enrolments.find((x) => x.enrolmentId === enrolmentId);
  if (!e || e.status !== 'PendingExternal') return;

  const company = COMPANIES[e.companyId as CompanyId];
  const memberId = `${company.carrier}-mem-${e.employeeId}`;
  const { employerShareCents, employeeShareCents } = shares();
  const { periodFrom, periodTo } = periodAround(e.effectiveFrom);

  e.status = 'Active';
  e.insurerMemberId = memberId;
  e.lastPremium = { employerShareCents, employeeShareCents, periodFrom, periodTo };
  e.pendingAgeSeconds = null;

  store.payroll.push({
    companyId: e.companyId,
    employeeId: e.employeeId,
    enrolmentId: e.enrolmentId,
    kind: 'mutuelle_employer',
    amountCents: employerShareCents,
    currency: 'EUR',
    periodFrom,
    periodTo,
    active: true,
    sourceEventId: uid('evt'),
  });
  store.payroll.push({
    companyId: e.companyId,
    employeeId: e.employeeId,
    enrolmentId: e.enrolmentId,
    kind: 'mutuelle_employee',
    amountCents: employeeShareCents,
    currency: 'EUR',
    periodFrom,
    periodTo,
    active: true,
    sourceEventId: uid('evt'),
  });

  pushLog(
    'worker',
    'info',
    'PendingExternal → Active after mock InsurerGateway',
    { enrolmentId, carrier: company.carrier, memberId, correlationId },
  );
  pushLog(
    `${company.carrier}-stub`,
    'info',
    'createMember (mock ACL)',
    { enrolmentId, memberId, correlationId },
  );
  pushAudit(e.companyId, 'activate', e.enrolmentId, correlationId, {
    insurerMemberId: memberId,
    carrier: company.carrier,
  });
  pushImpulse({
    companyId: e.companyId,
    title: 'Carrier confirmed · Active',
    description: 'Mock worker finished PendingExternal → Active after InsurerGateway succeeded.',
    technology: 'static mock · worker + ACL stub',
    why: 'Same legal transition as the live POC — cover is Active only after the gateway returns a member id.',
    reality: 'mock',
    layer: 'worker',
    source: 'mock-worker',
    enrolmentId: e.enrolmentId,
    correlationId,
    payload: {
      insurerMemberId: memberId,
      employerShareCents,
      employeeShareCents,
    },
  });
  pushImpulse({
    companyId: e.companyId,
    title: 'PremiumInstructionIssued',
    description: 'Employer and employee shares ready for the bulletin stub.',
    technology: 'static mock · outbox shape',
    why: 'Payroll never reads the Enrolment row — instructions cross the boundary as cents.',
    reality: 'real',
    layer: 'outbox',
    source: 'mock-outbox',
    enrolmentId: e.enrolmentId,
    correlationId,
    payload: { employerShareCents, employeeShareCents, periodFrom, periodTo },
  });
}

function scheduleActivate(enrolmentId: string, correlationId: string): void {
  const t = window.setTimeout(() => activateEnrolment(enrolmentId, correlationId), 900);
  store.timers.push(t);
}

function stopPayroll(enrolmentId: string): void {
  for (const line of store.payroll) {
    if (line.enrolmentId === enrolmentId) line.active = false;
  }
}

async function handle(
  method: string,
  pathname: string,
  search: string,
  headers: Headers,
  bodyText: string,
): Promise<Response> {
  const companyHeader = companyFrom(headers);
  const corr = correlation(headers);
  let body: Record<string, unknown> = {};
  if (bodyText) {
    try {
      body = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return err(400, 'Invalid JSON');
    }
  }

  if (method === 'GET' && pathname === '/health') {
    return json({ ok: true, mode: 'static-demo' });
  }

  // GET /v1/companies/:id
  let m = pathname.match(/^\/v1\/companies\/([^/]+)$/);
  if (method === 'GET' && m) {
    const id = m[1] as CompanyId;
    const c = COMPANIES[id];
    if (!c) return err(404, 'Company not found');
    return json({
      id: c.id,
      name: c.name,
      carrier: c.carrier,
      insuranceEnabled: c.insuranceEnabled,
      plan: PLAN,
      employees: store.employees.filter((e) => e.companyId === id),
      dispenseReasons: DISPENSE_REASONS,
    });
  }

  // GET enrolments list
  m = pathname.match(/^\/v1\/companies\/([^/]+)\/enrolments$/);
  if (method === 'GET' && m) {
    const companyId = m[1];
    const includeEnded = new URLSearchParams(search).get('includeEnded') === 'true';
    const items = store.enrolments
      .filter((e) => e.companyId === companyId)
      .filter((e) =>
        includeEnded
          ? true
          : e.status === 'PendingExternal' ||
            e.status === 'Active' ||
            e.status === 'Dispensed',
      )
      .map(viewEnrolment);
    return json({ items });
  }

  // POST enrol
  m = pathname.match(/^\/v1\/companies\/([^/]+)\/enrolments$/);
  if (method === 'POST' && m) {
    const companyId = m[1] as CompanyId;
    const company = COMPANIES[companyId];
    if (!company) return err(404, 'Company not found');
    if (!company.insuranceEnabled) return err(409, 'Insurance disabled');

    const idem = headers.get('Idempotency-Key');
    if (idem && store.idempotency.has(idem)) {
      const existingId = store.idempotency.get(idem)!;
      const existing = store.enrolments.find((e) => e.enrolmentId === existingId)!;
      return json({ enrolmentId: existing.enrolmentId, status: existing.status });
    }

    const employeeId = String(body.employeeId ?? '');
    const emp = store.employees.find((e) => e.id === employeeId && e.companyId === companyId);
    if (!emp) return err(404, 'Employee not found');
    if (!emp.active) return err(409, 'Employee inactive');
    if (openCover(companyId, employeeId)) {
      return err(409, 'Active or pending enrolment already exists');
    }

    const enrolmentId = uid('enr');
    const effectiveFrom = String(body.effectiveFrom ?? '2026-04-01');
    const enrolment: Enrolment = {
      enrolmentId,
      companyId,
      employeeId,
      planId: String(body.planId ?? PLAN.id),
      status: 'PendingExternal',
      effectiveFrom,
      carrier: company.carrier,
      attemptCount: 1,
      createdAt: Date.now(),
    };
    store.enrolments.unshift(enrolment);
    if (idem) store.idempotency.set(idem, enrolmentId);

    pushLog('api', 'info', 'Enrol accepted · PendingExternal', {
      enrolmentId,
      companyId,
      employeeId,
      correlationId: corr,
    });
    pushAudit(companyId, 'enrol', enrolmentId, corr, {
      employeeId,
      planId: enrolment.planId,
      coverage: body.coverage,
    });
    pushImpulse({
      companyId,
      title: 'Enrol accepted · PendingExternal',
      description:
        'Insurance accepted EnrolEmployee and stored the aggregate as Pending. Cover is not Active yet.',
      technology: 'static mock · command',
      why: 'Pending honesty — HR must not see Covered until InsurerGateway confirms.',
      reality: 'real',
      layer: 'domain',
      source: 'mock-api',
      enrolmentId,
      correlationId: corr,
      payload: { employeeId, planId: enrolment.planId, effectiveFrom },
    });

    scheduleActivate(enrolmentId, corr);
    return json({ enrolmentId, status: 'PendingExternal' }, 202);
  }

  // POST dispense
  m = pathname.match(/^\/v1\/companies\/([^/]+)\/dispenses$/);
  if (method === 'POST' && m) {
    const companyId = m[1] as CompanyId;
    const employeeId = String(body.employeeId ?? '');
    const reasonCode = String(body.reasonCode ?? '');
    const emp = store.employees.find((e) => e.id === employeeId && e.companyId === companyId);
    if (!emp) return err(404, 'Employee not found');
    if (openCover(companyId, employeeId)) {
      return err(409, 'Active or pending enrolment already exists');
    }
    const enrolmentId = uid('enr');
    const enrolment: Enrolment = {
      enrolmentId,
      companyId,
      employeeId,
      planId: PLAN.id,
      status: 'Dispensed',
      effectiveFrom: nowIso().slice(0, 10),
      carrier: COMPANIES[companyId].carrier,
      reasonCode,
      createdAt: Date.now(),
    };
    store.enrolments.unshift(enrolment);
    pushAudit(companyId, 'dispense', enrolmentId, corr, { reasonCode, employeeId });
    pushImpulse({
      companyId,
      title: 'Dispense recorded · Dispensed',
      description: 'HR recorded a legal exemption. No Active cover and no premium instruction.',
      technology: 'static mock · command',
      why: 'Dispense is a legal exemption, not a failed enrol.',
      reality: 'real',
      layer: 'domain',
      source: 'mock-api',
      enrolmentId,
      correlationId: corr,
      payload: { reasonCode, employeeId },
    });
    return json({ enrolmentId, status: 'Dispensed', reasonCode });
  }

  // GET / POST payroll, audit, impulses, dev-logs
  m = pathname.match(/^\/v1\/companies\/([^/]+)\/payroll-lines$/);
  if (method === 'GET' && m) {
    return json({ items: store.payroll.filter((p) => p.companyId === m![1]) });
  }

  m = pathname.match(/^\/v1\/companies\/([^/]+)\/audit$/);
  if (method === 'GET' && m) {
    const limit = Math.min(Number(new URLSearchParams(search).get('limit') ?? 50) || 50, 200);
    return json({
      items: store.audit.filter((a) => a.companyId === m![1]).slice(0, limit),
    });
  }

  m = pathname.match(/^\/v1\/companies\/([^/]+)\/impulses$/);
  if (method === 'GET' && m) {
    const companyId = m[1];
    return json({
      companyId,
      contract: IMPULSE_CONTRACT,
      items: store.impulses.filter((i) => i.payload.companyId === companyId),
    });
  }

  m = pathname.match(/^\/v1\/companies\/([^/]+)\/dev-logs$/);
  if (method === 'GET' && m) {
    return json({ items: store.logs.slice(0, 400) });
  }

  // GET enrolment
  m = pathname.match(/^\/v1\/enrolments\/([^/]+)$/);
  if (method === 'GET' && m) {
    const e = store.enrolments.find((x) => x.enrolmentId === m![1]);
    if (!e) return err(404, 'Enrolment not found');
    if (e.companyId !== companyHeader) return err(403, 'Forbidden for this company');
    return json(viewEnrolment(e));
  }

  // POST cancel
  m = pathname.match(/^\/v1\/enrolments\/([^/]+)\/cancellations$/);
  if (method === 'POST' && m) {
    const e = store.enrolments.find((x) => x.enrolmentId === m![1]);
    if (!e) return err(404, 'Enrolment not found');
    if (e.companyId !== companyHeader) return err(403, 'Forbidden for this company');
    if (e.status !== 'PendingExternal' && e.status !== 'Active') {
      return err(409, 'Cannot cancel enrolment in current status');
    }
    const hadPremium = e.status === 'Active';
    e.status = 'Ended';
    e.effectiveTo = nowIso().slice(0, 10);
    if (hadPremium) stopPayroll(e.enrolmentId);
    pushAudit(e.companyId, 'cancel', e.enrolmentId, corr, {});
    pushImpulse({
      companyId: e.companyId,
      title: 'Admin cancel · Ended',
      description: 'HR ended Pending or Active cover.',
      technology: 'static mock · command',
      why: 'Cancel ends cover; stop is emitted only if a premium was already issued.',
      reality: 'real',
      layer: 'domain',
      source: 'mock-api',
      enrolmentId: e.enrolmentId,
      correlationId: corr,
      payload: { hadPremium },
    });
    return json(viewEnrolment(e));
  }

  // GET me/cover
  if (method === 'GET' && pathname === '/v1/me/cover') {
    const employeeId = headers.get('X-Employee-Id') ?? '';
    const open = store.enrolments.find(
      (e) =>
        e.companyId === companyHeader &&
        e.employeeId === employeeId &&
        (e.status === 'Active' || e.status === 'PendingExternal' || e.status === 'Dispensed'),
    );
    return json({
      employeeId,
      planName: open ? PLAN.name : null,
      status: open?.status ?? 'None',
      effectiveFrom: open?.effectiveFrom ?? null,
      effectiveTo: open?.effectiveTo ?? null,
    });
  }

  // POST reset
  if (method === 'POST' && pathname === '/v1/dev/reset') {
    resetStore();
    return json({ ok: true, message: 'Static demo reset' });
  }

  // POST platform terminate
  if (method === 'POST' && pathname === '/v1/dev/platform-events') {
    const type = String(body.type ?? '');
    if (type !== 'EmployeeTerminated') {
      return err(400, `Unsupported event type: ${type}`);
    }
    const companyId = String(body.companyId ?? companyHeader);
    const employeeId = String(body.employeeId ?? '');
    const emp = store.employees.find((e) => e.id === employeeId && e.companyId === companyId);
    if (emp) emp.active = false;

    const open = store.enrolments.filter(
      (e) =>
        e.companyId === companyId &&
        e.employeeId === employeeId &&
        (e.status === 'PendingExternal' || e.status === 'Active'),
    );
    for (const e of open) {
      const hadPremium = e.status === 'Active';
      e.status = 'Ended';
      e.effectiveTo = nowIso().slice(0, 10);
      if (hadPremium) stopPayroll(e.enrolmentId);
      pushAudit(companyId, 'terminate', e.enrolmentId, corr, { employeeId });
      pushImpulse({
        companyId,
        title: 'EmployeeTerminated · Ended',
        description: 'A platform leaver event ended cover.',
        technology: 'static mock · platform event',
        why: 'Terminate wins — a leaver must not stay Active.',
        reality: 'real',
        layer: 'platform',
        source: 'mock-platform',
        enrolmentId: e.enrolmentId,
        correlationId: corr,
        payload: { employeeId, eventId: body.eventId },
      });
    }
    pushLog('platform', 'info', 'EmployeeTerminated handled', { companyId, employeeId });
    return json({ handled: true, duplicate: false });
  }

  return err(404, `No mock route for ${method} ${pathname}`);
}

// Rewrite impulses GET properly by patching the buggy block — I'll fix in StrReplace after write.
// Actually let me rewrite handle's impulses section cleanly in the file before finishing.

export function installMockApi(): void {
  resetStore();
  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url, window.location.origin);

    // API client uses root-relative `/v1/...` (works under any Pages base).
    let pathname = url.pathname;
    const base = (import.meta.env.BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
    if (base && pathname.startsWith(base)) {
      pathname = pathname.slice(base.length) || '/';
    }

    if (pathname.startsWith('/v1/') || pathname === '/health') {
      const bodyText =
        req.method === 'GET' || req.method === 'HEAD' ? '' : await req.clone().text();
      return handle(req.method, pathname, url.search, req.headers, bodyText);
    }

    return original(input, init);
  };
}
