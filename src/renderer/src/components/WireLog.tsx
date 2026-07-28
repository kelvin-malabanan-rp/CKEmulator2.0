import { useEffect, useMemo, useRef, useState } from 'react';
import { formatRelativeTime, type LogCategory } from '../wireLog';
import type { LogEntry } from '../useEmulator';

type Filter = 'all' | 'connection' | 'data' | 'error';

const FILTERS: ReadonlyArray<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'connection', label: 'Connection' },
  { key: 'data', label: 'Data load' },
  { key: 'error', label: 'Errors' },
];

/** Lines matching the active chip. Wire traffic (vj/pole) shows under All only. */
function matchesFilter(category: LogCategory, filter: Filter): boolean {
  return filter === 'all' ? true : category === filter;
}

/**
 * Wire log with category chips (client-side filter), per-category colour
 * coding, relative timestamps, a jump-to-latest button once scrolled away from
 * the newest line, and a confirm step before clearing a long log.
 */
export function WireLog({ log, onClear }: { log: LogEntry[]; onClear: () => void }): JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');
  const [confirming, setConfirming] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // Ticks so relative timestamps ("2s ago") stay current without re-logging.
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: log.length, connection: 0, data: 0, error: 0 };
    for (const l of log) {
      if (l.category === 'connection') c.connection++;
      else if (l.category === 'data') c.data++;
      else if (l.category === 'error') c.error++;
    }
    return c;
  }, [log]);

  const visible = useMemo(() => log.filter((l) => matchesFilter(l.category, filter)), [log, filter]);

  const clear = (): void => {
    // Long logs hold useful debug context — confirm before wiping them.
    if (log.length > 50 && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onClear();
  };

  const jumpToLatest = (): void => {
    listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setScrolled(false);
  };

  return (
    <div className="wirelog">
      <div className="logfilters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`logchip ${f.key}${filter === f.key ? ' on' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            <span className="chipcount">{counts[f.key]}</span>
          </button>
        ))}
        <span className="spacer" />
        {confirming ? (
          <span className="clearconfirm">
            Clear {log.length} lines?
            <button className="danger" onClick={clear}>
              Clear
            </button>
            <button onClick={() => setConfirming(false)}>Cancel</button>
          </span>
        ) : (
          <button onClick={clear}>clear</button>
        )}
      </div>
      <div className="log" ref={listRef} onScroll={(ev) => setScrolled(ev.currentTarget.scrollTop > 40)}>
        {visible.length === 0 && <div className="logempty">No {filter === 'all' ? '' : `${filter} `}lines yet</div>}
        {visible.map((l) => (
          <div key={l.id} className={`logline cat-${l.category}`}>
            <span className="tag">{l.channel.toUpperCase()}</span>
            <span className="logtime" title={l.at}>
              {formatRelativeTime(l.atMs, now)}
            </span>
            <code>{l.text}</code>
          </div>
        ))}
      </div>
      {scrolled && (
        <button className="jumplatest" onClick={jumpToLatest}>
          ↑ Jump to latest
        </button>
      )}
    </div>
  );
}
