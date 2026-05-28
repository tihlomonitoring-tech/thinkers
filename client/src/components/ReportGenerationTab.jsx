import { useCallback, useEffect, useState } from 'react';
import { reportGeneration as reportApi, contractor as contractorApi } from '../api.js';
import { generateProductionReportPdf } from '../lib/productionReportPdf.js';

const CHART_SLOTS = [
  { key: 'production_chart', label: 'Production summary chart' },
  { key: 'fleet_chart', label: 'Fleet / market share chart' },
  { key: 'compliance_chart', label: 'Compliance chart' },
  { key: 'custom_1', label: 'Custom chart 1' },
  { key: 'custom_2', label: 'Custom chart 2' },
];

function defaultDates() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(1);
  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: end.toISOString().slice(0, 10),
    submitted: end.toISOString().slice(0, 10),
  };
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function ReportGenerationTab({ user }) {
  const dates = defaultDates();
  const [routes, setRoutes] = useState([]);
  const [reports, setReports] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [dataPreview, setDataPreview] = useState(null);
  const [aiInstructions, setAiInstructions] = useState('');
  const [form, setForm] = useState({
    title: '',
    routeId: '',
    routeName: '',
    dateFrom: dates.dateFrom,
    dateTo: dates.dateTo,
    preparedBy: 'Tihlo (Thinkers Afrika)',
    submittedDate: dates.submitted,
  });
  const [uploadSlot, setUploadSlot] = useState('production_chart');

  const loadReports = useCallback(() => {
    reportApi
      .list()
      .then((r) => setReports(r.reports || []))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    loadReports();
    contractorApi.routes
      .list()
      .then((r) => setRoutes(r.routes || []))
      .catch(() => setRoutes([]));
  }, [loadReports]);

  const selectReport = async (id) => {
    setLoading(true);
    setError('');
    try {
      const { report: r } = await reportApi.get(id);
      setReport(r);
      setDataPreview(r.data_bundle || null);
      setForm({
        title: r.title || '',
        routeId: r.route_id || '',
        routeName: r.route_name || '',
        dateFrom: r.date_from?.slice?.(0, 10) || r.date_from,
        dateTo: r.date_to?.slice?.(0, 10) || r.date_to,
        preparedBy: r.prepared_by || 'Tihlo (Thinkers Afrika)',
        submittedDate: r.submitted_date?.slice?.(0, 10) || r.submitted_date || dates.submitted,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const onRouteChange = (routeId) => {
    const route = routes.find((r) => String(r.id) === String(routeId));
    setForm((f) => ({
      ...f,
      routeId,
      routeName: route?.name || '',
      title: f.title || (route?.name ? `${route.name} Performance Report` : f.title),
    }));
  };

  const createReport = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const title =
        form.title.trim() ||
        (form.routeName ? `${form.routeName} Performance Report` : 'Monthly Performance Report');
      const { report: r } = await reportApi.create({
        title,
        route_id: form.routeId || null,
        route_name: form.routeName || null,
        date_from: form.dateFrom,
        date_to: form.dateTo,
        prepared_by: form.preparedBy,
        submitted_date: form.submittedDate || null,
      });
      setReport(r);
      setMessage('Draft created. Load data, then generate with AI.');
      loadReports();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const saveMetadata = async () => {
    if (!report?.id) return;
    setLoading(true);
    setError('');
    try {
      const { report: r } = await reportApi.update(report.id, {
        title: form.title,
        route_id: form.routeId || null,
        route_name: form.routeName || null,
        date_from: form.dateFrom,
        date_to: form.dateTo,
        prepared_by: form.preparedBy,
        submitted_date: form.submittedDate || null,
        content: report.content,
      });
      setReport(r);
      setMessage('Saved.');
      loadReports();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadDataBundle = async () => {
    if (!report?.id) return;
    setLoading(true);
    setError('');
    try {
      const { data_bundle } = await reportApi.buildDataBundle(report.id);
      setDataPreview(data_bundle);
      setMessage('Operational data loaded for this period.');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const generateAi = async () => {
    if (!report?.id) return;
    setLoading(true);
    setError('');
    setMessage('Generating report with AI — this may take a minute…');
    try {
      const { report: r } = await reportApi.generate(report.id, {
        instructions: aiInstructions,
      });
      setReport(r);
      setDataPreview(r.data_bundle || dataPreview);
      setMessage('AI report generated. Review content and download PDF.');
      loadReports();
    } catch (e) {
      setError(e.message);
      setMessage('');
    } finally {
      setLoading(false);
    }
  };

  const uploadChart = async (file) => {
    if (!report?.id || !file) return;
    setLoading(true);
    setError('');
    try {
      await reportApi.uploadAttachment(report.id, file, {
        slot_key: uploadSlot,
        label: CHART_SLOTS.find((s) => s.key === uploadSlot)?.label,
      });
      const { report: r } = await reportApi.get(report.id);
      setReport(r);
      setMessage('Chart uploaded.');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const downloadPdf = async () => {
    if (!report?.content) {
      setError('Generate the report with AI first.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      let logoDataUrl;
      try {
        const res = await fetch(reportApi.logoUrl(), { credentials: 'include' });
        if (res.ok) {
          const blob = await res.blob();
          logoDataUrl = await fileToDataUrl(blob);
        }
      } catch (_) {}

      const chartImages = {};
      for (const att of report.attachments || []) {
        const url = reportApi.attachmentFileUrl(report.id, att.id);
        const res = await fetch(url, { credentials: 'include' });
        if (res.ok) {
          const blob = await res.blob();
          chartImages[att.slot_key] = await fileToDataUrl(blob);
        }
      }

      const doc = generateProductionReportPdf(
        { ...report, data_bundle: report.data_bundle || dataPreview },
        report.content,
        { logoDataUrl, chartImages }
      );
      const safeName = (report.title || 'production-report').replace(/[^\w\s-]/g, '').slice(0, 60);
      doc.save(`${safeName}.pdf`);
      setMessage('PDF downloaded.');
    } catch (e) {
      setError(e.message || 'PDF export failed');
    } finally {
      setLoading(false);
    }
  };

  const summary = dataPreview?.summary;

  return (
    <div className="max-w-6xl mx-auto space-y-6 p-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Report Generation</h2>
        <p className="text-sm text-slate-600 mt-1">
          Build monthly production reports from Command Centre data using AI. Upload charts where the PDF needs
          advanced graphs.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="font-medium text-slate-900 mb-3">Saved reports</h3>
            <button
              type="button"
              className="w-full mb-3 rounded-lg bg-slate-900 text-white text-sm py-2 hover:bg-slate-800"
              onClick={() => {
                setReport(null);
                setDataPreview(null);
                setForm({
                  title: '',
                  routeId: '',
                  routeName: '',
                  dateFrom: dates.dateFrom,
                  dateTo: dates.dateTo,
                  preparedBy: 'Tihlo (Thinkers Afrika)',
                  submittedDate: dates.submitted,
                });
              }}
            >
              New report
            </button>
            <ul className="space-y-1 max-h-64 overflow-y-auto text-sm">
              {reports.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className={`w-full text-left px-2 py-1.5 rounded hover:bg-slate-100 ${report?.id === r.id ? 'bg-slate-100 font-medium' : ''}`}
                    onClick={() => selectReport(r.id)}
                  >
                    <span className="block truncate">{r.title}</span>
                    <span className="text-xs text-slate-500">
                      {r.date_from?.slice?.(0, 10) || r.date_from} – {r.date_to?.slice?.(0, 10) || r.date_to}
                      {r.status === 'generated' ? ' · AI' : ''}
                    </span>
                  </button>
                </li>
              ))}
              {reports.length === 0 && <p className="text-slate-500 text-sm">No reports yet.</p>}
            </ul>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
            <h3 className="font-medium text-slate-900">Report setup</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-slate-600">Title</span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Majuba PS Performance Report"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Route</span>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={form.routeId}
                  onChange={(e) => onRouteChange(e.target.value)}
                >
                  <option value="">All routes</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Prepared by</span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={form.preparedBy}
                  onChange={(e) => setForm((f) => ({ ...f, preparedBy: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Period from</span>
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={form.dateFrom}
                  onChange={(e) => setForm((f) => ({ ...f, dateFrom: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Period to</span>
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={form.dateTo}
                  onChange={(e) => setForm((f) => ({ ...f, dateTo: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Submitted date</span>
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={form.submittedDate}
                  onChange={(e) => setForm((f) => ({ ...f, submittedDate: e.target.value }))}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {!report?.id ? (
                <button
                  type="button"
                  disabled={loading}
                  className="rounded-lg bg-slate-900 text-white text-sm px-4 py-2 hover:bg-slate-800 disabled:opacity-50"
                  onClick={createReport}
                >
                  Create draft
                </button>
              ) : (
                <button
                  type="button"
                  disabled={loading}
                  className="rounded-lg border border-slate-300 text-sm px-4 py-2 hover:bg-slate-50 disabled:opacity-50"
                  onClick={saveMetadata}
                >
                  Save settings
                </button>
              )}
              {report?.id && (
                <>
                  <button
                    type="button"
                    disabled={loading}
                    className="rounded-lg border border-slate-300 text-sm px-4 py-2 hover:bg-slate-50 disabled:opacity-50"
                    onClick={loadDataBundle}
                  >
                    Load Command Centre data
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    className="rounded-lg bg-indigo-600 text-white text-sm px-4 py-2 hover:bg-indigo-500 disabled:opacity-50"
                    onClick={generateAi}
                  >
                    Generate with AI
                  </button>
                  <button
                    type="button"
                    disabled={loading || !report?.content}
                    className="rounded-lg bg-emerald-600 text-white text-sm px-4 py-2 hover:bg-emerald-500 disabled:opacity-50"
                    onClick={downloadPdf}
                  >
                    Download PDF
                  </button>
                </>
              )}
            </div>
            {report?.id && (
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Extra instructions for AI (optional)</span>
                <textarea
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-[60px]"
                  value={aiInstructions}
                  onChange={(e) => setAiInstructions(e.target.value)}
                  placeholder="e.g. Emphasise compliance at Bethal weighbridge; compare hauliers Singisi vs TT Carriers"
                />
              </label>
            )}
          </div>

          {summary && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm grid sm:grid-cols-3 gap-3">
              <div>
                <span className="text-slate-500">Total loads</span>
                <p className="font-semibold text-lg">{summary.total_loads}</p>
              </div>
              <div>
                <span className="text-slate-500">Est. tonnage</span>
                <p className="font-semibold text-lg">{summary.estimated_total_tonnage} t</p>
              </div>
              <div>
                <span className="text-slate-500">Active days</span>
                <p className="font-semibold text-lg">{summary.active_production_days}</p>
              </div>
              <div>
                <span className="text-slate-500">Avg loads/day</span>
                <p className="font-medium">{summary.avg_loads_per_day}</p>
              </div>
              <div>
                <span className="text-slate-500">Trucks</span>
                <p className="font-medium">{summary.unique_trucks}</p>
              </div>
              <div>
                <span className="text-slate-500">Breakdowns in data</span>
                <p className="font-medium">{dataPreview?.breakdowns?.length ?? 0}</p>
              </div>
            </div>
          )}

          {report?.id && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
              <h3 className="font-medium text-slate-900">Upload charts for PDF</h3>
              <p className="text-xs text-slate-500">
                Use when you need dual-axis or custom graphs. AI may reference slots: production_chart, fleet_chart,
                compliance_chart.
              </p>
              <div className="flex flex-wrap gap-2 items-end">
                <label className="block">
                  <span className="text-xs text-slate-600">Slot</span>
                  <select
                    className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    value={uploadSlot}
                    onChange={(e) => setUploadSlot(e.target.value)}
                  >
                    {CHART_SLOTS.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-slate-600">Image (PNG/JPEG)</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="mt-1 block text-sm"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadChart(f);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              {(report.attachments || []).length > 0 && (
                <ul className="text-sm text-slate-600 space-y-1">
                  {report.attachments.map((a) => (
                    <li key={a.id}>
                      {a.slot_key}: {a.file_name || a.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {report?.content && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="font-medium text-slate-900 mb-2">Preview — Executive summary</h3>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{report.content.executive_summary}</p>
              {report.content.key_metrics?.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm border border-slate-200">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="px-2 py-1 text-left">Metric</th>
                        <th className="px-2 py-1 text-left">Value</th>
                        <th className="px-2 py-1 text-left">Analytical context</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.content.key_metrics.slice(0, 8).map((m, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-2 py-1 font-medium">{m.metric}</td>
                          <td className="px-2 py-1">{m.value}</td>
                          <td className="px-2 py-1 text-slate-600">{m.commentary}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
