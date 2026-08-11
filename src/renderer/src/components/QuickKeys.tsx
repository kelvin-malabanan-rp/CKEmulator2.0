import { useEffect, useMemo, useState } from 'react';
import { formatCurrency, type PosLocale } from '../../../core/currency';
import { paginate } from '../../../core/quickkeys';
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
  locale,
}: {
  e: ReturnType<typeof useEmulator>;
  locale: PosLocale;
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

  // Pinned keys float to the top; a live search flattens across all pages.
  const searching = query.trim() !== '';
  const sorted = useMemo(() => sortPinned(entries, pinnedSet), [entries, pinnedSet]);
  const results = useMemo(
    () => (searching ? sortPinned(filterQuickKeys(entries, query), pinnedSet) : sorted),
    [searching, entries, query, pinnedSet, sorted],
  );
  const pages = useMemo(() => paginate(sorted, QK_PER_PAGE), [sorted]);
  const safePage = Math.min(page, pages.length - 1);
  const current = searching ? results : pages[safePage] ?? [];

  useEffect(() => setPage(0), [tab]);

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
          <span className="keyprice">{formatCurrency(entry.priceCents, locale)}</span>
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

      <div className={`qkgrid${searching ? ' searching' : ''}`}>
        {current.length === 0 ? (
          <div className="qkempty">{searching ? 'No matching items' : 'No quick keys loaded'}</div>
        ) : (
          current.map(renderKey)
        )}
      </div>

      {!searching && pages.length > 1 && (
        <div className="qkpager">
          <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            ‹
          </button>
          <span>
            {safePage + 1}/{pages.length}
          </span>
          <button disabled={safePage >= pages.length - 1} onClick={() => setPage(safePage + 1)}>
            ›
          </button>
        </div>
      )}
    </div>
  );
}
