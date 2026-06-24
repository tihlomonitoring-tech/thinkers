import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { flattenOrgTree } from './orgChartTree.js';

/** Browser print targets (small screen page). */
const SAFE_PRINT_WIDTH_PX = 680;
const SAFE_PRINT_HEIGHT_PX = 900;

const CHART_BASE_STYLES = `
.org-chart-root { overflow: visible; width: max-content; max-width: none; margin: 0 auto; padding: 12px; }
.org-chart-root .org-chart { display: flex; justify-content: center; flex-wrap: nowrap; padding: 0; margin: 0; list-style: none; gap: 10px; }
.org-chart-root .org-chart-ul {
  display: flex; justify-content: center; flex-wrap: nowrap; padding-top: 30px; margin: 0; list-style: none; position: relative; gap: 6px;
}
.org-chart-root .org-chart-ul::before {
  content: ''; position: absolute; top: 0; left: 50%; width: 0; height: 30px;
  border-left: 2px solid #475569;
}
.org-chart-root .org-chart-li {
  display: flex; flex-direction: column; align-items: center; position: relative;
  padding: 30px 16px 0 16px; list-style: none; flex-shrink: 0;
}
.org-chart-root .org-chart-li::before,
.org-chart-root .org-chart-li::after {
  content: ''; position: absolute; top: 0; width: 50%; height: 30px;
  border-top: 2px solid #475569;
}
.org-chart-root .org-chart-li::before { right: 50%; border-right: 2px solid #475569; border-radius: 0 8px 0 0; }
.org-chart-root .org-chart-li::after { left: 50%; border-left: 2px solid #475569; border-radius: 8px 0 0 0; }
.org-chart-root .org-chart-li:only-child::before,
.org-chart-root .org-chart-li:only-child::after { display: none; }
.org-chart-root .org-chart-li:first-child::before { border: none; }
.org-chart-root .org-chart-li:last-child::after { border: none; }
.org-chart-root .org-chart > .org-chart-li { padding-top: 0; }
.org-chart-root .org-chart > .org-chart-li::before,
.org-chart-root .org-chart > .org-chart-li::after { display: none; }
.org-chart-node {
  position: relative; min-width: 175px; max-width: 240px; border-radius: 10px;
  padding: 10px 12px; text-align: left; font-family: system-ui, -apple-system, sans-serif;
  border: 1px solid #94a3b8; box-sizing: border-box;
  background: linear-gradient(165deg, #ffffff 0%, #f1f5f9 55%, #e2e8f0 100%);
  box-shadow: 0 2px 5px rgba(15,23,42,0.12), 0 6px 16px rgba(15,23,42,0.08);
}
.org-chart-node.vacant {
  border-style: dashed; background: linear-gradient(165deg, #f8fafc 0%, #f1f5f9 100%);
}
.org-chart-node .name { font-size: 12px; font-weight: 700; color: #0f172a; line-height: 1.35; word-wrap: break-word; overflow-wrap: anywhere; }
.org-chart-node .title { font-size: 10px; color: #4338ca; margin-top: 3px; line-height: 1.35; word-wrap: break-word; overflow-wrap: anywhere; }
.org-chart-node .dept { font-size: 9px; color: #64748b; margin-top: 3px; line-height: 1.35; word-wrap: break-word; overflow-wrap: anywhere; }
.org-chart-root .org-chart-li > .org-chart-node::before {
  content: ''; position: absolute; top: -30px; left: 50%; width: 0; height: 30px;
  border-left: 2px solid #475569; transform: translateX(-50%);
}
.org-chart-root .org-chart > .org-chart-li > .org-chart-node::before { display: none; }
#print-clip { overflow: hidden; margin: 0 auto; }
#print-inner { transform-origin: top left; }
`;

