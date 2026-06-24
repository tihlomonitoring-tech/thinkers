/**
 * Org chart with visible parent–child connector lines (tree layout).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { orgChartCanvasSize } from '../lib/orgChartTree.js';

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.1;
/** Extra space so node shadows and connector lines are not clipped by the viewport. */
const CHART_EDGE_BUFFER = 96;
const CHART_VIEW_PADDING = 40;

function nodeId(node) {
  return String(node?.id || node?.user_id || node?.position_id || '');
}

function initials(name) {
  const p = String(name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!p.length) return '?';
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

function NodeCard({ node, selectedUserId, onSelectPerson, interactive }) {
  const uid = node.user_id ? String(node.user_id) : null;
  const selected = uid && String(selectedUserId) === uid;
  const vacant = !uid;
  const Tag = interactive && uid ? 'button' : 'div';

  return (
    <Tag
      type={interactive && uid ? 'button' : undefined}
      onClick={interactive && uid ? () => onSelectPerson?.(uid) : undefined}
      className={`org-chart-node relative z-[1] mx-1.5 min-w-[168px] max-w-[220px] rounded-xl border px-3 py-2.5 text-left transition ${
        vacant
          ? 'border-dashed border-surface-300 bg-surface-50 dark:border-surface-600 dark:bg-surface-900/50'
          : selected
            ? 'border-brand-500 ring-2 ring-brand-500/30 bg-brand-50 dark:bg-brand-950/50'
            : interactive && uid
              ? 'border-surface-200 bg-white hover:border-brand-400 hover:shadow-lg cursor-pointer dark:border-surface-600 dark:bg-surface-800'
              : 'border-surface-200 bg-white dark:border-surface-600 dark:bg-surface-800'
      }`}
      style={{
        boxShadow: vacant
          ? '0 2px 4px rgba(15,23,42,0.06)'
          : '0 1px 0 rgba(255,255,255,0.9) inset, 0 4px 10px rgba(15,23,42,0.12), 0 12px 24px rgba(15,23,42,0.08)',
      }}
    >
      <div className="flex items-start gap-2">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
            vacant ? 'bg-surface-200 text-surface-500' : 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-100'
          }`}
          style={{
            boxShadow: vacant ? 'none' : '0 2px 4px rgba(67,56,202,0.2), inset 0 1px 0 rgba(255,255,255,0.6)',
          }}
        >
          {vacant ? '—' : initials(node.display_name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-snug text-surface-900 break-words dark:text-surface-50">
            {vacant ? 'Vacant' : node.display_name}
          </p>
          <p className="text-[10px] leading-snug text-brand-700 break-words dark:text-brand-300">{node.position_title || '—'}</p>
          {node.department_name && (
            <p className="text-[9px] leading-snug text-surface-500 break-words">{node.department_name}</p>
          )}
        </div>
      </div>
    </Tag>
  );
}

function OrgChartLi({ node, selectedUserId, onSelectPerson, interactive }) {
  const children = node.children || [];

  return (
    <li className="org-chart-li">
      <NodeCard node={node} selectedUserId={selectedUserId} onSelectPerson={onSelectPerson} interactive={interactive} />
      {children.length > 0 && (
        <ul className="org-chart-ul">
          {children.map((c) => (
            <OrgChartLi
              key={nodeId(c)}
              node={c}
              selectedUserId={selectedUserId}
              onSelectPerson={onSelectPerson}
              interactive={interactive}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

const CHART_STYLES = `
.org-chart-root { overflow: visible; display: inline-block; width: max-content; max-width: none; }
.org-chart-root .org-chart-node { overflow: visible; }
.org-chart-root .org-chart { display: flex; justify-content: center; flex-wrap: nowrap; padding: 0; margin: 0; list-style: none; gap: 8px; }
.org-chart-root .org-chart-ul {
  display: flex; justify-content: center; flex-wrap: nowrap; padding-top: 28px; margin: 0; list-style: none; position: relative; gap: 4px;
}
.org-chart-root .org-chart-ul::before {
  content: ''; position: absolute; top: 0; left: 50%; width: 0; height: 28px;
  border-left: 2px solid #94a3b8;
}
.org-chart-root .org-chart-li {
  display: flex; flex-direction: column; align-items: center; position: relative;
  padding: 28px 14px 0 14px; list-style: none; flex-shrink: 0;
}
.org-chart-root .org-chart-li::before,
.org-chart-root .org-chart-li::after {
  content: ''; position: absolute; top: 0; width: 50%; height: 28px;
  border-top: 2px solid #94a3b8;
}
.org-chart-root .org-chart-li::before { right: 50%; border-right: 2px solid #94a3b8; border-radius: 0 8px 0 0; }
.org-chart-root .org-chart-li::after { left: 50%; border-left: 2px solid #94a3b8; border-radius: 8px 0 0 0; }
.org-chart-root .org-chart-li:only-child::before,
.org-chart-root .org-chart-li:only-child::after { display: none; }
.org-chart-root .org-chart-li:first-child::before { border: none; }
.org-chart-root .org-chart-li:last-child::after { border: none; }
.org-chart-root .org-chart > .org-chart-li { padding-top: 0; }
.org-chart-root .org-chart > .org-chart-li::before,
.org-chart-root .org-chart > .org-chart-li::after { display: none; }
.org-chart-root .org-chart-li > .org-chart-node::before {
  content: ''; position: absolute; top: -28px; left: 50%; width: 0; height: 28px;
  border-left: 2px solid #94a3b8; transform: translateX(-50%);
}
.org-chart-root .org-chart > .org-chart-li > .org-chart-node::before { display: none; }
.dark .org-chart-root .org-chart-li::before,
.dark .org-chart-root .org-chart-li::after,
.dark .org-chart-root .org-chart-ul::before,
.dark .org-chart-root .org-chart-li > .org-chart-node::before {
  border-color: #64748b;
}
`;

function clampZoom(value) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(value * 100) / 100));
}

function assignRef(target, node) {
  if (!target) return;
  if (typeof target === 'function') target(node);
  else target.current = node;
}

export default function OrgChartTreeDiagram({
  roots = [],
  selectedUserId,
  onSelectPerson,
  interactive = true,
  emptyMessage,
  chartRef,
  exportLayout = false,
}) {
  const containerRef = useRef(null);
  const innerRef = useRef(null);
  const autoFitRef = useRef(true);
  const chartSizeRef = useRef({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });
  const estimate = orgChartCanvasSize(roots);

  const applyFitZoom = useCallback(() => {
    const container = containerRef.current;
    const { width, height } = chartSizeRef.current;
    if (!container || !width || !height) return;
    const pad = CHART_VIEW_PADDING * 2;
    const fitW = (container.clientWidth - pad) / (width + CHART_EDGE_BUFFER);
    const fitH = (container.clientHeight - pad) / (height + CHART_EDGE_BUFFER);
    setZoom(clampZoom(Math.min(1, fitW, fitH)));
  }, []);

  const measureChart = useCallback(() => {
    const chart = innerRef.current;
    const width = chart?.scrollWidth || estimate.width;
    const height = chart?.scrollHeight || estimate.height;
    chartSizeRef.current = { width, height };
    setChartSize({ width, height });
    return { width, height };
  }, [estimate.width, estimate.height]);

  const fitToView = useCallback(() => {
    autoFitRef.current = true;
    applyFitZoom();
  }, [applyFitZoom]);

  const changeZoom = useCallback((next) => {
    autoFitRef.current = false;
    setZoom((current) => clampZoom(typeof next === 'function' ? next(current) : next));
  }, []);

  useEffect(() => {
    autoFitRef.current = true;
    setZoom(1);
    const run = () => {
      measureChart();
      applyFitZoom();
    };
    const id = requestAnimationFrame(() => requestAnimationFrame(run));
    const t = setTimeout(run, 200);
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(t);
    };
  }, [roots, measureChart, applyFitZoom]);

  useEffect(() => {
    if (exportLayout) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const ro = new ResizeObserver(() => {
      if (autoFitRef.current) applyFitZoom();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [exportLayout, applyFitZoom]);

  if (!roots?.length) {
    return (
      <div className="rounded-xl border border-dashed border-surface-300 p-10 text-center text-sm text-surface-500 dark:border-surface-600">
        {emptyMessage || 'No reporting structure to display.'}
      </div>
    );
  }

  const chartW = chartSize.width || estimate.width;
  const chartH = chartSize.height || estimate.height;
  const contentW = chartW + CHART_EDGE_BUFFER;
  const contentH = chartH + CHART_EDGE_BUFFER;
  const clipW = Math.ceil(contentW * zoom);
  const clipH = Math.ceil(contentH * zoom);
  const scrollW = clipW + CHART_VIEW_PADDING * 2;
  const scrollH = clipH + CHART_VIEW_PADDING * 2;

  const zoomBtn =
    'h-8 min-w-[2rem] px-2 text-sm font-medium rounded-md border border-surface-300 hover:bg-surface-50 dark:border-surface-600 dark:hover:bg-surface-800 disabled:opacity-40';

  return (
    <div className="space-y-2">
      {!exportLayout && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={fitToView} className={`${zoomBtn} text-xs`}>
            Fit all
          </button>
          <div className="inline-flex items-center gap-1 rounded-md border border-surface-300 p-0.5 dark:border-surface-600">
            <button
              type="button"
              aria-label="Zoom out"
              className={zoomBtn}
              disabled={zoom <= ZOOM_MIN}
              onClick={() => changeZoom((z) => z - ZOOM_STEP)}
            >
              −
            </button>
            <span className="min-w-[3.25rem] text-center text-xs font-medium text-surface-700 dark:text-surface-200">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              aria-label="Zoom in"
              className={zoomBtn}
              disabled={zoom >= ZOOM_MAX}
              onClick={() => changeZoom((z) => z + ZOOM_STEP)}
            >
              +
            </button>
          </div>
          <button type="button" className={`${zoomBtn} text-xs`} onClick={() => changeZoom(1)}>
            100%
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className={`w-full rounded-xl border border-surface-200 bg-surface-50/80 dark:border-surface-700 dark:bg-surface-900/40 ${
          exportLayout ? 'overflow-visible' : 'overflow-auto'
        }`}
        style={exportLayout ? undefined : { maxHeight: 'min(78vh, 1100px)', minHeight: 320 }}
      >
        <div
          style={
            exportLayout
              ? { padding: CHART_VIEW_PADDING }
              : {
                  boxSizing: 'border-box',
                  padding: CHART_VIEW_PADDING,
                  width: scrollW,
                  minHeight: scrollH,
                }
          }
        >
          <div
            style={
              exportLayout
                ? undefined
                : {
                    width: clipW,
                    minHeight: clipH,
                    overflow: 'visible',
                  }
            }
          >
            <div
              style={
                exportLayout
                  ? undefined
                  : {
                      transform: `scale(${zoom})`,
                      transformOrigin: 'top left',
                      display: 'inline-block',
                      width: contentW,
                    }
              }
            >
              <div
                ref={(node) => {
                  innerRef.current = node;
                  assignRef(chartRef, node);
                }}
                className="org-chart-root"
                style={exportLayout ? undefined : { paddingRight: CHART_EDGE_BUFFER / 2, paddingBottom: CHART_EDGE_BUFFER / 2 }}
              >
                <style>{CHART_STYLES}</style>
                <ul className="org-chart">
                  {roots.map((r) => (
                    <OrgChartLi
                      key={nodeId(r)}
                      node={r}
                      selectedUserId={selectedUserId}
                      onSelectPerson={onSelectPerson}
                      interactive={interactive}
                    />
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
