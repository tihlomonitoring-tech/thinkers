import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getApiBase } from './lib/apiBase.js';
import AppAttributionFooter from './components/AppAttributionFooter.jsx';

const API_BASE = getApiBase();

const INCIDENT_TYPES = ['Breakdown', 'Accident', 'Load spill', 'Delay', 'Other incident'];
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];

function CameraIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 13v7a2 2 0 01-2 2H7a2 2 0 01-2-2v-7" />
    </svg>
  );
}

export default function ReportBreakdown() {
  const [step, setStep] = useState('id'); // 'id' | 'form'
  const [idNumber, setIdNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [loadingSlipFile, setLoadingSlipFile] = useState(null);
  const [seal1File, setSeal1File] = useState(null);
  const [seal2File, setSeal2File] = useState(null);
  const [pictureProblemFile, setPictureProblemFile] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [trucks, setTrucks] = useState([]);
  const [trucksLoading, setTrucksLoading] = useState(false);
  const [selectedTruck, setSelectedTruck] = useState(null);
  const [truckSearch, setTruckSearch] = useState('');
  const [truckDropdownOpen, setTruckDropdownOpen] = useState(false);
  const truckDropdownRef = useRef(null);
  const loadingSlipChooseRef = useRef(null);
  const seal1ChooseRef = useRef(null);
  const seal2ChooseRef = useRef(null);
  const pictureChooseRef = useRef(null);
  const [cameraFor, setCameraFor] = useState(null); // 'loadingSlip' | 'seal1' | 'seal2' | 'picture' | null
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!cameraFor) return;
    setCameraError('');
    const video = videoRef.current;
    if (!video) return;
    const opts = { video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false };
    navigator.mediaDevices.getUserMedia(opts).then((stream) => {
      streamRef.current = stream;
      video.srcObject = stream;
      video.play().catch(() => {});
    }).catch((err) => {
      setCameraError(err?.message || 'Could not open camera. Allow camera access and try again.');
      setCameraFor(null);
    });
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (video && video.srcObject) video.srcObject = null;
    };
  }, [cameraFor]);

  const openCamera = (field) => {
    setCameraFor(field);
  };

  const closeCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video && video.srcObject) video.srcObject = null;
    setCameraFor(null);
    setCameraError('');
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `photo-${cameraFor}-${Date.now()}.jpg`, { type: 'image/jpeg' });
      if (cameraFor === 'loadingSlip') setLoadingSlipFile(file);
      else if (cameraFor === 'seal1') setSeal1File(file);
      else if (cameraFor === 'seal2') setSeal2File(file);
      else if (cameraFor === 'picture') setPictureProblemFile(file);
      closeCamera();
    }, 'image/jpeg', 0.9);
  };

  useEffect(() => {
    if (step !== 'form') return;
    setRoutesLoading(true);
    setTrucksLoading(true);
    fetch(`${API_BASE}/report-breakdown/routes`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => setRoutes(data.routes || []))
      .catch(() => setRoutes([]))
      .finally(() => setRoutesLoading(false));
    fetch(`${API_BASE}/report-breakdown/trucks`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => setTrucks(data.trucks || []))
      .catch(() => setTrucks([]))
      .finally(() => setTrucksLoading(false));
  }, [step]);

  const filteredTrucks = trucks.filter((t) => {
    const q = truckSearch.trim().toLowerCase();
    if (!q) return true;
    const reg = (t.registration || '').toLowerCase();
    const fleet = (t.fleet_no || '').toLowerCase();
    const make = (t.make_model || '').toLowerCase();
    return reg.includes(q) || fleet.includes(q) || make.includes(q);
  });

  useEffect(() => {
    if (step !== 'form' || !truckDropdownOpen) return;
    const onMouseDown = (e) => {
      if (truckDropdownRef.current && !truckDropdownRef.current.contains(e.target)) setTruckDropdownOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [step, truckDropdownOpen]);

  const handleVerifyId = async (e) => {
    e.preventDefault();
    const trimmed = idNumber.trim();
    if (!trimmed) {
      setError('Please enter your ID number.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/report-breakdown/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id_number: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not verify ID number. Please try again.');
        return;
      }
      setDriverName(data.driverName || 'Driver');
      setStep('form');
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitBreakdown = async (e) => {
    e.preventDefault();
    const form = e.target;
    if (!loadingSlipFile || !seal1File || !seal2File || !pictureProblemFile) {
      setError('All four attachments are required: Loading slip, Seal 1, Seal 2, and Picture of the problem.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const typeValue = (form.type?.value || 'breakdown').toLowerCase().replace(/ /g, '_');
      const payload = {
        truck_id: selectedTruck?.id || null,
        type: typeValue,
        title: (form.title?.value || '').trim() || (typeValue === 'breakdown' ? 'Breakdown' : 'Breakdown / Incident'),
        description: (form.description?.value || '').trim() || null,
        severity: (form.severity?.value || '').trim() || null,
        actions_taken: (form.actions_taken?.value || '').trim() || null,
        reported_date: form.reported_date?.value || null,
        reported_time: form.reported_time?.value || '00:00',
        location: (form.location?.value || '').trim() || null,
        route_id: (form.route_id?.value || '').trim() || null,
      };
      const fd = new FormData();
      fd.append('payload', JSON.stringify(payload));
      fd.append('loading_slip', loadingSlipFile);
      fd.append('seal_1', seal1File);
      fd.append('seal_2', seal2File);
      fd.append('picture_problem', pictureProblemFile);

      const res = await fetch(`${API_BASE}/report-breakdown/submit`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Failed to submit. Please try again.');
        return;
      }
      setSuccess(true);
      form.reset();
      setSelectedTruck(null);
      setTruckSearch('');
      setLoadingSlipFile(null);
      setSeal1File(null);
      setSeal2File(null);
      setPictureProblemFile(null);
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const startOver = () => {
    setStep('id');
    setDriverName('');
    setIdNumber('');
    setSuccess(false);
    setError('');
  };

  return (
    <div className="min-h-screen bg-surface-100 flex flex-col">
      <div className="flex-1 max-w-md w-full mx-auto px-4 py-6 sm:py-8">
        <div className="mb-4">
          <Link
            to="/login"
            className="inline-flex items-center gap-2 text-sm font-medium text-surface-600 hover:text-surface-900"
          >
            <span aria-hidden>←</span>
            Back to login
          </Link>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-surface-200 overflow-hidden">
          <div className="bg-brand-600 text-white px-5 py-6 text-center">
            <h1 className="text-xl font-bold tracking-tight">Report breakdown</h1>
            <p className="text-brand-100 text-sm mt-1">For drivers without system access</p>
          </div>

          <div className="p-5 sm:p-6">
            {success ? (
              <div className="text-center py-4">
                <p className="text-green-700 font-medium">Breakdown reported successfully.</p>
                <p className="text-surface-600 text-sm mt-2">Thank you. You may close this page or report another.</p>
                <button
                  type="button"
                  onClick={startOver}
                  className="mt-6 w-full py-3 px-4 rounded-xl text-sm font-medium bg-surface-200 text-surface-800 hover:bg-surface-300"
                >
                  Report another breakdown
                </button>
              </div>
            ) : step === 'id' ? (
              <form onSubmit={handleVerifyId} className="space-y-5">
                <p className="text-surface-600 text-sm">Enter your ID number to continue. You must be registered as a driver in the system.</p>
                {error && (
                  <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3">
                    {error}
                  </div>
                )}
                <div>
                  <label htmlFor="id_number" className="block text-sm font-medium text-surface-700 mb-2">ID number</label>
                  <input
                    id="id_number"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="e.g. 8001015009087"
                    value={idNumber}
                    onChange={(e) => { setIdNumber(e.target.value); setError(''); }}
                    className="w-full rounded-xl border border-surface-300 px-4 py-3 text-base focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                    disabled={loading}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 px-4 rounded-xl text-base font-semibold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <span className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden />
                      Checking…
                    </>
                  ) : (
                    'Continue'
                  )}
                </button>
              </form>
            ) : (
              <>
                <div className="flex items-center justify-between mb-5 pb-3 border-b border-surface-200">
                  <p className="text-sm text-surface-600">Reporting as</p>
                  <p className="font-medium text-surface-900">{driverName}</p>
                  <button type="button" onClick={startOver} className="text-sm text-brand-600 hover:text-brand-700">Use different ID</button>
                </div>

                <form onSubmit={handleSubmitBreakdown} className="space-y-4">
                  {error && (
                    <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3">
                      {error}
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Type</label>
                    <select name="type" required className="w-full rounded-xl border border-surface-300 px-4 py-3 text-base">
                      <option value="">Select type</option>
                      {INCIDENT_TYPES.map((t) => (
                        <option key={t} value={t.toLowerCase().replace(/ /g, '_')}>{t}</option>
                      ))}
                    </select>
                  </div>

                  <div className="relative" ref={truckDropdownRef}>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Truck</label>
                    <input
                      type="text"
                      placeholder="Search and select truck..."
                      value={truckSearch}
                      onChange={(e) => { setTruckSearch(e.target.value); setTruckDropdownOpen(true); }}
                      onFocus={() => setTruckDropdownOpen(true)}
                      className="w-full rounded-xl border border-surface-300 px-4 py-3 text-base"
                    />
                    {selectedTruck && (
                      <p className="text-xs text-surface-500 mt-1.5">
                        Selected: {selectedTruck.registration}
                        {selectedTruck.fleet_no ? ` · Fleet ${selectedTruck.fleet_no}` : ''}
                        {selectedTruck.make_model ? ` · ${selectedTruck.make_model}` : ''}
                      </p>
                    )}
                    {truckDropdownOpen && (
                      <ul className="absolute z-20 mt-1 w-full max-h-48 overflow-auto rounded-xl border border-surface-200 bg-white shadow-lg py-1 text-base">
                        {trucksLoading ? (
                          <li className="px-4 py-3 text-surface-500">Loading trucks…</li>
                        ) : filteredTrucks.length === 0 ? (
                          <li className="px-4 py-3 text-surface-500">No trucks match</li>
                        ) : (
                          filteredTrucks.map((t) => (
                            <li
                              key={t.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setSelectedTruck(t);
                                setTruckSearch(t.registration);
                                setTruckDropdownOpen(false);
                              }}
                              onKeyDown={(ev) => ev.key === 'Enter' && (setSelectedTruck(t), setTruckSearch(t.registration), setTruckDropdownOpen(false))}
                              className="px-4 py-3 hover:bg-surface-100 cursor-pointer border-b border-surface-100 last:border-0"
                            >
                              {t.registration}
                              {t.fleet_no ? ` · Fleet ${t.fleet_no}` : ''}
                              {t.make_model ? ` · ${t.make_model}` : ''}
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-surface-700 mb-1.5">Date</label>
                      <input name="reported_date" type="date" required className="w-full rounded-xl border border-surface-300 px-4 py-3 text-base" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-surface-700 mb-1.5">Time</label>
                      <input name="reported_time" type="time" className="w-full rounded-xl border border-surface-300 px-4 py-3 text-base" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Location (optional)</label>
                    <div className="flex gap-2">
                      <input
                        name="location"
                        type="text"
                        placeholder="Address or coordinates"
                        className="flex-1 rounded-xl border border-surface-300 px-4 py-3 text-base"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!navigator.geolocation) {
                            setError('GPS not supported');
                            return;
                          }
                          navigator.geolocation.getCurrentPosition(
                            (pos) => {
                              const input = document.querySelector('input[name="location"]');
                              if (input) input.value = `${pos.coords.latitude}, ${pos.coords.longitude}`;
                              setError('');
                            },
                            () => setError('Could not get location')
                          );
                        }}
                        className="shrink-0 py-3 px-4 rounded-xl border border-surface-300 bg-surface-50 text-surface-700 text-sm font-medium"
                      >
                        GPS
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Route (optional)</label>
                    {routesLoading ? (
                      <p className="text-sm text-surface-500 py-2">Loading routes…</p>
                    ) : (
                      <select name="route_id" className="w-full rounded-xl border border-surface-300 px-4 py-3 text-base">
                        <option value="">Select route</option>
                        {routes.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Title (optional)</label>
                    <input name="title" type="text" placeholder="e.g. Axle failure on N4" className="w-full rounded-xl border border-surface-300 px-4 py-3 text-base" />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Description</label>
                    <textarea name="description" placeholder="Describe the breakdown or incident" rows={3} className="w-full rounded-xl border border-surface-300 px-4 py-3 text-base" />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Actions taken</label>
                    <textarea name="actions_taken" placeholder="What actions were taken?" rows={2} className="w-full rounded-xl border border-surface-300 px-4 py-3 text-base" />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Severity (optional)</label>
                    <select name="severity" className="w-full rounded-xl border border-surface-300 px-4 py-3 text-base">
                      <option value="">Select severity</option>
                      {SEVERITIES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-xl border border-surface-200 bg-surface-50 p-4 space-y-4">
                    <p className="text-sm font-medium text-surface-700">Attachments (all required)</p>
                    <p className="text-xs text-surface-500">Choose a file from your device or take a photo with your camera.</p>

                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-2">Loading slip</label>
                      <input ref={loadingSlipChooseRef} type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setLoadingSlipFile(e.target.files?.[0] ?? null)} />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => loadingSlipChooseRef.current?.click()} className="py-2.5 px-4 rounded-xl text-sm font-medium border border-surface-300 bg-white text-surface-700 hover:bg-surface-50">Choose file</button>
                        <button type="button" onClick={() => openCamera('loadingSlip')} className="py-2.5 px-4 rounded-xl text-sm font-medium border border-surface-300 bg-white text-surface-700 hover:bg-surface-50 flex items-center gap-1.5"><CameraIcon className="w-4 h-4" /> Take photo</button>
                      </div>
                      {loadingSlipFile && <p className="text-xs text-surface-500 mt-1.5">Selected: {loadingSlipFile.name}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-2">Seal 1</label>
                      <input ref={seal1ChooseRef} type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setSeal1File(e.target.files?.[0] ?? null)} />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => seal1ChooseRef.current?.click()} className="py-2.5 px-4 rounded-xl text-sm font-medium border border-surface-300 bg-white text-surface-700 hover:bg-surface-50">Choose file</button>
                        <button type="button" onClick={() => openCamera('seal1')} className="py-2.5 px-4 rounded-xl text-sm font-medium border border-surface-300 bg-white text-surface-700 hover:bg-surface-50 flex items-center gap-1.5"><CameraIcon className="w-4 h-4" /> Take photo</button>
                      </div>
                      {seal1File && <p className="text-xs text-surface-500 mt-1.5">Selected: {seal1File.name}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-2">Seal 2</label>
                      <input ref={seal2ChooseRef} type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setSeal2File(e.target.files?.[0] ?? null)} />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => seal2ChooseRef.current?.click()} className="py-2.5 px-4 rounded-xl text-sm font-medium border border-surface-300 bg-white text-surface-700 hover:bg-surface-50">Choose file</button>
                        <button type="button" onClick={() => openCamera('seal2')} className="py-2.5 px-4 rounded-xl text-sm font-medium border border-surface-300 bg-white text-surface-700 hover:bg-surface-50 flex items-center gap-1.5"><CameraIcon className="w-4 h-4" /> Take photo</button>
                      </div>
                      {seal2File && <p className="text-xs text-surface-500 mt-1.5">Selected: {seal2File.name}</p>}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-surface-600 mb-2">Picture of the problem</label>
                      <input ref={pictureChooseRef} type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setPictureProblemFile(e.target.files?.[0] ?? null)} />
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => pictureChooseRef.current?.click()} className="py-2.5 px-4 rounded-xl text-sm font-medium border border-surface-300 bg-white text-surface-700 hover:bg-surface-50">Choose file</button>
                        <button type="button" onClick={() => openCamera('picture')} className="py-2.5 px-4 rounded-xl text-sm font-medium border border-surface-300 bg-white text-surface-700 hover:bg-surface-50 flex items-center gap-1.5"><CameraIcon className="w-4 h-4" /> Take photo</button>
                      </div>
                      {pictureProblemFile && <p className="text-xs text-surface-500 mt-1.5">Selected: {pictureProblemFile.name}</p>}
                    </div>
                  </div>

                  {/* Camera modal – opens device camera */}
                  {cameraFor && (
                    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="Take photo">
                      <div className="flex-1 flex flex-col min-h-0">
                        {cameraError ? (
                          <div className="flex-1 flex items-center justify-center p-6">
                            <div className="text-center text-white">
                              <p className="font-medium">{cameraError}</p>
                              <button type="button" onClick={closeCamera} className="mt-4 py-2.5 px-4 rounded-xl bg-white/20 text-white font-medium">Close</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex-1 relative flex items-center justify-center min-h-0">
                              <video ref={videoRef} playsInline muted className="w-full h-full object-contain" />
                              <canvas ref={canvasRef} className="hidden" />
                            </div>
                            <div className="p-4 flex gap-3 bg-black/80">
                              <button type="button" onClick={closeCamera} className="flex-1 py-3.5 rounded-xl font-medium bg-white/20 text-white">Cancel</button>
                              <button type="button" onClick={capturePhoto} className="flex-1 py-3.5 rounded-xl font-semibold bg-brand-600 text-white">Capture photo</button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3.5 px-4 rounded-xl text-base font-semibold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <span className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden />
                        Submitting…
                      </>
                    ) : (
                      'Submit breakdown report'
                    )}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>

        <p className="text-center text-surface-500 dark:text-surface-400 text-xs mt-6">This page is for drivers who do not have login access. Your report is recorded in the same system as the main portal.</p>
      </div>
      <AppAttributionFooter className="mt-auto text-surface-500 dark:text-surface-400 border-t border-surface-200 dark:border-surface-800 bg-surface-100 dark:bg-surface-950 py-3" />
    </div>
  );
}