/** Larger typography for PDF raster export. */
const PDF_CHART_STYLES = `
.org-chart-root { overflow: visible; width: max-content; max-width: none; margin: 0 auto; padding: 16px; }
.org-chart-root .org-chart { display: flex; justify-content: center; flex-wrap: nowrap; padding: 0; margin: 0; list-style: none; gap: 12px; }
.org-chart-root .org-chart-ul {
  display: flex; justify-content: center; flex-wrap: nowrap; padding-top: 32px; margin: 0; list-style: none; position: relative; gap: 8px;
}
.org-chart-root .org-chart-ul::before {
  content: ''; position: absolute; top: 0; left: 50%; width: 0; height: 32px;
  border-left: 2px solid #334155;
}
.org-chart-root .org-chart-li {
  display: flex; flex-direction: column; align-items: center; position: relative;
  padding: 32px 18px 0 18px; list-style: none; flex-shrink: 0;
}
.org-chart-root .org-chart-li::before,
.org-chart-root .org-chart-li::after {
  content: ''; position: absolute; top: 0; width: 50%; height: 32px;
  border-top: 2px solid #334155;
}
.org-chart-root .org-chart-li::before { right: 50%; border-right: 2px solid #334155; border-radius: 0 8px 0 0; }
.org-chart-root .org-chart-li::after { left: 50%; border-left: 2px solid #334155; border-radius: 8px 0 0 0; }
.org-chart-root .org-chart-li:only-child::before,
.org-chart-root .org-chart-li:only-child::after { display: none; }
.org-chart-root .org-chart-li:first-child::before { border: none; }
.org-chart-root .org-chart-li:last-child::after { border: none; }
.org-chart-root .org-chart > .org-chart-li { padding-top: 0; }
.org-chart-root .org-chart > .org-chart-li::before,
.org-chart-root .org-chart > .org-chart-li::after { display: none; }
.org-chart-node {
  position: relative; min-width: 190px; max-width: 260px; border-radius: 10px;
  padding: 12px 14px; text-align: left; font-family: system-ui, -apple-system, sans-serif;
  border: 1px solid #64748b; box-sizing: border-box;
  background: #ffffff;
  box-shadow: 0 2px 4px rgba(15,23,42,0.1);
}
.org-chart-node.vacant { border-style: dashed; background: #f8fafc; }
.org-chart-node .name { font-size: 13px; font-weight: 700; color: #0f172a; line-height: 1.4; word-wrap: break-word; overflow-wrap: anywhere; }
.org-chart-node .title { font-size: 11px; color: #3730a3; margin-top: 4px; line-height: 1.4; word-wrap: break-word; overflow-wrap: anywhere; }
.org-chart-node .dept { font-size: 10px; color: #475569; margin-top: 4px; line-height: 1.4; word-wrap: break-word; overflow-wrap: anywhere; }
.org-chart-root .org-chart-li > .org-chart-node::before {
  content: ''; position: absolute; top: -32px; left: 50%; width: 0; height: 32px;
  border-left: 2px solid #334155; transform: translateX(-50%);
}
.org-chart-root .org-chart > .org-chart-li > .org-chart-node::before { display: none; }
`;

const VISUAL_HOST_ID = 'org-chart-visual-host';
const VISUAL_STYLE_ID = 'org-chart-visual-styles';

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nodeCardHtml(node) {
  const vacant = !node.user_id;
  const name = vacant ? 'Vacant' : node.display_name || 'Employee';
  return `<div class="org-chart-node${vacant ? ' vacant' : ''}">
    <div class="name">${escapeHtml(name)}</div>
    <div class="title">${escapeHtml(node.position_title || '—')}</div>
    ${node.department_name ? `<div class="dept">${escapeHtml(node.department_name)}</div>` : ''}
  </div>`;
}

function treeLiHtml(node) {
  const children = node.children || [];
  const kids = children.map((c) => treeLiHtml(c)).join('');
  return `<li class="org-chart-li">${nodeCardHtml(node)}${kids ? `<ul class="org-chart-ul">${kids}</ul>` : ''}</li>`;
}

