'use client';

import { useEffect, useRef, useState } from 'react';

export type PlotlyTrace = Record<string, unknown> & {
  type?: string;
  x?: unknown[];
  y?: unknown[];
  labels?: unknown[];
  values?: unknown[];
};

export type PlotlyFigure = {
  title: string;
  description: string;
  data: PlotlyTrace[];
  layout: Record<string, unknown>;
  traceCount: number;
  pointCount: number;
};

const MAX_TRACES = 12;
const MAX_POINTS = 2000;
export const PLOTLY_TRACE_TYPES = [
  'bar', 'scatter', 'pie', 'heatmap', 'histogram',
  'box', 'violin', 'treemap', 'sunburst', 'funnel',
] as const;

function cleanText(value: string, limit = 300) {
  return value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f]/g, ' ').slice(0, limit);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 7 || value === null) return value === null ? null : undefined;
  if (typeof value === 'string') return cleanText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, MAX_POINTS).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value !== 'object') return undefined;

  const safe: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
    if (['__proto__', 'prototype', 'constructor', 'images', 'mapbox', 'geo'].includes(key)) continue;
    const sanitized = sanitizeValue(item, depth + 1);
    if (sanitized !== undefined) safe[key] = sanitized;
  }
  return safe;
}

function countPoints(trace: PlotlyTrace) {
  return Math.max(
    Array.isArray(trace.x) ? trace.x.length : 0,
    Array.isArray(trace.y) ? trace.y.length : 0,
    Array.isArray(trace.labels) ? trace.labels.length : 0,
    Array.isArray(trace.values) ? trace.values.length : 0,
  );
}

export function normalizePlotlyFigure(input: Record<string, unknown>): PlotlyFigure {
  if (JSON.stringify(input).length > 350_000) throw new Error('The visualization specification is too large.');
  if (!Array.isArray(input.data) || input.data.length === 0) throw new Error('At least one Plotly trace is required.');
  if (input.data.length > MAX_TRACES) throw new Error(`A visualization may contain at most ${MAX_TRACES} traces.`);

  let pointCount = 0;
  const data = input.data.map((rawTrace) => {
    if (!rawTrace || typeof rawTrace !== 'object' || Array.isArray(rawTrace)) throw new Error('Each Plotly trace must be an object.');
    const trace = sanitizeValue(rawTrace) as PlotlyTrace;
    const type = typeof trace.type === 'string' ? trace.type : 'scatter';
    if (!PLOTLY_TRACE_TYPES.includes(type as (typeof PLOTLY_TRACE_TYPES)[number])) throw new Error(`Unsupported Plotly trace type: ${type}.`);
    trace.type = type;
    pointCount += countPoints(trace);
    if (pointCount > MAX_POINTS) throw new Error(`A visualization may contain at most ${MAX_POINTS.toLocaleString()} points.`);
    return trace;
  });

  const title = cleanText(typeof input.title === 'string' ? input.title : 'Agent visualization', 100);
  const description = cleanText(typeof input.description === 'string' ? input.description : 'A bespoke view generated from the release calendar.', 220);
  const suppliedLayout = input.layout && typeof input.layout === 'object' && !Array.isArray(input.layout)
    ? sanitizeValue(input.layout) as Record<string, unknown>
    : {};
  const suppliedHeight = typeof suppliedLayout.height === 'number' ? suppliedLayout.height : 480;
  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: '#f8fbfc',
    colorway: ['#1677a8', '#4b9b86', '#c98025', '#7d6ba8', '#bf6660', '#5c7185', '#93a844', '#be7d9e'],
    font: { family: 'Segoe UI, Arial, sans-serif', color: '#384550', size: 12 },
    margin: { l: 58, r: 28, t: 30, b: 58 },
    hoverlabel: { bgcolor: '#17202a', bordercolor: '#17202a', font: { color: '#ffffff' } },
    ...suppliedLayout,
    title: undefined,
    autosize: true,
    height: Math.min(720, Math.max(360, suppliedHeight)),
  };

  return { title, description, data, layout, traceCount: data.length, pointCount };
}

export async function renderPlotlyFigureToPng(figure: PlotlyFigure) {
  const plotlyModule = await import('plotly.js-dist-min');
  const plotly = plotlyModule.default;
  const node = document.createElement('div');
  const height = Math.min(720, Math.max(360, Number(figure.layout.height) || 480));
  node.style.cssText = `position:fixed;left:-10000px;top:0;width:1200px;height:${height}px;background:#fff;`;
  document.body.appendChild(node);

  try {
    await plotly.react(node, figure.data, { ...figure.layout, width: 1200, height }, {
      staticPlot: true,
      displayModeBar: false,
      responsive: false,
    });
    const dataUrl = await plotly.toImage(node, { format: 'png', width: 1200, height, scale: 1 });
    const separator = dataUrl.indexOf(',');
    if (separator < 0) throw new Error('Plotly returned an invalid PNG payload.');
    return dataUrl.slice(separator + 1);
  } finally {
    plotly.purge(node);
    node.remove();
  }
}

export function PlotlyCanvas({ figure }: { figure: PlotlyFigure }) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [renderState, setRenderState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    let plotly: typeof import('plotly.js-dist-min').default | null = null;
    const plotElement = plotRef.current;

    const draw = async () => {
      try {
        setRenderState('loading');
        const plotlyModule = await import('plotly.js-dist-min');
        plotly = plotlyModule.default;
        if (!active || !plotElement) return;
        await plotly.react(plotElement, figure.data, figure.layout, {
          responsive: true,
          displaylogo: false,
          scrollZoom: false,
          modeBarButtonsToRemove: ['sendDataToCloud', 'lasso2d', 'select2d'],
          toImageButtonOptions: { format: 'png', filename: 'adaptive-interface-visualization', scale: 2 },
        });
        if (active) setRenderState('ready');
      } catch {
        if (active) setRenderState('error');
      }
    };

    void draw();
    return () => {
      active = false;
      if (plotly && plotElement) plotly.purge(plotElement);
    };
  }, [figure]);

  return (
    <div className="plotly-stage" aria-label={`${figure.title}. ${figure.description}`}>
      {renderState === 'loading' && <div className="plotly-status">Rendering Plotly figure…</div>}
      {renderState === 'error' && <div className="plotly-status error">This Plotly specification could not be rendered.</div>}
      <div className="plotly-canvas" ref={plotRef} />
    </div>
  );
}
