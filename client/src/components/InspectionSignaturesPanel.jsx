import { useState } from 'react';
import SignaturePad from './SignaturePad.jsx';

const ROLES = [
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'maintenance_officer', label: 'Maintenance officer' },
];

function SignatureDisplay({ url, label, name, signedAt, formatDateTime }) {
  if (!url) return null;
  return (
    <div className="rounded-xl border border-surface-200 bg-white p-4 space-y-2">
      <p className="text-xs font-bold uppercase text-surface-500">{label}</p>
      <p className="text-sm font-medium text-surface-900">{name || '—'}</p>
      <img src={url} alt={`${label} signature`} className="max-h-24 border border-surface-200 rounded-lg bg-white" />
      {signedAt && <p className="text-xs text-surface-500">Signed {formatDateTime(signedAt)}</p>}
    </div>
  );
}

/** Inspector + supervisor signature display and supervisor signing form. */
export default function InspectionSignaturesPanel({
  inspection,
  inspectionId,
  signatureImageUrl,
  onSupervisorSigned,
  signSupervisorApi,
  formatDateTime,
}) {
  const [supervisorName, setSupervisorName] = useState('');
  const [supervisorRole, setSupervisorRole] = useState('supervisor');
  const [supervisorSig, setSupervisorSig] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const insp = inspection;
  const hasInspectorSig = !!insp?.inspector_signature_path || !!insp?.inspector_signed_at;
  const hasSupervisorSig = !!insp?.supervisor_signature_path || !!insp?.supervisor_signed_at;

  const handleSupervisorSign = async () => {
    if (!supervisorSig) { setError('Draw your signature on the pad.'); return; }
    if (!supervisorName.trim()) { setError('Enter your full name.'); return; }
    setError('');
    setSaving(true);
    try {
      await signSupervisorApi(inspectionId, {
        signature_data: supervisorSig,
        supervisor_name: supervisorName.trim(),
        supervisor_role: supervisorRole,
      });
      onSupervisorSigned?.();
      setSupervisorSig('');
    } catch (e) {
      setError(e?.message || 'Could not save signature.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-surface-200 bg-surface-50/80 p-5 shadow-sm space-y-4">
      <h3 className="text-sm font-semibold text-surface-900">Signatures & authorisation</h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <SignatureDisplay
          url={hasInspectorSig ? signatureImageUrl(inspectionId, 'inspector') : null}
          label="Inspector signature"
          name={insp?.inspector_name}
          signedAt={insp?.inspector_signed_at}
          formatDateTime={formatDateTime}
        />
        <SignatureDisplay
          url={hasSupervisorSig ? signatureImageUrl(inspectionId, 'supervisor') : null}
          label={insp?.supervisor_role === 'maintenance_officer' ? 'Maintenance officer signature' : 'Supervisor signature'}
          name={insp?.supervisor_name}
          signedAt={insp?.supervisor_signed_at}
          formatDateTime={formatDateTime}
        />
      </div>

      {!hasSupervisorSig && (
        <div className="rounded-xl border border-brand-200 bg-white p-4 space-y-3">
          <p className="text-sm font-medium text-surface-800">Supervisor / maintenance officer review sign-off</p>
          <p className="text-xs text-surface-500">Review the inspection checklist and sign below to confirm review.</p>
          {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Your full name *</label>
              <input
                value={supervisorName}
                onChange={(e) => setSupervisorName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-surface-300 text-sm"
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1">Role *</label>
              <select value={supervisorRole} onChange={(e) => setSupervisorRole(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-surface-300 text-sm">
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1">Draw signature *</label>
            <SignaturePad onChange={setSupervisorSig} className="max-w-md" />
          </div>
          <button
            type="button"
            onClick={handleSupervisorSign}
            disabled={saving}
            className="px-4 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Sign as supervisor / maintenance officer'}
          </button>
        </div>
      )}
    </div>
  );
}
