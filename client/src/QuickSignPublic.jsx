import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { quickSignPublic } from './api';
import SignaturePad from './components/SignaturePad.jsx';
import AppAttributionFooter from './components/AppAttributionFooter.jsx';

const footerClass =
  'text-surface-500 dark:text-surface-400 border-t border-surface-200 dark:border-surface-800 bg-surface-100 dark:bg-surface-950';

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function QuickSignPublic() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState(null);
  const [step, setStep] = useState('otp');
  const [otp, setOtp] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [sessionToken, setSessionToken] = useState('');
  const [documentUrl, setDocumentUrl] = useState('');
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState('');
  const [locationLoading, setLocationLoading] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Invalid signing link');
      setLoading(false);
      return;
    }
    quickSignPublic
      .getMeta(token)
      .then((data) => {
        setMeta(data);
        if (data.alreadySigned) setStep('done');
      })
      .catch((e) => setError(e?.message || 'Invalid or expired link'))
      .finally(() => setLoading(false));
  }, [token]);

  const requestLocation = () => {
    setLocationError('');
    setLocationLoading(true);
    if (!navigator.geolocation) {
      setLocationError('Location is not supported on this device. Signing requires location.');
      setLocationLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setLocationLoading(false);
      },
      (err) => {
        setLocationError(err?.message || 'Please enable location access to sign this document.');
        setLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  const handleVerifyOtp = (e) => {
    e.preventDefault();
    setError('');
    setVerifying(true);
    quickSignPublic
      .verifyOtp(token, otp.trim())
      .then((data) => {
        setSessionToken(data.sessionToken);
        setDocumentUrl(quickSignPublic.documentUrl(token, data.sessionToken));
        setStep('sign');
        requestLocation();
      })
      .catch((e) => setError(e?.message || 'Verification failed'))
      .finally(() => setVerifying(false));
  };

  const handleSubmitSignature = (e) => {
    e.preventDefault();
    if (!signatureDataUrl) {
      setError('Draw your signature before continuing.');
      return;
    }
    if (!location) {
      setError('Location must be enabled before signing.');
      requestLocation();
      return;
    }
    setError('');
    setStep('id');
  };

  const handleComplete = (e) => {
    e.preventDefault();
    const id = idNumber.trim().replace(/\s/g, '');
    if (id.length < 6) {
      setError('Enter a valid ID number (at least 6 characters).');
      return;
    }
    setSubmitting(true);
    setError('');
    quickSignPublic
      .complete(token, {
        sessionToken,
        signatureDataUrl,
        id_number: id,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
      })
      .then(() => {
        setDone(true);
        setStep('done');
      })
      .catch((e) => setError(e?.message || 'Signing failed'))
      .finally(() => setSubmitting(false));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-surface-100 dark:bg-surface-950">
        <div className="flex-1 flex items-center justify-center text-surface-500">Loading…</div>
        <AppAttributionFooter className={footerClass} />
      </div>
    );
  }

  if (error && !meta && step === 'otp') {
    return (
      <div className="min-h-screen flex flex-col bg-surface-100 dark:bg-surface-950">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-xl border border-red-200 bg-white dark:bg-surface-900 p-6 text-center">
            <p className="text-red-700 dark:text-red-300">{error}</p>
          </div>
        </div>
        <AppAttributionFooter className={footerClass} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface-100 dark:bg-surface-950">
      <header className="border-b border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-100">Quick Sign</h1>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
            {meta?.title || 'Document signing'}
          </p>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-3xl mx-auto space-y-6">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-200">
              {error}
            </div>
          ) : null}

          {step === 'otp' && !meta?.alreadySigned ? (
            <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">Enter one-time PIN</h2>
              <p className="text-sm text-surface-600 dark:text-surface-400 mt-2">
                Hello{meta?.recipientName ? ` ${meta.recipientName}` : ''}, check your email for the 6-digit PIN, then enter it below to open the document.
              </p>
              <form onSubmit={handleVerifyOtp} className="mt-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">One-time PIN</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    className="w-full max-w-xs px-4 py-3 text-center text-2xl tracking-[0.3em] font-mono rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900"
                    placeholder="000000"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={verifying || otp.length < 4}
                  className="px-6 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {verifying ? 'Verifying…' : 'Continue'}
                </button>
              </form>
            </div>
          ) : null}

          {step === 'sign' ? (
            <>
              <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800">
                  <h2 className="font-medium text-surface-900 dark:text-surface-100">Document preview</h2>
                </div>
                <div className="min-h-[320px] bg-surface-100 dark:bg-surface-950">
                  {documentUrl ? (
                    <iframe title="Document" src={documentUrl} className="w-full h-[min(70vh,520px)] border-0" />
                  ) : (
                    <p className="p-8 text-surface-500 text-center">Loading document…</p>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">Location required</h2>
                <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                  Signing requires your device location to be recorded with the signature.
                </p>
                {location ? (
                  <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
                    Location captured ({location.latitude.toFixed(5)}, {location.longitude.toFixed(5)})
                    {location.accuracy != null ? ` · ±${Math.round(location.accuracy)}m` : ''}
                  </p>
                ) : (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={requestLocation}
                      disabled={locationLoading}
                      className="px-4 py-2 rounded-lg bg-surface-800 text-white text-sm font-medium hover:bg-surface-900 disabled:opacity-50"
                    >
                      {locationLoading ? 'Getting location…' : 'Enable location'}
                    </button>
                    {locationError ? <p className="mt-2 text-sm text-red-600">{locationError}</p> : null}
                  </div>
                )}
              </div>

              <form onSubmit={handleSubmitSignature} className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">Draw your signature</h2>
                <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">Sign with your finger or mouse in the box below.</p>
                <div className="mt-4">
                  <SignaturePad onChange={setSignatureDataUrl} className="max-w-xl" />
                </div>
                <button
                  type="submit"
                  disabled={!location || !signatureDataUrl}
                  className="mt-6 px-6 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  Submit signature
                </button>
              </form>
            </>
          ) : null}

          {step === 'id' ? (
            <form onSubmit={handleComplete} className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">Confirm ID number</h2>
              <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                Enter your ID number to complete signing. This is stored securely with your signature record.
              </p>
              <div className="mt-4">
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1">ID number</label>
                <input
                  type="text"
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value)}
                  className="w-full max-w-md px-3 py-2 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900"
                  placeholder="e.g. 8001015009087"
                  required
                  autoFocus
                />
              </div>
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep('sign')}
                  className="px-4 py-2 rounded-lg border border-surface-300 text-surface-700 dark:text-surface-300"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
                >
                  {submitting ? 'Completing…' : 'Complete signing'}
                </button>
              </div>
            </form>
          ) : null}

          {(step === 'done' || done || meta?.alreadySigned) ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 p-8 text-center">
              <h2 className="text-xl font-semibold text-emerald-900 dark:text-emerald-100">Signing complete</h2>
              <p className="text-sm text-emerald-800 dark:text-emerald-200 mt-2">
                Thank you. The sender can review the signed document in their Quick Sign history.
              </p>
            </div>
          ) : null}
        </div>
      </main>

      <AppAttributionFooter className={footerClass} />
    </div>
  );
}
