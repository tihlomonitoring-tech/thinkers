import { useState, useEffect, useCallback } from 'react';
import { profileManagement as pm, downloadAttachmentWithAuth } from '../api';
import InfoHint from './InfoHint.jsx';
import SignaturePad from './SignaturePad.jsx';

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function WrittenWarningsProfileTab({ user, onError }) {
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [signerName, setSignerName] = useState(user?.full_name || '');
  const [signature, setSignature] = useState('');
  const [ackBusy, setAckBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await pm.writtenWarnings.listMine();
      setWarnings(r.warnings || []);
    } catch (e) {
      onError?.(e?.message || 'Failed to load written warnings');
      setWarnings([]);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const openWarning = async (w) => {
    setSelected(w);
    setDetail(null);
    setSignature('');
    setSignerName(user?.full_name || '');
    try {
      const r = await pm.writtenWarnings.get(w.id);
      setDetail(r.warning);
    } catch (e) {
      onError?.(e?.message || 'Failed to load warning');
    }
  };

  const viewPdf = () => {
    if (!selected?.id) return;
    downloadAttachmentWithAuth(
      pm.writtenWarnings.pdfUrl(selected.id),
      `${selected.reference_number || 'warning'}.pdf`
    ).catch((e) => onError?.(e?.message || 'PDF failed'));
  };

  const submitSign = async () => {
    if (!detail?.id) return;
    if (!signature) {
      onError?.('Please sign in the box below');
      return;
    }
    setAckBusy(true);
    try {
      await pm.writtenWarnings.sign(detail.id, {
        signature_data: signature,
        signer_name: signerName,
      });
      await load();
      const r = await pm.writtenWarnings.get(detail.id);
      setDetail(r.warning);
      onError?.('');
    } catch (e) {
      onError?.(e?.message || 'Signature failed');
    } finally {
      setAckBusy(false);
    }
  };

  const pending = warnings.filter((w) => w.status === 'published' && !w.signed).length;
  const pdfPreviewUrl = selected?.id ? pm.writtenWarnings.pdfUrl(selected.id) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-50">Written warnings</h2>
        <InfoHint
          title="Formal written warnings"
          text="View official warning letters, download PDFs, and sign electronically. After signing, a performance improvement plan will be created for you under the Growth tab."
        />
        {pending > 0 && (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-900">
            {pending} awaiting signature
          </span>
        )}
      </div>

      {loading && <p className="text-sm text-surface-500">Loading…</p>}
      {!loading && !warnings.length && <p className="text-sm text-surface-500">No written warnings on record.</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <ul className="app-glass-card divide-y max-h-[28rem] overflow-y-auto">
          {warnings.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                onClick={() => openWarning(w)}
                className={`w-full text-left px-4 py-3 hover:bg-surface-50 dark:hover:bg-surface-900/40 ${
                  selected?.id === w.id ? 'bg-brand-50/80' : ''
                }`}
              >
                <span className="font-medium text-sm block">{w.title}</span>
                <span className="text-xs text-surface-500">{w.reference_number}</span>
                {w.status === 'published' && !w.signed && (
                  <span className="text-xs text-amber-700 block mt-1">Signature required</span>
                )}
                {w.signed && <span className="text-xs text-emerald-700 block mt-1">Signed {fmtDate(w.signed_at)}</span>}
              </button>
            </li>
          ))}
        </ul>

        {selected && detail && (
          <div className="app-glass-card p-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={viewPdf} className="text-sm text-brand-600 hover:underline font-medium">
                Download PDF
              </button>
            </div>
            {pdfPreviewUrl && (
              <iframe title="Warning PDF" src={pdfPreviewUrl} className="w-full h-64 rounded-lg border border-surface-200 bg-white" />
            )}
            <dl className="text-sm space-y-2">
              <div>
                <dt className="text-surface-500 text-xs">Policy contravened</dt>
                <dd>{detail.policy_title} ({detail.policy_reference})</dd>
              </div>
              <div>
                <dt className="text-surface-500 text-xs">Incident summary</dt>
                <dd className="whitespace-pre-wrap">{detail.incident_summary || '—'}</dd>
              </div>
              <div>
                <dt className="text-surface-500 text-xs">Corrective action</dt>
                <dd className="whitespace-pre-wrap">{detail.corrective_action || '—'}</dd>
              </div>
            </dl>
            {detail.status === 'published' && !detail.signed && (
              <div className="border-t pt-4 space-y-3">
                <p className="text-sm font-medium">Electronic signature</p>
                <input
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="Full name"
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
                <SignaturePad onChange={setSignature} />
                <button
                  type="button"
                  disabled={ackBusy}
                  onClick={submitSign}
                  className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-50"
                >
                  {ackBusy ? 'Submitting…' : 'Sign written warning'}
                </button>
              </div>
            )}
            {detail.signed && (
              <p className="text-sm text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2">
                Signed on {fmtDate(detail.signed_at)}. Your performance improvement plan is available under Growth.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
