import { useEffect, useMemo, useState } from 'react';
import { usePersistedState } from '../usePersistedState';
import { QK_PINS_KEY, DEFAULT_QK_PINS, parsePins, serializePins } from '../uiSettings';
import { filterQuickKeys, sortPinned, togglePin } from '../quickKeyFilter';
import type { QuickKeyEntry } from '../../../core/quickkeys';
import type { useEmulator } from '../useEmulator';

const QK_PER_PAGE = 9; // 3 columns × 3 rows — mirrors the Ads grid below it

/**
 * Top-left quadrant quick keys: search pinned at the top (filter / jump to an
 * item), then a fixed 3×5 paginated grid (prev/next arrows, "1/n"). Pinned keys
 * float to the top. A live search flattens across every page into a scrollable
 * result grid; clearing it returns to paging. Clicking a key rings it in.
 */
export function QuickKeys({
  e,
}: {
  e: ReturnType<typeof useEmulator>;
}): JSX.Element {
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState(0);
  const [rawQuery, setRawQuery] = useState('');
  const [query, setQuery] = useState('');
  const [pins, setPins] = usePersistedState(QK_PINS_KEY, DEFAULT_QK_PINS, parsePins, serializePins);
  const files = e.quickKeyFiles;
  const active = files[Math.min(tab, Math.max(0, files.length - 1))];
  const entries = useMemo(() => active?.entries ?? [], [active]);
  const pinnedSet = useMemo(() => new Set(pins), [pins]);

  // Debounce the search input so typing doesn't re-filter on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setQuery(rawQuery), 150);
    return () => clearTimeout(id);
  }, [rawQuery]);

  // Pinned keys float to the top. Search filters the same list; both browse and
  // search are then paginated identically (3×3), so only a page of cards ever
  // renders — a broad query over a ~14k-item pricebook no longer hangs.
  const searching = query.trim() !== '';
  const sorted = useMemo(() => sortPinned(entries, pinnedSet), [entries, pinnedSet]);
  const results = useMemo(
    () => (searching ? sortPinned(filterQuickKeys(entries, query), pinnedSet) : sorted),
    [searching, entries, query, pinnedSet, sorted],
  );
  // Slice only the visible page — never materialize all pages. A 14k-item
  // pricebook would otherwise build ~1,555 arrays on every keystroke/pin toggle.
  const pageCount = Math.max(1, Math.ceil(results.length / QK_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const current = useMemo(
    () => results.slice(safePage * QK_PER_PAGE, safePage * QK_PER_PAGE + QK_PER_PAGE),
    [results, safePage],
  );

  // Reset to the first page when the query or the active file changes.
  useEffect(() => setPage(0), [query, tab]);

  const renderKey = (entry: QuickKeyEntry, i: number): JSX.Element => {
    const pinned = pinnedSet.has(entry.upc);
    // Show the UPC as a small top-left label above the item name; skip it when
    // the row has no name (description falls back to the UPC — no point twice).
    const hasName = entry.description !== entry.upc;
    return (
      <div key={`${entry.upc}-${i}`} className="keyrow">
        <button
          className={`key ${e.quickKeyColorFor(entry.upc)}${pinned ? ' pinned' : ''}`}
          title={hasName ? `${entry.description} · ${entry.upc}` : entry.upc}
          onClick={() => e.fireQuickKey(entry)}
        >
          {hasName && <span className="keyplu">{entry.upc}</span>}
          <span className="keyname">{entry.description}</span>
          <span className="keyprice">{e.money(entry.priceCents)}</span>
        </button>
        <button
          className={`pin${pinned ? ' on' : ''}`}
          title={pinned ? 'Unpin' : 'Pin to top'}
          aria-label={pinned ? 'Unpin' : 'Pin to top'}
          onClick={() => setPins(togglePin(pins, entry.upc))}
        >
          ★
        </button>
      </div>
    );
  };

  return (
    <div className="qk">
      {files.length > 1 && (
        <div className="qktabs">
          {files.map((f, i) => (
            <button key={f.file} className={i === tab ? 'on' : ''} onClick={() => setTab(i)}>
              {f.file.replace(/\.qk$/i, '')}
            </button>
          ))}
        </div>
      )}
      <div className="qksearch">
        <input
          type="text"
          placeholder="Search or jump to item…"
          value={rawQuery}
          onChange={(ev) => setRawQuery(ev.target.value)}
        />
        {rawQuery !== '' && (
          <button className="qkclear" title="Clear search" onClick={() => setRawQuery('')}>
            ×
          </button>
        )}
        {searching && (
          <span className="qkcount">
            {results.length} result{results.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="qklegend">
        <span><i className="sw orange" /> Age restricted</span>
        <span><i className="sw green" /> Ad trigger</span>
        <span><i className="sw dark-green" /> Trigger + age</span>
      </div>

      <div className="qkgrid">
        {current.length === 0 ? (
          <div className="qkempty">{searching ? 'No matching items' : 'No quick keys loaded'}</div>
        ) : (
          current.map(renderKey)
        )}
      </div>

      {pageCount > 1 && (
        <div className="qkpager">
          <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            ‹
          </button>
          <span>
            {safePage + 1}/{pageCount}
          </span>
          <button disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
            ›
          </button>
        </div>
      )}
    </div>
  );
}
