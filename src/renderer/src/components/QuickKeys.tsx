import { useEffect, useMemo, useState } from 'react';
import { formatCurrency, type PosLocale } from '../../../core/currency';
import { paginate } from '../../../core/quickkeys';
import type { useEmulator } from '../useEmulator';

const QK_PER_PAGE = 9; // 3 columns × 3 rows

/** Quick keys driven by .qk files: 3-wide grid that fills the column, paginated, colored. */
export function QuickKeys({
  e,
  locale,
}: {
  e: ReturnType<typeof useEmulator>;
  locale: PosLocale;
}): JSX.Element {
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState(0);
  const perPage = QK_PER_PAGE; // fixed 3×3 grid
  const files = e.quickKeyFiles;
  const active = files[Math.min(tab, Math.max(0, files.length - 1))];
  const pages = useMemo(() => paginate(active?.entries ?? [], perPage), [active, perPage]);
  const safePage = Math.min(page, pages.length - 1);
  const current = pages[safePage] ?? [];

  useEffect(() => setPage(0), [tab]);

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
      <div className="grid qk3">
        {current.map((entry, i) => (
          <button
            key={`${entry.upc}-${i}`}
            className={`key ${e.quickKeyColorFor(entry.upc)}`}
            title={entry.upc}
            onClick={() => e.fireQuickKey(entry)}
          >
            <span>{entry.description}</span>
            <small>{formatCurrency(entry.priceCents, locale)}</small>
          </button>
        ))}
      </div>
      {pages.length > 1 && (
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
