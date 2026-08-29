const TABLE_ROWS = Array.from({ length: 8 }, (_, index) => index);
const KPI_CARDS = Array.from({ length: 4 }, (_, index) => index);
const CHART_CARDS = Array.from({ length: 4 }, (_, index) => index);

export function CatalogTableSkeleton() {
  return <>{TABLE_ROWS.map((row) => <tr className="catalog-skeleton-row" aria-hidden="true" key={row}>
    <td><div className="skeleton-game"><span className="skeleton-cover" /><span><i className="skeleton-line skeleton-line-title" /><i className="skeleton-line skeleton-line-detail" /></span></div></td>
    <td><i className="skeleton-line skeleton-line-pill" /></td>
    <td><i className="skeleton-line skeleton-line-value" /></td>
    <td><i className="skeleton-line skeleton-line-value" /></td>
    <td><i className="skeleton-line skeleton-line-value" /></td>
    <td><i className="skeleton-line skeleton-line-pill" /></td>
  </tr>)}</>;
}

export function ReportSkeleton() {
  return <div className="report-skeleton" aria-hidden="true">
    <div className="report-skeleton-copy"><i className="skeleton-line skeleton-line-title" /><i className="skeleton-line skeleton-line-detail" /></div>
    <div className="report-skeleton-visual">{TABLE_ROWS.map((bar) => <i key={bar} />)}</div>
  </div>;
}

export function EngagementSkeleton() {
  return <div className="engagement-skeleton" aria-hidden="true">
    <div className="engagement-kpis engagement-skeleton-kpis">{KPI_CARDS.map((card) => <article key={card}><i className="skeleton-line skeleton-line-detail" /><i className="skeleton-line skeleton-line-metric" /><i className="skeleton-line skeleton-line-short" /></article>)}</div>
    <div className="engagement-chart-grid engagement-skeleton-grid">{CHART_CARDS.map((card) => <article className={`engagement-card${card % 2 === 0 ? " engagement-card-wide" : ""}`} key={card}><header><div><i className="skeleton-line skeleton-line-title" /><i className="skeleton-line skeleton-line-detail" /></div></header><div className="engagement-skeleton-chart">{TABLE_ROWS.map((bar) => <i key={bar} />)}</div></article>)}</div>
  </div>;
}
