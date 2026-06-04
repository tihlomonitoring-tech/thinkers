import { useState, useEffect, useCallback } from 'react';
import { companyPolicies as cpApi, downloadAttachmentWithAuth } from '../api';
import InfoHint from './InfoHint.jsx';
import SignaturePad from './SignaturePad.jsx';

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function CompanyPoliciesProfileTab({ user, onError }) {
  const [policies, setPolicies] = useState([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [signerName, setSignerName] = useState(user?.full_name || '');
  const [signature, setSignature] = useState('');
  const [ackBusy, setAckBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await cpApi.employee.list();
      setPolicies(r.policies || []);
      setPending(r.pending_acknowledgements ?? 0);
    } catch (e) {
      onError?.(e?.message || 'Failed to load policies');
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const openPolicy = async (p) => {
    setSelected(p);
    setDetail(null);
    setSignature('');
    setSignerName(user?.full_name || '');
    try {
      const r = await cpApi.employee.get(p.id);
      setDetail(r.policy);
    } catch (e) {
      onError?.(e?.message || 'Failed to load policy');
    }
  };

  const viewPdf = () => {
    if (!selected?.id) return;
    downloadAttachmentWithAuth(
      cpApi.employee.pdfUrl(selected.id),
      `${selected.reference_number || 'policy'}.pdf`
    ).catch((e) => onError?.(e?.message || 'PDF failed'));
  };

  const submitAck = async () => {
    if (!detail?.id) return;
    if (!signature) {
      onError?.('Please sign in the box below');
      return;
    }
    setAckBusy(true);
    try {
      await cpApi.employee.acknowledge(detail.id, {
        signature_data: signature,
        signer_name: signerName,
      });
      await load();
      const r = await cpApi.employee.get(detail.id);
      setDetail(r.policy);
      onError?.('');
    } catch (e) {
      onError?.(e?.message || 'Acknowledgement failed');
    } finally {
      setAckBusy(false);
    }
  };

  const pdfPreviewUrl = selected?.id ? cpApi.employee.pdfUrl(selected.id) : null;

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">Company policies</h1>
        <InfoHint
          title="Policy acknowledgement"
          text="Read published company policies and download the official PDF. Policies marked New require your electronic signature to confirm you have read and understood them."
        />
        {pending > 0 && (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {pending} awaiting signature
          </span>
        )}
      </div>

      {loading && <p className="text-sm text-surface-500">Loading policies…</p>}

      {!loading && !policies.length && (
        <p className="text-sm text-surface-500">No published policies yet.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <ul className="app-glass-card divide-y dark:divide-surface-800 max-h-[32rem] overflow-y-auto">
          {policies.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => openPolicy(p)}
                className={`w-full text-left px-4 py-3 hover:bg-surface-50 dark:hover:bg-surface-900/40 ${
                  selected?.id === p.id ? 'bg-brand-50/80 dark:bg-brand-950/30' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-sm text-surface-900 dark:text-surface-100">{p.title}</span>
                  {p.is_new && !p.acknowledged && (
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-white bg-rose-600 px-1.5 py-0.5 rounded">
                      New
                    </span>
                  )}
                </div>
                <p className="text-xs text-surface-500 mt-1 font-mono">{p.reference_number}</p>
                <p className="text-xs text-surface-600 mt-0.5">{p.act_or_section}</p>
                <p className="text-xs mt-1">
                  {p.acknowledged ? (
                    <span className="text-emerald-600 font-medium">Signed · {fmtDate(p.acknowledged_at)}</span>
                  ) : p.requires_acknowledgement ? (
                    <span className="text-amber-700 font-medium">Signature required</span>
                  ) : (
                    <span className="text-surface-500">Read only</span>
                  )}
                </p>
              </button>
            </li>
          ))}
        </ul>

        <div className="app-glass-card p-4 min-h-[20rem] flex flex-col">
          {!selected ? (
            <p className="text-sm text-surface-500 m-auto">Select a policy to read the PDF and sign if required.</p>
          ) : (
            <>
              <div className="flex flex-wrap justify-between gap-2 mb-3">
                <div>
                  <h2 className="font-semibold text-surface-900 dark:text-surface-50">{detail?.title || selected.title}</h2>
                  <p className="text-xs text-surface-500 font-mono mt-0.5">
                    {detail?.reference_number} · {detail?.act_or_section} · v{detail?.version ?? selected.version}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={viewPdf}
                  className="text-sm px-3 py-1.5 rounded-lg border border-surface-300 hover:bg-surface-50 dark:border-surface-600 font-medium"
                >
                  Download PDF
                </button>
              </div>

              {pdfPreviewUrl && (
                <iframe
                  title="Policy PDF"
                  src={pdfPreviewUrl}
                  className="w-full flex-1 min-h-[280px] rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-100"
                />
              )}

              {detail?.acknowledged ? (
                <div className="mt-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
                  You acknowledged this policy on {fmtDate(detail.acknowledged_at)}
                  {detail.signer_name ? ` as ${detail.signer_name}` : ''}.
                </div>
              ) : detail?.requires_acknowledgement ? (
                <div className="mt-4 space-y-3 border-t border-surface-200 dark:border-surface-700 pt-4">
                  <p className="text-sm font-medium text-surface-800 dark:text-surface-200">
                    Electronic acknowledgement
                  </p>
                  <p className="text-xs text-surface-600 dark:text-surface-400">
                    By signing below you confirm that you have read and understood this policy and agree to comply with it.
                  </p>
                  <label className="block text-sm">
                    <span className="text-xs font-medium text-surface-500">Full name</span>
                    <input
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900 dark:border-surface-600"
                    />
                  </label>
                  <SignaturePad onChange={setSignature} className="max-w-md" />
                  <button
                    type="button"
                    disabled={ackBusy}
                    onClick={submitAck}
                    className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
                  >
                    {ackBusy ? 'Submitting…' : 'Sign and accept policy'}
                  </button>
                </div>
              ) : (
                <p className="mt-4 text-sm text-surface-500">This policy is for information only — no signature required.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
