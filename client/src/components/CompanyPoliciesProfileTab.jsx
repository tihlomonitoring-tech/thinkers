import { useState, useEffect, useCallback } from 'react';
import { companyPolicies as cpApi, downloadAttachmentWithAuth } from '../api';
import InfoHint from './InfoHint.jsx';
import PdfInlineViewer from './PdfInlineViewer.jsx';
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
  const [fullscreen, setFullscreen] = useState(false);

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

  const pdfUrl = selected?.id ? cpApi.employee.pdfUrl(selected.id) : null;

  const downloadPdf = () => {
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

  const policyMeta = detail || selected;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">Company policies</h1>
          <InfoHint
            title="Policy acknowledgement"
            text="Read the full policy document below. Policies marked New require your electronic signature to confirm you have read and understood them."
          />
          {pending > 0 && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {pending} awaiting signature
            </span>
          )}
        </div>
      </div>

      {loading && <p className="text-sm text-surface-500">Loading policies…</p>}

      {!loading && !policies.length && (
        <p className="text-sm text-surface-500">No published policies yet.</p>
      )}

      {!loading && policies.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] min-h-[calc(100vh-12rem)]">
          <aside className="app-glass-card overflow-hidden flex flex-col">
            <p className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-surface-500 border-b border-surface-200">
              Published policies ({policies.length})
            </p>
            <ul className="flex-1 overflow-y-auto divide-y divide-surface-100 dark:divide-surface-800">
              {policies.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => openPolicy(p)}
                    className={`w-full text-left px-4 py-3 hover:bg-surface-50 dark:hover:bg-surface-900/40 transition-colors ${
                      selected?.id === p.id ? 'bg-brand-50/80 dark:bg-brand-950/30 border-l-4 border-brand-500' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-sm text-surface-900 dark:text-surface-100 leading-snug">{p.title}</span>
                      {p.is_new && !p.acknowledged && (
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-white bg-rose-600 px-1.5 py-0.5 rounded">
                          New
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-surface-500 mt-1 font-mono">{p.reference_number}</p>
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
          </aside>

          <div className="flex flex-col gap-4 min-h-0">
            {!selected ? (
              <div className="app-glass-card flex-1 flex items-center justify-center p-8 text-center">
                <p className="text-sm text-surface-500">Select a policy to read the full document.</p>
              </div>
            ) : (
              <>
                <div className="app-glass-card p-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-lg text-surface-900 dark:text-surface-50">{policyMeta?.title}</h2>
                    <p className="text-xs text-surface-500 font-mono mt-0.5">
                      {policyMeta?.reference_number} · {policyMeta?.act_or_section} · v{policyMeta?.version ?? selected.version}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setFullscreen(true)}
                      className="text-sm px-3 py-1.5 rounded-lg border border-surface-300 hover:bg-surface-50 dark:border-surface-600 font-medium"
                    >
                      Full screen
                    </button>
                    <button
                      type="button"
                      onClick={downloadPdf}
                      className="text-sm px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-medium"
                    >
                      Download PDF
                    </button>
                  </div>
                </div>

                {pdfUrl && (
                  <PdfInlineViewer url={pdfUrl} minHeight="calc(100vh - 20rem)" onError={onError} />
                )}

                {detail?.acknowledged ? (
                  <div className="app-glass-card rounded-lg bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
                    You acknowledged this policy on {fmtDate(detail.acknowledged_at)}
                    {detail.signer_name ? ` as ${detail.signer_name}` : ''}.
                  </div>
                ) : detail?.requires_acknowledgement ? (
                  <div className="app-glass-card p-4 space-y-3">
                    <p className="text-sm font-medium text-surface-800 dark:text-surface-200">Electronic acknowledgement</p>
                    <p className="text-xs text-surface-600 dark:text-surface-400">
                      By signing below you confirm that you have read and understood this policy and agree to comply with it.
                    </p>
                    <label className="block text-sm">
                      <span className="text-xs font-medium text-surface-500">Full name</span>
                      <input
                        value={signerName}
                        onChange={(e) => setSignerName(e.target.value)}
                        className="mt-1 w-full max-w-md rounded-lg border border-surface-300 px-3 py-2 text-sm dark:bg-surface-900 dark:border-surface-600"
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
                ) : detail ? (
                  <p className="text-sm text-surface-500 px-1">This policy is for information only — no signature required.</p>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}

      {fullscreen && pdfUrl && (
        <div className="fixed inset-0 z-50 flex flex-col bg-surface-900/95 p-3 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-white font-semibold truncate">{policyMeta?.title}</h2>
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              className="shrink-0 px-4 py-2 rounded-lg bg-white/10 text-white text-sm font-medium hover:bg-white/20"
            >
              Close
            </button>
          </div>
          <div className="flex-1 min-h-0 rounded-xl overflow-hidden bg-surface-100">
            <PdfInlineViewer url={pdfUrl} minHeight="100%" className="h-full border-0" onError={onError} />
          </div>
        </div>
      )}
    </div>
  );
}