function treeInnerHtml(roots) {
  const items = (roots || []).map((r) => treeLiHtml(r)).join('');
  return `<div class="org-chart-root"><ul class="org-chart">${items}</ul></div>`;
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function cleanupVisualHost() {
  document.getElementById(VISUAL_HOST_ID)?.remove();
  document.getElementById(VISUAL_STYLE_ID)?.remove();
}

function buildPrintChartHtml(roots, { title = 'Organisational structure', tenantName = '' } = {}) {
  const flat = flattenOrgTree(roots);
  return `
    <h1 style="font-size:20px;margin:0 0 4px;font-family:system-ui,sans-serif;color:#0f172a">${escapeHtml(title)}</h1>
    <p style="font-size:11px;color:#64748b;margin:0 0 12px;font-family:system-ui,sans-serif">
      ${escapeHtml(tenantName)} · ${flat.length} position(s) · ${todayStamp()}
    </p>
    <div id="print-clip" style="overflow:hidden;margin:0 auto;">
      <div id="print-inner" style="transform-origin:top left;">
        ${treeInnerHtml(roots)}
      </div>
    </div>
  `;
}

function applyPrintChartFit(host) {
  const root = host?.querySelector('.org-chart-root');
  const clip = host?.querySelector('#print-clip');
  const inner = host?.querySelector('#print-inner');
  if (!root || !clip || !inner) return;

  const cw = root.scrollWidth || root.offsetWidth;
  const ch = root.scrollHeight || root.offsetHeight;
  if (!cw || !ch) return;

  const header = 56;
  const scale = Math.min(1, SAFE_PRINT_WIDTH_PX / cw, (SAFE_PRINT_HEIGHT_PX - header) / ch);
  inner.style.width = `${cw}px`;
  inner.style.height = `${ch}px`;
  inner.style.transform = `scale(${scale})`;
  clip.style.width = `${Math.ceil(cw * scale)}px`;
  clip.style.height = `${Math.ceil(ch * scale)}px`;
}

function mountPrintHost(roots, opts) {
  cleanupVisualHost();

  const styleEl = document.createElement('style');
  styleEl.id = VISUAL_STYLE_ID;
  styleEl.textContent = `
    ${CHART_BASE_STYLES}
    #${VISUAL_HOST_ID} {
      font-family: system-ui, sans-serif; color: #0f172a; background: #fff; box-sizing: border-box;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    @media screen {
      #${VISUAL_HOST_ID} {
        position: fixed !important; left: -20000px !important; top: 0 !important;
        visibility: hidden !important; pointer-events: none !important;
        width: 1px !important; height: 1px !important; overflow: hidden !important;
      }
    }
    @media print {
      @page { size: A4 landscape; margin: 8mm; }
      html, body { margin: 0 !important; padding: 0 !important; overflow: visible !important; }
      body > *:not(#${VISUAL_HOST_ID}) { display: none !important; }
      #${VISUAL_HOST_ID} {
        display: block !important; position: static !important; width: 100% !important;
        padding: 10px 14px; overflow: visible !important; visibility: visible !important;
      }
    }
  `;

  const host = document.createElement('div');
  host.id = VISUAL_HOST_ID;
  host.innerHTML = buildPrintChartHtml(roots, opts);

  document.head.appendChild(styleEl);
  document.body.appendChild(host);
  applyPrintChartFit(host);
  return host;
}

function mountPdfCaptureHost(roots) {
  cleanupVisualHost();

  const styleEl = document.createElement('style');
  styleEl.id = VISUAL_STYLE_ID;
  styleEl.textContent = `
    ${PDF_CHART_STYLES}
    #${VISUAL_HOST_ID} {
      position: fixed; left: -12000px; top: 0; z-index: -1;
      visibility: visible; opacity: 1;
      background: #fff; padding: 0; margin: 0;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
  `;

  const host = document.createElement('div');
  host.id = VISUAL_HOST_ID;
  host.innerHTML = treeInnerHtml(roots);

  document.head.appendChild(styleEl);
  document.body.appendChild(host);
  return host;
}

function waitForLayout() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function addImagePaginated(doc, imgData, imgWpx, imgHpx, xMm, startYMm, drawWMm, pageHMm, marginMm) {
  const drawHMm = (imgHpx * drawWMm) / imgWpx;
  let offsetYMm = 0;
  let page = 0;

  while (offsetYMm < drawHMm) {
    if (page > 0) doc.addPage();
    const sliceTopMm = startYMm - offsetYMm;
    doc.addImage(imgData, 'PNG', xMm, sliceTopMm, drawWMm, drawHMm, undefined, 'SLOW');
    offsetYMm += pageHMm - startYMm - marginMm;
    page += 1;
  }
}

/**
 * Print the full visual org chart (in-page print sheet, auto-scaled to fit one page).
 */
export function printOrgChartVisual(roots, opts = {}) {
  const host = mountPrintHost(roots, opts);

  const onBeforePrint = () => applyPrintChartFit(host);
  const onAfterPrint = () => {
    window.removeEventListener('beforeprint', onBeforePrint);
    window.removeEventListener('afterprint', onAfterPrint);
    cleanupVisualHost();
  };

  window.addEventListener('beforeprint', onBeforePrint);
  window.addEventListener('afterprint', onAfterPrint);
  setTimeout(cleanupVisualHost, 120_000);

  waitForLayout().then(() => {
    applyPrintChartFit(host);
    window.focus();
    window.print();
  });
}

/**
 * Download visual org chart as a properly laid-out landscape PDF (A3, full width).
 */
export async function downloadOrgChartPdf(roots, opts = {}) {
  const { title = 'Organisational structure', tenantName = '' } = opts;
  const flat = flattenOrgTree(roots);
  const host = mountPdfCaptureHost(roots);

  try {
    await waitForLayout();
    await new Promise((r) => setTimeout(r, 200));

    const chartEl = host.querySelector('.org-chart-root');
    if (!chartEl) throw new Error('Could not render chart for PDF');

    const captureW = chartEl.scrollWidth + 24;
    const captureH = chartEl.scrollHeight + 24;

    const canvas = await html2canvas(chartEl, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
      width: captureW,
      height: captureH,
      windowWidth: captureW + 40,
      windowHeight: captureH + 40,
    });

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 12;
    const headerBlock = 16;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(title, margin, margin + 2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(90);
    doc.text(
      `${tenantName ? `${tenantName} · ` : ''}${flat.length} position(s) · ${todayStamp()}`,
      margin,
      margin + 10
    );
    doc.setTextColor(0);

    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2 - headerBlock;
    const chartTop = margin + headerBlock;

    const imgData = canvas.toDataURL('image/png');
    const aspect = canvas.height / canvas.width;

    const drawW = availW;
    const drawH = drawW * aspect;
    const x = margin;
    const y = chartTop;

    if (drawH <= availH) {
      const centeredY = chartTop + (availH - drawH) / 2;
      doc.addImage(imgData, 'PNG', x, centeredY, drawW, drawH, undefined, 'SLOW');
    } else {
      addImagePaginated(doc, imgData, canvas.width, canvas.height, margin, chartTop, availW, pageH, margin);
    }

    doc.save(`organisational-structure-${todayStamp()}.pdf`);
  } finally {
    cleanupVisualHost();
  }
}
