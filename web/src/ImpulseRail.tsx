import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, type DevLogEntry, type Impulse, type ImpulseFeed, type ImpulseReality } from './api';
import { ArchitectureMap } from './ArchitectureMap';
import { flowStep, includeInStory, type ArchStep } from './architecture';
import { readDevLine } from './design-log';
import { demoListen } from './guided-demo-bus';

type Tab = 'evidence' | 'dev' | 'architecture';
type RealityFilter = 'all' | ImpulseReality;
type LevelFilter = 'all' | DevLogEntry['level'];

function formatClock(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatWhen(at: string | null, reality: Impulse['reality']): string {
  if (!at) {
    return reality === 'seed' ? 'Seed · loaded with the catalog' : 'Stored · this table has no clock';
  }
  return formatClock(at);
}

function formatLogTime(ts: string): string {
  return formatClock(ts);
}

function ImpulseCard({ item, onOpen }: { item: Impulse; onOpen: () => void }) {
  return (
    <button type="button" className={`impulse reality-${item.reality}`} onClick={onOpen}>
      <header className="impulse-head">
        <time dateTime={item.at ?? undefined}>{formatWhen(item.at, item.reality)}</time>
        <span className={`reality-pill ${item.reality}`}>{item.reality}</span>
      </header>
      <h3>{item.title}</h3>
      <p className="impulse-why">{item.why}</p>
      <span className="impulse-more">Open</span>
    </button>
  );
}

function ImpulseCover({ item, onClose }: { item: Impulse; onClose: () => void }) {
  return (
    <div className="impulse-cover" role="dialog" aria-modal="true" aria-labelledby="impulse-cover-title">
      <button type="button" className="impulse-cover-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <header className="impulse-head">
        <time dateTime={item.at ?? undefined}>{formatWhen(item.at, item.reality)}</time>
        <span className={`reality-pill ${item.reality}`}>{item.reality}</span>
      </header>
      <h3 id="impulse-cover-title">{item.title}</h3>
      <p className="impulse-cover-lead">{item.description}</p>
      <dl className="impulse-facts">
        <div>
          <dt>Design element</dt>
          <dd>
            {item.layer}
            <span className="impulse-source">{item.technology}</span>
            <span className="impulse-source">{item.source}</span>
          </dd>
        </div>
        <div>
          <dt>Why</dt>
          <dd>{item.why}</dd>
        </div>
      </dl>
      <div className="impulse-payload">
        <p>Payload</p>
        <pre>{JSON.stringify(item.payload, null, 2)}</pre>
      </div>
    </div>
  );
}

function devLineKey(item: DevLogEntry): string {
  return `${item.ts}\u0000${item.service}\u0000${item.msg}\u0000${JSON.stringify(item.fields)}`;
}

function DevLine({
  item,
  open,
  onToggle,
  logKey,
}: {
  item: DevLogEntry;
  open: boolean;
  onToggle: () => void;
  logKey: string;
}) {
  const reading = readDevLine(item);
  const hasFields = Object.keys(item.fields).length > 0;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pinTop = useRef<number | null>(null);

  useLayoutEffect(() => {
    const button = buttonRef.current;
    const pinned = pinTop.current;
    if (!button || pinned == null) return;
    const scroller = button.closest('.dev-log');
    if (scroller) scroller.scrollTop += button.getBoundingClientRect().top - pinned;
    pinTop.current = null;
  });

  return (
    <li className={`dev-line-wrap${open ? ' is-open' : ''}`} data-log-key={logKey}>
      <button
        ref={buttonRef}
        type="button"
        className={`dev-line level-${item.level}`}
        aria-expanded={open}
        onClick={() => {
          pinTop.current = buttonRef.current?.getBoundingClientRect().top ?? null;
          onToggle();
        }}
      >
        <time dateTime={item.ts}>{formatLogTime(item.ts)}</time>
        <span className="dev-service">{reading.service}</span>
        <span className={`dev-kind kind-${reading.kind.toLowerCase()}`}>{reading.kind}</span>
        <span className="dev-element">{reading.element}</span>
        <span className="dev-desc">{reading.line}</span>
      </button>
      {open && (
        <div className="dev-detail">
          <dl className="dev-detail-meta">
            <div>
              <dt>Service</dt>
              <dd>
                {reading.service}
                <span className="dev-detail-note">{reading.serviceName}</span>
              </dd>
            </div>
            <div>
              <dt>Kind</dt>
              <dd>{reading.kind}</dd>
            </div>
            <div>
              <dt>Element</dt>
              <dd>{reading.element}</dd>
            </div>
            <div>
              <dt>Signal</dt>
              <dd>
                {item.level} · {item.msg}
              </dd>
            </div>
          </dl>
          <div className={`dev-detail-body${hasFields ? ' has-payload' : ''}`}>
            <section className="dev-detail-spec">
              <h4>Why this hop</h4>
              <p>{reading.detail}</p>
            </section>
            {hasFields && (
              <section className="dev-detail-payload">
                <h4>Payload</h4>
                <pre>{JSON.stringify(item.fields, null, 2)}</pre>
              </section>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function FilterGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="log-filter-group" role="group" aria-label={label}>
      <span>{label}</span>
      <div className="log-filter-options">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={value === option ? 'log-chip active' : 'log-chip'}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ImpulseRail({ companyId }: { companyId: string }) {
  const [tab, setTab] = useState<Tab>('evidence');
  const [feed, setFeed] = useState<ImpulseFeed | null>(null);
  const [logs, setLogs] = useState<DevLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reality, setReality] = useState<RealityFilter>('all');
  const [layer, setLayer] = useState('all');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [service, setService] = useState('all');
  const [scope, setScope] = useState<'all' | 'company'>('all');
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [openImpulseId, setOpenImpulseId] = useState<string | null>(null);
  const [following, setFollowing] = useState(true);
  const logBox = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      Promise.all([api.impulses(companyId), api.devLogs(companyId)])
        .then(([nextFeed, nextLogs]) => {
          if (cancelled) return;
          setFeed(nextFeed);
          setLogs(nextLogs.items);
          setError(null);
        })
        .catch((err: Error) => {
          if (!cancelled) setError(err.message);
        });
    };
    load();
    const timer = setInterval(load, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [companyId]);

  useEffect(() => {
    if (!openImpulseId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenImpulseId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openImpulseId]);

  const layers = useMemo(() => {
    const found = new Set((feed?.items ?? []).map((item) => item.layer));
    return ['all', ...[...found].sort()];
  }, [feed]);

  const services = useMemo(() => {
    const found = new Set(logs.map((item) => item.service));
    return ['all', ...[...found].sort()];
  }, [logs]);

  const tiles = useMemo(() => {
    return (feed?.items ?? []).filter((item) => {
      if (reality !== 'all' && item.reality !== reality) return false;
      if (layer !== 'all' && item.layer !== layer) return false;
      return true;
    });
  }, [feed, reality, layer]);

  const stream = useMemo(() => {
    const seen = new Map<string, number>();
    return logs
      .filter((item) => {
        if (level !== 'all' && item.level !== level) return false;
        if (service !== 'all' && item.service !== service) return false;
        if (scope === 'company') {
          const loggedCompany = item.fields.companyId;
          if (loggedCompany != null && loggedCompany !== companyId) return false;
        }
        return true;
      })
      .map((item) => {
        const base = devLineKey(item);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        return { item, key: n === 0 ? base : `${base}#${n}` };
      });
  }, [logs, level, service, scope, companyId]);

  useLayoutEffect(() => {
    const el = logBox.current;
    if (!el || tab !== 'dev' || !following) return;
    el.scrollTop = el.scrollHeight;
  }, [stream, tab, following]);

  const counts = (feed?.items ?? []).reduce(
    (acc, item) => {
      acc[item.reality] += 1;
      return acc;
    },
    { real: 0, mock: 0, seed: 0 },
  );

  const openImpulse = tiles.find((item) => item.id === openImpulseId) ?? null;

  const wired = companyId === 'company-a' ? 'alan' : companyId === 'company-b' ? 'axa' : null;

  const steps = useMemo(() => {
    const seen = new Map<string, number>();
    const all: ArchStep[] = [];
    for (const item of logs) {
      if (!includeInStory(item)) continue;
      const base = `${item.ts}|${item.service}|${item.msg}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      all.push(...flowStep(item, n === 0 ? base : `${base}#${n}`, wired));
    }
    return all;
  }, [logs, wired]);

  useEffect(() => {
    return demoListen((command) => {
      if (command.type === 'rail-tab') {
        setTab(command.tab);
        return;
      }
      if (command.type !== 'open-log-match') return;
      setTab('dev');
      setFollowing(false);
      const needle = command.match.toLowerCase();
      // Prefer the newest matching line (end of chronological stream).
      const hit = [...stream].reverse().find(({ item }) => {
        const reading = readDevLine(item);
        return (
          reading.element.toLowerCase().includes(needle) ||
          reading.line.toLowerCase().includes(needle) ||
          item.msg.toLowerCase().includes(needle)
        );
      });
      if (hit) {
        setOpenLine(hit.key);
        window.requestAnimationFrame(() => {
          const el = logBox.current?.querySelector(`[data-log-key="${CSS.escape(hit.key)}"]`);
          el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
      }
    });
  }, [stream]);

  const [archChromeHost, setArchChromeHost] = useState<HTMLDivElement | null>(null);

  return (
    <aside className="impulse-rail" aria-label="System impulses">
      <header className="impulse-rail-head">
        <div className="impulse-chrome-row">
          <div className="log-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'evidence'}
              className={tab === 'evidence' ? 'log-tab active' : 'log-tab'}
              onClick={() => setTab('evidence')}
            >
              Cards
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'dev'}
              className={tab === 'dev' ? 'log-tab active' : 'log-tab'}
              onClick={() => setTab('dev')}
            >
              Logs
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'architecture'}
              className={tab === 'architecture' ? 'log-tab active' : 'log-tab'}
              onClick={() => setTab('architecture')}
            >
              Architecture
            </button>
          </div>
          {tab === 'evidence' && (
            <div className="log-filters-bar impulse-tab-chrome" aria-label="Card filters">
              <FilterGroup
                label="Reality"
                options={['all', 'real', 'mock', 'seed']}
                value={reality}
                onChange={(next) => setReality(next as RealityFilter)}
              />
              <FilterGroup label="Layer" options={layers} value={layer} onChange={setLayer} />
            </div>
          )}
          {tab === 'dev' && (
            <div className="log-filters-bar impulse-tab-chrome" aria-label="Log filters">
              <FilterGroup
                label="Level"
                options={['all', 'info', 'warn', 'error']}
                value={level}
                onChange={(next) => setLevel(next as LevelFilter)}
              />
              <FilterGroup label="Service" options={services} value={service} onChange={setService} />
              <FilterGroup
                label="Scope"
                options={['all', 'company']}
                value={scope === 'all' ? 'all' : 'company'}
                onChange={(next) => setScope(next === 'company' ? 'company' : 'all')}
              />
            </div>
          )}
          <div
            className="impulse-arch-chrome"
            ref={setArchChromeHost}
            hidden={tab !== 'architecture'}
          />
        </div>
      </header>

      {error && <p className="flash error">{error}</p>}

      {tab === 'evidence' && (
        <div role="tabpanel">
          <details className="impulse-contract">
            <summary>What a log should contain</summary>
            <dl>
              {(feed?.contract ?? FALLBACK_CONTRACT).map((row) => (
                <div key={row.field}>
                  <dt>{row.field}</dt>
                  <dd>{row.means}</dd>
                </div>
              ))}
            </dl>
          </details>

          <p className="impulse-count">
            {feed
              ? `${tiles.length} of ${feed.items.length} · ${counts.real} real · ${counts.mock} mock · ${counts.seed} seed`
              : 'Reading the database…'}
          </p>

          <div className="impulse-list">
            {tiles.map((item) => (
              <ImpulseCard key={item.id} item={item} onOpen={() => setOpenImpulseId(item.id)} />
            ))}
            {feed && tiles.length === 0 && <p className="empty">No impulses match these filters.</p>}
          </div>
          {openImpulse && <ImpulseCover item={openImpulse} onClose={() => setOpenImpulseId(null)} />}
        </div>
      )}

      {tab === 'dev' && (
        <div role="tabpanel">
          <p className="impulse-count">
            {stream.length} lines · newest at the bottom
          </p>
          <div className="dev-stream">
            <div className="dev-head" aria-hidden="true">
              <span>Time</span>
              <span>Service</span>
              <span>Kind</span>
              <span>Element</span>
              <span>Description</span>
            </div>
            <ol className="dev-log" ref={logBox}>
              {stream.map(({ item, key }) => (
                <DevLine
                  key={key}
                  logKey={key}
                  item={item}
                  open={openLine === key}
                  onToggle={() => {
                    setFollowing(false);
                    setOpenLine((current) => (current === key ? null : key));
                  }}
                />
              ))}
              {logs.length === 0 && (
                <li className="dev-line empty-line">
                  No dev lines yet. The next API call or worker tick writes them here.
                </li>
              )}
            </ol>
            {!following && (
              <button type="button" className="dev-follow" onClick={() => setFollowing(true)}>
                Latest logs
              </button>
            )}
          </div>
        </div>
      )}

      {tab === 'architecture' && (
        <div role="tabpanel" className="arch-panel">
          <ArchitectureMap steps={steps} chromeHost={archChromeHost} />
        </div>
      )}
    </aside>
  );
}

const FALLBACK_CONTRACT = [
  { field: 'timestamp', means: 'When the fact was stored.' },
  { field: 'title', means: 'Domain name of the fact.' },
  { field: 'description', means: 'What happened, in Insurance language.' },
  { field: 'technology', means: 'Which context and mechanism wrote it.' },
  { field: 'why', means: 'Why this hop exists: the bounded context, the design element, and the invariant it protects.' },
  { field: 'payload', means: 'The JSON that crossed the boundary.' },
  { field: 'reality', means: 'real, mock (a stub), or seed.' },
];
