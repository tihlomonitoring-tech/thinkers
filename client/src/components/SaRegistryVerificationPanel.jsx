import { useCallback, useEffect, useState } from 'react';
import { openAttachmentWithAuth, downloadAttachmentWithAuth } from '../api';

function StatusIcon({ status }) {
  if (status === 'valid') {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-700 shrink-0" title="Verified">
        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      </span>
    );
  }
  if (status === 'mismatch' || status === 'partial') {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-800 shrink-0" title={status === 'partial' ? 'Partial data' : 'Partial match'}>
        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      </span>
    );
  }
  if (status === 'invalid' || status === 'error') {
    return (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-700 shrink-0" title="Not verified">
        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </span>
    );
  }
  return null;
}

function DetailRow({ label, value, children }) {
  if (children) {
    return (
      <p className="text-xs text-surface-600">
        <span className="text-surface-500">{label}:</span> {children}
      </p>
    );
  }
  if (value == null || value === '') return null;
  return (
    <p className="text-xs text-surface-600">
      <span className="text-surface-500">{label}:</span> {value}
    </p>
  );
}

function displayValue(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!s || /^undef(ined)?$/i.test(s) || s === '-' || s.toLowerCase() === 'null') return null;
  return s;
}

function providerLabel(provider) {
  if (provider === 'mie') return 'MIE';
  if (provider === 'nps') return 'NP Tracker';
  return null;
}

