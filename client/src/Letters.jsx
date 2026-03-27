import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { useSecondaryNavHidden } from './lib/useSecondaryNavHidden.js';
import { jsPDF } from 'jspdf';

const STORAGE_KEY = 'thinkers-letters-settings';
const STORAGE_KEY_LETTERS = 'thinkers-letters-drafts';
const STORAGE_KEY_WORKING = 'thinkers-letters-working-draft';
const DEFAULT_LOGO_URL = '/logos/tihlo-logo.png';

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

function loadSavedLetters() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LETTERS);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
}

function saveSavedLetters(list) {
  try {
    localStorage.setItem(STORAGE_KEY_LETTERS, JSON.stringify(list));
  } catch (_) {}
}

const LETTER_TYPES = [
  { id: 'suspension', label: 'Suspension letter', subjectDefault: 'Notice of suspension', bodyDefault: 'We are writing to inform you that you are suspended from [duties/position] with effect from [date].\n\nReason: [state reason].\n\nThis letter serves as formal notice. You may contact HR to discuss next steps.\n\nYours sincerely,' },
  { id: 'warning', label: 'Warning letter', subjectDefault: 'Formal warning', bodyDefault: 'We are writing to formally warn you regarding [matter].\n\nDetails: [state details].\n\nFailure to [expected behaviour] may result in further disciplinary action.\n\nYours sincerely,' },
  { id: 'generic', label: 'Generic letter', subjectDefault: '', bodyDefault: '' },
];

const THEMES = [
  { id: 'classic', label: 'Classic', font: 'Georgia', desc: 'Traditional serif' },
  { id: 'modern', label: 'Modern', font: 'DM Sans', desc: 'Clean and clear' },
  { id: 'minimal', label: 'Minimal', font: 'system-ui', desc: 'Simple and neutral' },
  { id: 'professional', label: 'Professional', font: 'Georgia', desc: 'Accent line header' },
  { id: 'editorial', label: 'Editorial', font: 'Georgia', desc: 'Wide accent bar' },
];

const LAYOUTS = [
  { id: 'logo-left', label: 'Logo left', desc: 'Logo and company left-aligned' },
  { id: 'logo-center', label: 'Logo centre', desc: 'Logo and company centred' },
  { id: 'logo-right', label: 'Logo right', desc: 'Logo and company right-aligned' },
  { id: 'compact', label: 'Compact', desc: 'Tighter spacing' },
];

const ACCENT_COLOURS = [
  { id: 'brand', hex: '#b91c1c', name: 'Brand red' },
  { id: 'slate', hex: '#475569', name: 'Slate' },
  { id: 'blue', hex: '#1d4ed8', name: 'Blue' },
  { id: 'emerald', hex: '#047857', name: 'Emerald' },
  { id: 'indigo', hex: '#4338ca', name: 'Indigo' },
  { id: 'amber', hex: '#b45309', name: 'Amber' },
];

const QUICK_INSERTS = [
  { id: 'hearing', label: 'Disciplinary hearing notice', text: 'You are hereby requested to attend a disciplinary hearing on [date] at [time] at [venue]. You may be assisted by a representative in line with company policy.' },
  { id: 'appeal', label: 'Appeal process', text: 'If you wish to appeal this decision, submit your written appeal to HR within [x] working days of receiving this letter.' },
  { id: 'ack', label: 'Acknowledgement line', text: 'Please acknowledge receipt of this letter by signing and returning a copy.' },
];

const MERGE_FIELDS = ['[Employee Full Name]', '[ID Number]', '[Position]', '[Department]', '[Manager]', '[Date]', '[Case Reference]'];

const defaultCompany = {
  logoUrl: '',
  companyName: 'Tihlo',
  address: '',
  phone: '',
  email: '',
};

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...defaultCompany, ...parsed };
    }
  } catch (_) {}
  return { ...defaultCompany };
}

function saveStored(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (_) {}
}

