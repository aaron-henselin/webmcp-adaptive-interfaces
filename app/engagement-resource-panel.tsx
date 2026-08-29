"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CUSTOMER_SEXES,
  CUSTOMER_TYPES,
  DEVICE_TYPES,
  type EngagementSourceFilters,
} from "./engagement-analytics";
import { loadEngagementDashboard, type EngagementDashboard, type EngagementMetric } from "./engagement-data";

type Props = {
  filters: EngagementSourceFilters;
  onFiltersChange: (filters: EngagementSourceFilters) => void;
};

const COLORS = ["#1677a8", "#d28a2f", "#6c7f91"];

function formatMetric(metric: EngagementMetric) {
  if (metric.format === "percent") return metric.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) + "%";
  if (metric.format === "duration") {
    const seconds = Math.max(0, Math.round(metric.value));
    return Math.floor(seconds / 60) + "m " + String(seconds % 60).padStart(2, "0") + "s";
  }
  return Math.round(metric.value).toLocaleString();
}

function SelectFilter({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return <label className="engagement-filter"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">All</option>{options.map((option) => <option value={option} key={option}>{option}</option>)}</select></label>;
}

function initials(firstName: string, lastName: string) {
  return (firstName.slice(0, 1) + lastName.slice(0, 1)).toUpperCase();
}

export default function EngagementResourcePanel({ filters, onFiltersChange }: Props) {
  const [dashboard, setDashboard] = useState<EngagementDashboard | null>(null);
  const [error, setError] = useState("");
  const definitionKey = JSON.stringify(filters);

  useEffect(() => {
    const controller = new AbortController();
    loadEngagementDashboard(filters, controller.signal)
      .then((value) => { setDashboard(value); setError(""); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Customer engagement data is unavailable."); });
    return () => controller.abort();
  // The serialized filter set is the request identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitionKey]);

  const updateList = (key: keyof Pick<EngagementSourceFilters, "shops" | "suppliers" | "productCategories" | "brands" | "productClasses" | "sexes" | "customerTypes" | "devices">, value: string) => {
    onFiltersChange({ ...filters, [key]: value ? [value] : [] });
  };
  const maximumEngagement = Math.max(1, ...(dashboard?.engagement.map((item) => Number(item.activeUsers)) ?? [1]));
  const maximumFunnel = Math.max(1, ...(dashboard?.funnel.map((item) => Number(item.users)) ?? [1]));
  const deviceTotal = dashboard?.devices.reduce((sum, item) => sum + Number(item.sessions), 0) ?? 0;
  const deviceStops = useMemo(() => {
    return (dashboard?.devices ?? []).reduce<{ offset: number; parts: string[] }>((state, item, index) => {
      const nextOffset = state.offset + (deviceTotal ? Number(item.sessions) / deviceTotal * 100 : 0);
      return { offset: nextOffset, parts: [...state.parts, `${COLORS[index % COLORS.length]} ${state.offset}% ${nextOffset}%`] };
    }, { offset: 0, parts: [] }).parts.join(", ");
  }, [dashboard?.devices, deviceTotal]);

  return <details className="builder-resource-panel engagement-resource-panel">
    <summary><span><strong>Customer engagement</strong><small>{dashboard ? `${dashboard.metrics[1]?.value.toLocaleString() ?? 0} sessions · filters shared with page reports` : error || "Loading customer activity"}</small></span><b aria-hidden="true">+</b></summary>
    <div className="engagement-dashboard">
      <aside className="engagement-filter-rail" aria-label="Customer engagement filters">
        <div className="engagement-filter-heading"><span>Live filters</span><button type="button" onClick={() => onFiltersChange({ ...filters, shops: [], suppliers: [], productCategories: [], brands: [], productClasses: [], sexes: [], customerTypes: [], devices: [] })}>Reset</button></div>
        <div className="engagement-date-row">
          <label className="engagement-filter"><span>From</span><input type="date" min="2026-05-31" max={filters.dateTo} value={filters.dateFrom} onChange={(event) => onFiltersChange({ ...filters, dateFrom: event.target.value })} /></label>
          <label className="engagement-filter"><span>To</span><input type="date" min={filters.dateFrom} max="2026-08-28" value={filters.dateTo} onChange={(event) => onFiltersChange({ ...filters, dateTo: event.target.value })} /></label>
        </div>
        <SelectFilter label="Shop" value={filters.shops[0] ?? ""} options={dashboard?.options.shops ?? []} onChange={(value) => updateList("shops", value)} />
        <SelectFilter label="Supplier" value={filters.suppliers[0] ?? ""} options={dashboard?.options.suppliers ?? []} onChange={(value) => updateList("suppliers", value)} />
        <SelectFilter label="Product category" value={filters.productCategories[0] ?? ""} options={dashboard?.options.productCategories ?? []} onChange={(value) => updateList("productCategories", value)} />
        <SelectFilter label="Brand" value={filters.brands[0] ?? ""} options={dashboard?.options.brands ?? []} onChange={(value) => updateList("brands", value)} />
        <SelectFilter label="Class" value={filters.productClasses[0] ?? ""} options={dashboard?.options.productClasses ?? []} onChange={(value) => updateList("productClasses", value)} />
        <SelectFilter label="Sex" value={filters.sexes[0] ?? ""} options={CUSTOMER_SEXES} onChange={(value) => updateList("sexes", value)} />
        <SelectFilter label="Type" value={filters.customerTypes[0] ?? ""} options={CUSTOMER_TYPES} onChange={(value) => updateList("customerTypes", value)} />
        <SelectFilter label="Device" value={filters.devices[0] ?? ""} options={DEVICE_TYPES} onChange={(value) => updateList("devices", value)} />
      </aside>
      <section className="engagement-surface" aria-label="Customer engagement overview">
        {error ? <div className="engagement-error"><strong>Customer engagement data is unavailable</strong><span>{error}</span></div> : null}
        {!dashboard && !error ? <div className="engagement-loading">Loading engagement overview…</div> : null}
        {dashboard ? <>
          <div className="engagement-kpis">
            {dashboard.metrics.map((metric) => <article key={metric.key}><span>{metric.label}</span><strong>{formatMetric(metric)}</strong><small className={metric.change < 0 ? "negative" : ""}>{metric.change < 0 ? "↓" : "↑"} {Math.abs(metric.change).toLocaleString(undefined, { maximumFractionDigits: 1 })}% <i>vs prior period</i></small></article>)}
          </div>
          <div className="engagement-chart-grid">
            <article className="engagement-card engagement-card-wide"><header><div><strong>User engagement</strong><span>Active users over time</span></div><small>{filters.dateFrom} → {filters.dateTo}</small></header><div className="engagement-bars" aria-label="Active users by date">{dashboard.engagement.map((item) => <i key={item.sessionDate} title={`${item.sessionDate}: ${Number(item.activeUsers).toLocaleString()} active users`} style={{ height: Math.max(4, Number(item.activeUsers) / maximumEngagement * 100) + "%" }} />)}</div></article>
            <article className="engagement-card"><header><div><strong>Conversion funnel</strong><span>Customer journey</span></div></header><div className="engagement-funnel">{dashboard.funnel.map((item) => <div key={item.stage}><span>{item.stage}</span><i><b style={{ width: Math.max(4, Number(item.users) / maximumFunnel * 100) + "%" }} /></i><strong>{Number(item.users).toLocaleString()}</strong></div>)}</div></article>
            <article className="engagement-card engagement-card-wide"><header><div><strong>Recent users</strong><span>Latest activity in the selected period</span></div></header><div className="engagement-users"><div className="engagement-user-row engagement-user-head"><span>User</span><span>Status</span><span>Location</span><span>Last activity</span></div>{dashboard.recentUsers.map((user) => <div className="engagement-user-row" key={user.userId}><span className="engagement-user-name"><i>{initials(user.firstName, user.lastName)}</i><b>{user.firstName} {user.lastName}<small>{user.email}</small></b></span><span><em className={user.customerStatus === "Active" ? "active" : ""}>{user.customerStatus}</em></span><span>{user.city}, {user.region}</span><span>{new Date(user.startedAt).toLocaleString()}</span></div>)}</div></article>
            <article className="engagement-card"><header><div><strong>Device distribution</strong><span>Sessions by device</span></div></header><div className="engagement-device"><div className="engagement-donut" style={{ background: `conic-gradient(${deviceStops || "#dce4e8 0 100%"})` }}><span>{deviceTotal.toLocaleString()}<small>sessions</small></span></div><div>{dashboard.devices.map((item, index) => <p key={item.deviceType}><i style={{ background: COLORS[index % COLORS.length] }} /><span>{item.deviceType}</span><strong>{deviceTotal ? (Number(item.sessions) / deviceTotal * 100).toLocaleString(undefined, { maximumFractionDigits: 1 }) : 0}%</strong></p>)}</div></div></article>
          </div>
        </> : null}
      </section>
    </div>
  </details>;
}