export function SaVehicleVerificationPanel({
  verifyFn,
  registration,
  makeModel,
  vin,
  compact = false,
  autoRun = false,
  fleetApplicationId = null,
  fleetApplicationsApi = null,
}) {
  const [state, setState] = useState({ loading: false, result: null, error: '', hasRun: false, pdfAvailable: false });

  const loadSavedReport = useCallback(() => {
    const loadReport = fleetApplicationsApi?.mieReport || fleetApplicationsApi?.npTrackerReport;
    if (!fleetApplicationId || !loadReport) return Promise.resolve(null);
    return loadReport(fleetApplicationId)
      .then((res) => {
        const report = res?.report;
        if (!report?.verification) return null;
        setState({
          loading: false,
          result: report.verification,
          error: '',
          hasRun: true,
          pdfAvailable: !!report.pdfAvailable,
        });
        return report;
      })
      .catch(() => null);
  }, [fleetApplicationId, fleetApplicationsApi]);

  const runVerify = useCallback(() => {
    const reg = String(registration || '').trim();
    if (!reg) {
      setState({ loading: false, result: null, error: '', hasRun: false, pdfAvailable: false });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: '' }));
    const runSaved =
      fleetApplicationsApi?.runMieVerify || fleetApplicationsApi?.runNpTrackerVerify;
    const runPromise =
      fleetApplicationId && runSaved
        ? runSaved(fleetApplicationId).then((res) => res.report)
        : verifyFn({ registration: reg, makeModel: makeModel || undefined, vin: vin || undefined }).then((verification) => ({
            verification,
            pdfAvailable: false,
          }));

    runPromise
      .then((payload) => {
        const verification = payload?.verification || payload;
        setState({
          loading: false,
          result: verification,
          error: '',
          hasRun: true,
          pdfAvailable: !!payload?.pdfAvailable,
        });
      })
      .catch((err) =>
        setState({ loading: false, result: null, error: err?.message || 'Verification failed', hasRun: true, pdfAvailable: false })
      );
  }, [verifyFn, registration, makeModel, vin, fleetApplicationId, fleetApplicationsApi]);

  useEffect(() => {
    if (fleetApplicationId) {
      loadSavedReport();
      return;
    }
    if (autoRun) runVerify();
  }, [fleetApplicationId, loadSavedReport, autoRun, runVerify]);

  if (!String(registration || '').trim()) return null;

  const { loading, result, error, hasRun, pdfAvailable } = state;
  const status = result?.status;
  const verified = result?.verified || {};
  const sourceLabel = providerLabel(result?.provider) || 'MIE';
  const pdfUrl =
    fleetApplicationId && (fleetApplicationsApi?.miePdfUrl || fleetApplicationsApi?.npTrackerPdfUrl)
      ? (fleetApplicationsApi.miePdfUrl || fleetApplicationsApi.npTrackerPdfUrl)(fleetApplicationId)
      : null;

  const openPdf = () => {
    if (!pdfUrl) return;
    openAttachmentWithAuth(pdfUrl).catch((e) => window.alert(e?.message || 'Could not open PDF report'));
  };

  const downloadPdf = () => {
    if (!pdfUrl) return;
    const regSlug = String(registration || 'vehicle').replace(/[^a-zA-Z0-9-]/g, '_');
    downloadAttachmentWithAuth(pdfUrl, `mie-register-${regSlug}.pdf`).catch((e) =>
      window.alert(e?.message || 'Could not download PDF report')
    );
  };

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {loading ? <span className="text-xs text-surface-400">Checking…</span> : hasRun ? <StatusIcon status={status} /> : null}
      </span>
    );
  }

  return (
    <div className="rounded-lg border border-surface-200 bg-surface-50/80 p-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {loading ? (
            <span className="text-xs text-surface-500">Querying MIE…</span>
          ) : hasRun ? (
            <>
              <StatusIcon status={status} />
              <p className="text-sm font-medium text-surface-900">
                {status === 'valid' && 'Registration verified'}
                {status === 'partial' && 'Limited register data'}
                {status === 'mismatch' && 'Registered — details mismatch'}
                {status === 'invalid' && 'Registration not verified'}
                {status === 'unavailable' && 'Verification not configured'}
                {status === 'error' && 'Verification error'}
                {!status && 'Registration check'}
              </p>
            </>
          ) : (
            <p className="text-sm text-surface-700">SA register check (MIE)</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={runVerify}
            disabled={loading}
            className="text-xs font-medium px-2.5 py-1 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? 'Running…' : hasRun ? 'Run again' : 'Run MIE check'}
          </button>
          {pdfAvailable && pdfUrl && (
            <>
              <button
                type="button"
                onClick={openPdf}
                className="text-xs font-medium px-2.5 py-1 rounded-lg border border-surface-800 bg-surface-900 text-white hover:bg-black"
              >
                View PDF report
              </button>
              <button
                type="button"
                onClick={downloadPdf}
                className="text-xs font-medium px-2.5 py-1 rounded-lg border border-surface-300 text-surface-700 hover:bg-white"
              >
                Download PDF
              </button>
            </>
          )}
        </div>
      </div>

      {!hasRun && !loading && (
        <p className="text-xs text-surface-500">
          The check does not run automatically. Click <strong>Run MIE check</strong> when you want to verify this registration.
          {fleetApplicationId ? ' The PDF report is saved and can be viewed later without re-running the check.' : ''}
        </p>
      )}

      {hasRun && pdfAvailable && pdfUrl && (
        <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          A dark-theme PDF report is saved for this application. Use <strong>View PDF report</strong> anytime — no need to run the check again.
        </p>
      )}

      {!loading && result && (
        <>
          {sourceLabel && (
            <p className="text-xs text-surface-500">Source: {sourceLabel} · {result.checkedAt ? new Date(result.checkedAt).toLocaleString() : ''}</p>
          )}
          <div className="space-y-0.5 pt-1 border-t border-surface-200/80">
            <DetailRow label="Plate (register)" value={displayValue(verified.plate || result.registration)} />
            <DetailRow label="VIN" value={displayValue(verified.vin)} />
            {!displayValue(verified.vin) && hasRun && result?.provider === 'nps' && (
              <p className="text-xs text-surface-500 italic">NP Tracker may withhold part of the VIN. Open the PDF report for the full saved register snapshot.</p>
            )}
            <DetailRow label="Make" value={displayValue(verified.make)} />
            <DetailRow label="Model" value={displayValue(verified.model)} />
            <DetailRow label="Description" value={displayValue(verified.description)} />
            <DetailRow label="Colour" value={displayValue(verified.colour)} />
            <DetailRow label="Engine no." value={displayValue(verified.engineNumber)} />
            <DetailRow label="Source ID" value={displayValue(verified.sourceId)} />
            {displayValue(verified.pictureUrl) && (
              <DetailRow label="Vehicle image">
                <a href={verified.pictureUrl} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline break-all">
                  Open image
                </a>
              </DetailRow>
            )}
            {verified.suspectFlag && result?.provider === 'nps' && (
              <p className="text-xs text-amber-800 font-medium">Flagged on NP Tracker suspect database</p>
            )}
          </div>
          <p className={`text-xs ${status === 'valid' ? 'text-green-800' : status === 'mismatch' || status === 'partial' ? 'text-amber-800' : 'text-red-700'}`}>
            {result.message || error}
          </p>
          {status === 'unavailable' && (
            <p className="text-xs text-surface-500">
              Add MIE_API_BASE_URL and MIE_API_KEY to the server environment (contact mie.co.za for enterprise API access) and restart the API.
            </p>
          )}
        </>
      )}
      {!loading && error && !result && hasRun && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

export function SaDriverLicenseVerificationPanel({ verifyFn, licenseNumber, idNumber, surname, licenseExpiry, autoRun = false }) {
  const [state, setState] = useState({ loading: false, result: null, error: '', hasRun: false });

  const runVerify = useCallback(() => {
    const lic = String(licenseNumber || '').trim();
    const id = String(idNumber || '').trim();
    if (!lic && !id) {
      setState({ loading: false, result: null, error: '', hasRun: false });
      return;
    }
    setState({ loading: true, result: null, error: '', hasRun: true });
    verifyFn({ licenseNumber: lic || undefined, idNumber: id || undefined, surname: surname || undefined })
      .then((result) => setState({ loading: false, result, error: '', hasRun: true }))
      .catch((err) => setState({ loading: false, result: null, error: err?.message || 'Verification failed', hasRun: true }));
  }, [verifyFn, licenseNumber, idNumber, surname]);

  useEffect(() => {
    if (autoRun) runVerify();
  }, [autoRun, runVerify]);

  if (!String(licenseNumber || '').trim() && !String(idNumber || '').trim()) return null;

  const { loading, result, hasRun } = state;
  const status = result?.status;
  const verified = result?.verified || {};

  return (
    <div className="rounded-lg border border-surface-200 bg-surface-50/80 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {loading ? (
            <span className="text-xs text-surface-500">Checking licence…</span>
          ) : hasRun ? (
            <>
              <StatusIcon status={status} />
              <p className="text-sm font-medium text-surface-900">
                {status === 'valid' && 'Driver licence verified'}
                {status === 'mismatch' && 'Licence found — details mismatch'}
                {status === 'invalid' && 'Licence not verified'}
                {status === 'unavailable' && 'Licence verification not configured'}
                {status === 'error' && 'Verification error'}
              </p>
            </>
          ) : (
            <p className="text-sm text-surface-700">Driver licence check (MIE)</p>
          )}
        </div>
        <button type="button" onClick={runVerify} disabled={loading} className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50">
          {loading ? 'Running…' : hasRun ? 'Run again' : 'Run MIE check'}
        </button>
      </div>
      {!hasRun && !loading && (
        <p className="text-xs text-surface-500">Click Run MIE check when you want to verify this licence.</p>
      )}
      {!loading && result && (
        <>
          {result.provider === 'mie' && (
            <p className="text-xs text-surface-500">Source: MIE · {result.checkedAt ? new Date(result.checkedAt).toLocaleString() : ''}</p>
          )}
          {(status === 'valid' || status === 'mismatch') && (
            <div className="space-y-0.5 pt-1 border-t border-surface-200/80">
              <DetailRow label="Licence no." value={verified.licenseNumber} />
              <DetailRow label="ID no." value={verified.idNumber ? `${String(verified.idNumber).slice(0, 6)}••••••` : null} />
              <DetailRow label="Expiry (register)" value={verified.licenseDiscExpiry} />
              <DetailRow label="Codes" value={verified.licenseCodes} />
              {verified.prdpValid != null && (
                <DetailRow label="PrDP" value={verified.prdpValid ? 'Valid' : 'Not valid / not found'} />
              )}
            </div>
          )}
          {licenseExpiry && status === 'valid' && !verified.licenseDiscExpiry && (
            <DetailRow label="Expiry (application)" value={new Date(licenseExpiry).toLocaleDateString()} />
          )}
          <p className={`text-xs ${status === 'valid' ? 'text-green-800' : status === 'mismatch' ? 'text-amber-800' : 'text-red-700'}`}>
            {result.message || state.error}
          </p>
          {status === 'unavailable' && (
            <p className="text-xs text-surface-500">Add MIE_API_BASE_URL and MIE_API_KEY to the server environment and restart the API.</p>
          )}
        </>
      )}
    </div>
  );
}