export default function Letters() {
  const { user } = useAuth();
  const [navHidden, setNavHidden] = useSecondaryNavHidden('letters');
  const [company, setCompany] = useState(loadStored);
  const [letterType, setLetterType] = useState('warning');
  const [theme, setTheme] = useState('modern');
  const [layout, setLayout] = useState('logo-left');
  const [accentId, setAccentId] = useState('brand');
  const [recipientName, setRecipientName] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [signatoryName, setSignatoryName] = useState(user?.full_name || '');
  const [signatoryTitle, setSignatoryTitle] = useState('');
  const [signatureDataUrl, setSignatureDataUrl] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [savedLetters, setSavedLetters] = useState(loadSavedLetters);
  const [editingDraftId, setEditingDraftId] = useState(null);
  const [draftSearch, setDraftSearch] = useState('');
  const [previewZoom, setPreviewZoom] = useState(100);
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState('');
  const previewRef = useRef(null);
  const signatureCanvasRef = useRef(null);
  const sigDrawingRef = useRef(false);
  const sigPrevRef = useRef({ x: 0, y: 0 });
  const skipLetterTypeTemplateRef = useRef(false);

  useEffect(() => {
    if (skipLetterTypeTemplateRef.current) {
      skipLetterTypeTemplateRef.current = false;
      return;
    }
    const lt = LETTER_TYPES.find((t) => t.id === letterType);
    if (!lt) return;
    if (lt.subjectDefault) setSubject(lt.subjectDefault);
    if (lt.bodyDefault !== undefined) setBody(lt.bodyDefault);
  }, [letterType]);

  useEffect(() => {
    saveStored(company);
  }, [company]);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY_WORKING);
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      skipLetterTypeTemplateRef.current = true;
      if (d.letterType) setLetterType(d.letterType);
      if (d.theme) setTheme(d.theme);
      if (d.layout) setLayout(d.layout);
      if (d.accentId) setAccentId(d.accentId);
      if (d.recipientName != null) setRecipientName(d.recipientName);
      if (d.recipientAddress != null) setRecipientAddress(d.recipientAddress);
      if (d.date != null) setDate(d.date);
      if (d.subject != null) setSubject(d.subject);
      if (d.body != null) setBody(d.body);
      if (d.signatoryName != null) setSignatoryName(d.signatoryName);
      if (d.signatoryTitle != null) setSignatoryTitle(d.signatoryTitle);
      if (d.signatureDataUrl != null) setSignatureDataUrl(d.signatureDataUrl);
      if (d.previewZoom != null) setPreviewZoom(d.previewZoom);
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(company.logoUrl || DEFAULT_LOGO_URL);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(reader.result);
    reader.readAsDataURL(logoFile);
    return () => {};
  }, [logoFile, company.logoUrl]);

  useEffect(() => {
    const canvas = signatureCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const accentHex = ACCENT_COLOURS.find((c) => c.id === accentId)?.hex || ACCENT_COLOURS[0].hex;
  const themeFont = THEMES.find((t) => t.id === theme)?.font || 'DM Sans';
  const headerAlign = layout === 'logo-center' ? 'center' : layout === 'logo-right' ? 'right' : 'left';
  const headerFlex = layout === 'logo-center' ? 'justify-center' : layout === 'logo-right' ? 'justify-end' : 'justify-start';
  const compact = layout === 'compact';
  const bodyTextClass = theme === 'minimal' ? 'text-surface-800' : (theme === 'classic' || theme === 'professional' ? 'text-justify text-surface-800' : 'text-surface-800');
  const previewShellClass = theme === 'minimal'
    ? 'border border-surface-200'
    : theme === 'professional'
      ? 'ring-1 ring-surface-100'
      : 'shadow-lg';

  const handleLogoChange = (e) => {
    const file = e.target?.files?.[0];
    if (file) {
      setLogoFile(file);
      const reader = new FileReader();
      reader.onload = () => setCompany((c) => ({ ...c, logoUrl: reader.result }));
      reader.readAsDataURL(file);
    }
  };

  const useDefaultLogo = () => {
    setLogoFile(null);
    setCompany((c) => ({ ...c, logoUrl: '' }));
    setLogoPreview(DEFAULT_LOGO_URL);
  };

  const getLogoSizeForPdf = (dataUrl, maxW = 45, maxH = 20) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) return resolve({ width: maxW, height: maxH });
        const scale = Math.min(maxW / w, maxH / h, 1);
        resolve({ width: w * scale, height: h * scale });
      };
      img.onerror = () => resolve({ width: maxW, height: 14 });
      img.src = dataUrl;
    });
  };

  const getSignatureCoords = useCallback((e) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }, []);

  const startSignatureDraw = useCallback((e) => {
    const co = getSignatureCoords(e);
    if (!co) return;
    sigDrawingRef.current = true;
    sigPrevRef.current = co;
  }, [getSignatureCoords]);

  const moveSignatureDraw = useCallback((e) => {
    if (!sigDrawingRef.current) return;
    const canvas = signatureCanvasRef.current;
    const co = getSignatureCoords(e);
    if (!canvas || !co) return;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#171717';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sigPrevRef.current.x, sigPrevRef.current.y);
    ctx.lineTo(co.x, co.y);
    ctx.stroke();
    sigPrevRef.current = co;
  }, [getSignatureCoords]);

  const endSignatureDraw = useCallback(() => {
    sigDrawingRef.current = false;
    const canvas = signatureCanvasRef.current;
    if (canvas) {
      try {
        setSignatureDataUrl(canvas.toDataURL('image/png'));
      } catch (_) {}
    }
  }, []);

  const clearSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      setSignatureDataUrl('');
    }
  };

  const getCurrentDraft = useCallback(() => ({
    letterType,
    theme,
    layout,
    accentId,
    recipientName,
    recipientAddress,
    date,
    subject,
    body,
    signatoryName,
    signatoryTitle,
    signatureDataUrl,
  }), [letterType, theme, layout, accentId, recipientName, recipientAddress, date, subject, body, signatoryName, signatoryTitle, signatureDataUrl]);

  useEffect(() => {
    const payload = { ...getCurrentDraft(), previewZoom, autoSavedAt: new Date().toISOString() };
    try {
      localStorage.setItem(STORAGE_KEY_WORKING, JSON.stringify(payload));
      setLastAutoSavedAt(payload.autoSavedAt);
    } catch (_) {}
  }, [getCurrentDraft, previewZoom]);

  const saveDraft = () => {
    const draft = { ...getCurrentDraft(), id: editingDraftId || `draft-${Date.now()}`, savedAt: new Date().toISOString(), title: subject || recipientName || letterType || 'Untitled' };
    let next = savedLetters.filter((d) => d.id !== draft.id);
    next = [draft, ...next].slice(0, 50);
    setSavedLetters(next);
    saveSavedLetters(next);
    setEditingDraftId(draft.id);
  };

  const loadDraft = (d) => {
    skipLetterTypeTemplateRef.current = true;
    setLetterType(d.letterType ?? 'warning');
    setTheme(d.theme ?? 'modern');
    setLayout(d.layout ?? 'logo-left');
    setAccentId(d.accentId ?? 'brand');
    setRecipientName(d.recipientName ?? '');
    setRecipientAddress(d.recipientAddress ?? '');
    setDate(d.date ?? new Date().toISOString().slice(0, 10));
    setSubject(d.subject ?? '');
    setBody(d.body ?? '');
    setSignatoryName(d.signatoryName ?? user?.full_name ?? '');
    setSignatoryTitle(d.signatoryTitle ?? '');
    setSignatureDataUrl(d.signatureDataUrl ?? '');
    setEditingDraftId(d.id);
    const canvas = signatureCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (d.signatureDataUrl) {
        const img = new Image();
        img.onload = () => {
          if (signatureCanvasRef.current) {
            const c = signatureCanvasRef.current.getContext('2d');
            c.drawImage(img, 0, 0, canvas.width, canvas.height);
          }
        };
        img.src = d.signatureDataUrl;
      }
    }
  };

  const deleteDraft = (id) => {
    const next = savedLetters.filter((d) => d.id !== id);
    setSavedLetters(next);
    saveSavedLetters(next);
    if (editingDraftId === id) setEditingDraftId(null);
  };

  const newLetter = () => {
    setLetterType('warning');
    setSubject('');
    setBody('');
    setRecipientName('');
    setRecipientAddress('');
    setDate(new Date().toISOString().slice(0, 10));
    setSignatoryName(user?.full_name || '');
    setSignatoryTitle('');
    setSignatureDataUrl('');
    setPreviewZoom(100);
    setEditingDraftId(null);
    clearSignature();
  };

  const insertIntoBody = (text) => {
    const prefix = body.trim() ? '\n\n' : '';
    setBody((prev) => `${prev}${prefix}${text}`);
  };

  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;
  const readMinutes = Math.max(1, Math.ceil(wordCount / 180));
  const filteredSavedLetters = savedLetters.filter((d) => {
    const q = draftSearch.trim().toLowerCase();
    if (!q) return true;
    const hay = `${d.title || ''} ${d.subject || ''} ${d.recipientName || ''}`.toLowerCase();
    return hay.includes(q);
  });

  const exportPdf = async () => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const margin = 25;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const contentW = pageW - margin * 2;

    let y = margin;

    // Editorial theme: full-width accent bar at top
    if (theme === 'editorial') {
      const [r, g, b] = hexToRgb(accentHex);
      doc.setFillColor(r, g, b);
      doc.rect(0, 0, pageW, 5);
      doc.fill();
      y = margin + 2;
    }

    let logoDataUrl = null;
    if (logoPreview && logoPreview.startsWith('data:')) {
      logoDataUrl = logoPreview;
    } else if (logoPreview && (logoPreview.includes('tihlo-logo') || logoPreview === DEFAULT_LOGO_URL)) {
      try {
        const res = await fetch(DEFAULT_LOGO_URL);
        const blob = await res.blob();
        logoDataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
      } catch (_) {}
    }

    const addText = (text, fontSize = 11, opts = {}) => {
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
      const lines = doc.splitTextToSize(text || '', contentW);
      const align = opts.align || 'left';
      const x = align === 'center' ? pageW / 2 : align === 'right' ? pageW - margin : margin + (opts.indent || 0);
      lines.forEach((line) => {
        if (y > pageH - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, x, y, { align });
        y += fontSize * 0.45;
      });
      return y;
    };

    // Logo: preserve aspect ratio (no squashing)
    if (logoDataUrl) {
      try {
        const size = await getLogoSizeForPdf(logoDataUrl, 50, 18);
        const lx = headerAlign === 'center' ? (pageW - size.width) / 2 : headerAlign === 'right' ? pageW - margin - size.width : margin;
        doc.addImage(logoDataUrl, 'PNG', lx, y, size.width, size.height);
        y += size.height + 4;
      } catch (_) {
        y += 2;
      }
    }

    if (company.companyName) {
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(accentHex);
      doc.text(company.companyName, headerAlign === 'center' ? pageW / 2 : headerAlign === 'right' ? pageW - margin : margin, y, { align: headerAlign });
      y += 8;
    }
    if (theme === 'professional') {
      const [r, g, b] = hexToRgb(accentHex);
      doc.setDrawColor(r, g, b);
      doc.setLineWidth(0.5);
      doc.line(margin, y - 2, margin + Math.min(34, contentW), y - 2);
    }
    if (company.address) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      doc.splitTextToSize(company.address, contentW).forEach((line) => {
        doc.text(line, headerAlign === 'center' ? pageW / 2 : headerAlign === 'right' ? pageW - margin : margin, y, { align: headerAlign });
        y += 4;
      });
      y += 2;
    }
    if (company.phone || company.email) {
      const contact = [company.phone, company.email].filter(Boolean).join(' · ');
      doc.setFontSize(9);
      doc.text(contact, headerAlign === 'center' ? pageW / 2 : headerAlign === 'right' ? pageW - margin : margin, y, { align: headerAlign });
      y += 6;
    }
    doc.setTextColor(0, 0, 0);
    y += compact ? 6 : 10;

    addText(date, 10, { align: 'left' });
    y += compact ? 4 : 6;
    if (recipientName || recipientAddress) {
      addText(recipientName, 10, { align: 'left' });
      if (recipientAddress) addText(recipientAddress.replace(/\n/g, ' '), 10, { align: 'left' });
      y += compact ? 4 : 6;
    }
    if (subject) {
      addText(`Re: ${subject}`, theme === 'minimal' ? 11 : 11.5, { bold: true, align: 'left' });
      y += compact ? 4 : 6;
    }
    y += compact ? 2 : 4;
    addText(body, compact ? 10.5 : 11, { align: 'left' });
    y += compact ? 8 : 12;
    addText(signatoryName, 11, { bold: true, align: 'left' });
    if (signatoryTitle) addText(signatoryTitle, 10, { align: 'left' });
    if (signatureDataUrl) {
      try {
        y += 4;
        doc.addImage(signatureDataUrl, 'PNG', margin, y, 40, 15);
        y += 18;
      } catch (_) {}
    }

    doc.save(`letter-${letterType}-${date}.pdf`);
  };

  const exportWord = () => {
    const blob = new Blob([buildWordHtml()], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `letter-${letterType}-${date}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  function buildWordHtml() {
    const h = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const lines = (t) => (t || '').trim().split(/\n/).map((l) => h(l)).join('<br />');
    const bodyAlign = headerAlign;
    const paragraphAlign = theme === 'minimal' ? 'left' : 'justify';
    const fontStack = theme === 'modern' ? '"DM Sans", Arial, sans-serif' : theme === 'minimal' ? 'Arial, sans-serif' : 'Georgia, serif';
    const topBar = theme === 'editorial'
      ? `<div style="height: 6px; background: ${accentHex}; width: 100%; margin: -20px 0 18px 0;"></div>`
      : '';
    const accentRule = theme === 'professional'
      ? `<div style="height: 2px; width: 120px; background: ${accentHex}; margin: 2px 0 10px 0;"></div>`
      : '';
    const marginCm = '2.54cm'; // 1 inch for proper Word alignment
    return [
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">',
      '<head><meta charset="utf-8"/><title>Letter</title>',
      `<style>body { margin: ${marginCm}; font-family: ${fontStack}; font-size: 11pt; line-height: ${compact ? 1.35 : 1.5}; text-align: left; } .letter-body { text-align: ${paragraphAlign}; }</style></head>`,
      `<body style="margin: ${marginCm}; font-family: ${fontStack}; font-size: 11pt; line-height: ${compact ? 1.35 : 1.5};">`,
      topBar,
      company.companyName ? `<p style="font-size: 14pt; font-weight: bold; color: ${accentHex}; text-align: ${bodyAlign};">${h(company.companyName)}</p>` : '',
      accentRule,
      company.address ? `<p style="font-size: 9pt; color: #555; text-align: ${bodyAlign};">${lines(company.address)}</p>` : '',
      company.phone || company.email ? `<p style="font-size: 9pt; color: #555; text-align: ${bodyAlign};">${h([company.phone, company.email].filter(Boolean).join(' · '))}</p>` : '',
      '<p>&nbsp;</p>',
      `<p>${h(date)}</p>`,
      recipientName ? `<p>${h(recipientName)}</p>` : '',
      recipientAddress ? `<p>${lines(recipientAddress)}</p>` : '',
      subject ? `<p><strong>Re: ${h(subject)}</strong></p>` : '',
      '<p>&nbsp;</p>',
      `<p class="letter-body" style="text-align: ${paragraphAlign}; white-space: pre-wrap;">${lines(body)}</p>`,
      '<p>&nbsp;</p>',
      signatoryName ? `<p><strong>${h(signatoryName)}</strong></p>` : '',
      signatoryTitle ? `<p>${h(signatoryTitle)}</p>` : '',
      signatureDataUrl ? `<p><img src="${signatureDataUrl}" alt="Signature" style="height: 40px; width: auto; max-width: 160px;" /></p>` : '',
      '</body></html>',
    ].join('\n');
  }

  return (
    <div className={`flex flex-col min-h-0 ${navHidden ? 'max-w-full' : ''}`}>
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-surface-900">Letters</h1>
          <p className="text-sm text-surface-500 mt-0.5">Create suspension, warning and formal letters with enterprise-ready drafting, autosave, and polished exports.</p>
        </div>
        <div className="hidden md:flex items-center gap-2 text-xs">
          <span className="px-2 py-1 rounded-md bg-surface-100 text-surface-700">{wordCount} words</span>
          <span className="px-2 py-1 rounded-md bg-surface-100 text-surface-700">{readMinutes} min read</span>
          {lastAutoSavedAt && <span className="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">Autosaved {new Date(lastAutoSavedAt).toLocaleTimeString()}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 flex-1 min-h-0">
        {/* Left: Settings */}
        <div className="xl:col-span-1 space-y-6">
          <section className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-surface-800 mb-3">Company &amp; logo</h2>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-20 h-14 rounded-lg border border-surface-200 bg-surface-50 flex items-center justify-center overflow-hidden shrink-0 p-1">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo" className="max-w-full max-h-full w-auto h-auto object-contain" />
                  ) : (
                    <span className="text-surface-400 text-xs">Logo</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <label className="block text-xs font-medium text-surface-600 mb-1">Logo</label>
                  <div className="flex flex-wrap gap-2">
                    <label className="cursor-pointer px-2 py-1.5 rounded-lg bg-surface-100 text-surface-700 text-xs font-medium hover:bg-surface-200">
                      Upload
                      <input type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                    </label>
                    <button type="button" onClick={useDefaultLogo} className="px-2 py-1.5 rounded-lg bg-surface-100 text-surface-700 text-xs font-medium hover:bg-surface-200">
                      Use Tihlo logo
                    </button>
                  </div>
                </div>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-surface-600 block mb-1">Company name</span>
                <input
                  type="text"
                  value={company.companyName}
                  onChange={(e) => setCompany((c) => ({ ...c, companyName: e.target.value }))}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  placeholder="e.g. Tihlo"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-surface-600 block mb-1">Address</span>
                <textarea
                  value={company.address}
                  onChange={(e) => setCompany((c) => ({ ...c, address: e.target.value }))}
                  rows={2}
                  className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  placeholder="Street, city, postal code"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs font-medium text-surface-600 block mb-1">Phone</span>
                  <input
                    type="text"
                    value={company.phone}
                    onChange={(e) => setCompany((c) => ({ ...c, phone: e.target.value }))}
                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-surface-600 block mb-1">Email</span>
                  <input
                    type="email"
                    value={company.email}
                    onChange={(e) => setCompany((c) => ({ ...c, email: e.target.value }))}
                    className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-surface-800 mb-3">Design</h2>
            <div className="space-y-3">
              <div>
                <span className="text-xs font-medium text-surface-600 block mb-2">Theme</span>
                <div className="grid grid-cols-2 gap-2">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTheme(t.id)}
                      className={`rounded-lg border px-2 py-2 text-left text-xs transition-colors ${theme === t.id ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-surface-200 hover:bg-surface-50'}`}
                    >
                      <span className="font-medium block">{t.label}</span>
                      <span className="text-surface-500">{t.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-xs font-medium text-surface-600 block mb-2">Layout</span>
                <div className="grid grid-cols-2 gap-2">
                  {LAYOUTS.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setLayout(l.id)}
                      className={`rounded-lg border px-2 py-2 text-left text-xs transition-colors ${layout === l.id ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-surface-200 hover:bg-surface-50'}`}
                    >
                      <span className="font-medium block">{l.label}</span>
                      <span className="text-surface-500">{l.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-xs font-medium text-surface-600 block mb-2">Accent colour</span>
                <div className="flex flex-wrap gap-2">
                  {ACCENT_COLOURS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setAccentId(c.id)}
                      className={`rounded-full w-8 h-8 border-2 transition-all ${accentId === c.id ? 'border-surface-800 scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: c.hex }}
                      title={c.name}
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Center: Letter type & content */}
        <div className="xl:col-span-1 space-y-4">
          <section className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-surface-800 mb-3">Letter type</h2>
            <div className="flex flex-wrap gap-2">
              {LETTER_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setLetterType(t.id)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${letterType === t.id ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-surface-200 hover:bg-surface-50'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-surface-800">Content</h2>
            <label className="block">
              <span className="text-xs font-medium text-surface-600 block mb-1">Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-surface-600 block mb-1">Recipient name</span>
              <input type="text" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Full name" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-surface-600 block mb-1">Recipient address</span>
              <textarea value={recipientAddress} onChange={(e) => setRecipientAddress(e.target.value)} rows={2} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Address (optional)" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-surface-600 block mb-1">Subject</span>
              <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="Re: …" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-surface-600 block mb-1">Body</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm font-mono" placeholder="Letter body text…" />
            </label>
            <div className="rounded-lg border border-surface-200 bg-surface-50 p-3">
              <p className="text-xs font-medium text-surface-700 mb-2">Quick inserts</p>
              <div className="flex flex-wrap gap-2 mb-2">
                {QUICK_INSERTS.map((item) => (
                  <button key={item.id} type="button" onClick={() => insertIntoBody(item.text)} className="px-2.5 py-1.5 rounded-md border border-surface-300 bg-white text-xs text-surface-700 hover:bg-surface-100">
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-surface-500 mb-1">Merge fields</p>
              <div className="flex flex-wrap gap-2">
                {MERGE_FIELDS.map((field) => (
                  <button key={field} type="button" onClick={() => insertIntoBody(field)} className="px-2 py-1 rounded-md bg-brand-50 text-brand-700 text-[11px] border border-brand-200 hover:bg-brand-100">
                    {field}
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-surface-600 block mb-1">Signatory name</span>
              <input type="text" value={signatoryName} onChange={(e) => setSignatoryName(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-surface-600 block mb-1">Signatory title</span>
              <input type="text" value={signatoryTitle} onChange={(e) => setSignatoryTitle(e.target.value)} className="w-full rounded-lg border border-surface-300 px-3 py-2 text-sm" placeholder="e.g. HR Manager" />
            </label>
            <div className="block">
              <span className="text-xs font-medium text-surface-600 block mb-1">Signature (draw below)</span>
              <div className="border border-surface-300 rounded-lg overflow-hidden bg-white">
                <canvas
                  ref={signatureCanvasRef}
                  width={280}
                  height={100}
                  className="block w-full touch-none cursor-crosshair border-0"
                  style={{ maxWidth: '100%', height: 'auto', maxHeight: 100 }}
                  onMouseDown={startSignatureDraw}
                  onMouseMove={moveSignatureDraw}
                  onMouseUp={endSignatureDraw}
                  onMouseLeave={endSignatureDraw}
                  onTouchStart={(e) => { e.preventDefault(); startSignatureDraw(e); }}
                  onTouchMove={(e) => { e.preventDefault(); moveSignatureDraw(e); }}
                  onTouchEnd={(e) => { e.preventDefault(); endSignatureDraw(e); }}
                />
              </div>
              <button type="button" onClick={clearSignature} className="mt-1 text-xs text-surface-500 hover:text-surface-700">Clear signature</button>
            </div>
          </section>

          <section className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-surface-800 mb-3">Saved letters</h2>
            <div className="flex gap-2 mb-2">
              <button type="button" onClick={saveDraft} className="px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">Save draft</button>
              <button type="button" onClick={newLetter} className="px-3 py-2 rounded-lg border border-surface-300 text-surface-700 text-sm font-medium hover:bg-surface-50">New letter</button>
            </div>
            <input
              type="text"
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              placeholder="Search drafts by title, subject, recipient…"
              className="w-full mb-2 rounded-lg border border-surface-300 px-3 py-2 text-sm"
            />
            {savedLetters.length === 0 ? (
              <p className="text-surface-500 text-xs">No saved drafts. Click &quot;Save draft&quot; to save and edit later.</p>
            ) : (
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {filteredSavedLetters.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded border border-surface-100 group">
                    <span className="text-sm text-surface-700 truncate flex-1 min-w-0">{(d.title || d.subject || 'Untitled').slice(0, 30)}{(d.title || d.subject || '').length > 30 ? '…' : ''}</span>
                    <span className="text-xs text-surface-400 shrink-0">{d.savedAt ? new Date(d.savedAt).toLocaleDateString() : ''}</span>
                    <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button type="button" onClick={() => loadDraft(d)} className="text-brand-600 hover:underline text-xs">Edit</button>
                      <button type="button" onClick={() => deleteDraft(d.id)} className="text-red-600 hover:underline text-xs">Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Right: Preview & export */}
        <div className="xl:col-span-1 flex flex-col min-h-0">
          <section className="rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm flex flex-col flex-1 min-h-0">
            <div className="p-3 border-b border-surface-200 flex items-center justify-between bg-surface-50">
              <span className="text-sm font-medium text-surface-700">Preview</span>
              <div className="flex gap-2 items-center">
                <button type="button" onClick={() => setPreviewZoom((z) => Math.max(75, z - 10))} className="px-2 py-1 rounded border border-surface-300 text-xs">-</button>
                <span className="text-xs text-surface-600 w-10 text-center">{previewZoom}%</span>
                <button type="button" onClick={() => setPreviewZoom((z) => Math.min(150, z + 10))} className="px-2 py-1 rounded border border-surface-300 text-xs">+</button>
                <button type="button" onClick={exportPdf} className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-medium hover:bg-brand-700">
                  Export PDF
                </button>
                <button type="button" onClick={exportWord} className="px-3 py-1.5 rounded-lg bg-surface-200 text-surface-800 text-xs font-medium hover:bg-surface-300">
                  Export Word
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-surface-50" style={{ fontFamily: themeFont }}>
              <div
                ref={previewRef}
                className={`mx-auto bg-white rounded-lg max-w-lg overflow-hidden ${compact ? 'p-5' : 'p-8'} ${previewShellClass}`}
                style={{
                  fontFamily: themeFont,
                  fontSize: '11pt',
                  lineHeight: compact ? 1.35 : 1.5,
                  color: '#171717',
                  transform: `scale(${previewZoom / 100})`,
                  transformOrigin: 'top center',
                }}
              >
                {theme === 'editorial' && (
                  <div className="h-1.5 w-full mb-6" style={{ backgroundColor: accentHex }} />
                )}
                {theme === 'professional' && theme !== 'editorial' && (
                  <div className="h-1 w-24 rounded-full mb-6" style={{ backgroundColor: accentHex }} />
                )}
                <div className={`${layout === 'logo-center' ? 'text-center' : layout === 'logo-right' ? 'text-right' : 'text-left'}`}>
                  {logoPreview && (
                    <div className={`mb-4 flex ${headerFlex}`}>
                      <img src={logoPreview} alt="" className="h-12 w-auto max-w-[200px] object-contain" />
                    </div>
                  )}
                  {company.companyName && (
                    <p className="text-lg font-bold mb-1" style={{ color: accentHex }}>
                      {company.companyName}
                    </p>
                  )}
                  {company.address && <p className="text-sm text-surface-600 whitespace-pre-line mb-0.5">{company.address}</p>}
                  {(company.phone || company.email) && (
                    <p className="text-sm text-surface-600 mb-4">
                      {[company.phone, company.email].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <div className="text-left">
                  <p className="text-sm mt-4">{date}</p>
                  {(recipientName || recipientAddress) && (
                    <div className="mt-2 text-sm">
                      {recipientName && <p>{recipientName}</p>}
                      {recipientAddress && <p className="whitespace-pre-line text-surface-600">{recipientAddress}</p>}
                    </div>
                  )}
                  {subject && (
                    <p className="font-semibold mt-4">
                      Re: {subject}
                    </p>
                  )}
                  <div className={`mt-4 whitespace-pre-wrap ${bodyTextClass}`}>{body || '—'}</div>
                  <div className="mt-8">
                    {signatoryName && <p className="font-semibold">{signatoryName}</p>}
                    {signatoryTitle && <p className="text-sm text-surface-600">{signatoryTitle}</p>}
                    {signatureDataUrl && (
                      <img src={signatureDataUrl} alt="Signature" className="mt-2 h-10 w-auto max-w-[140px] object-contain object-left" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
