/**
 * Stamp signature/initial PNG images onto a PDF at normalized positions (0–1, top-left origin).
 */

import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';

/**
 * @param {string} sourcePdfPath absolute path to source PDF
 * @param {string} outputPdfPath absolute path to write
 * @param {Array<{ pageIndex: number, xPct: number, yPct: number, widthPct: number, heightPct: number, imagePath: string }>} placements
 */
export async function stampSignaturesOnPdf(sourcePdfPath, outputPdfPath, placements) {
  const bytes = await fs.promises.readFile(sourcePdfPath);
  const pdfDoc = await PDFDocument.load(bytes);
  const pages = pdfDoc.getPages();

  for (const p of placements || []) {
    const pageIndex = Number(p.pageIndex) || 0;
    const page = pages[pageIndex];
    if (!page || !p.imagePath || !fs.existsSync(p.imagePath)) continue;

    const { width: pw, height: ph } = page.getSize();
    const imgBytes = await fs.promises.readFile(p.imagePath);
    let embedded;
    try {
      embedded = await pdfDoc.embedPng(imgBytes);
    } catch {
      try {
        embedded = await pdfDoc.embedJpg(imgBytes);
      } catch {
        continue;
      }
    }

    const w = pw * Math.max(0.05, Math.min(0.5, Number(p.widthPct) || 0.2));
    const h = ph * Math.max(0.03, Math.min(0.25, Number(p.heightPct) || 0.08));
    const x = pw * Math.max(0, Math.min(1, Number(p.xPct) || 0));
    const yTop = ph * Math.max(0, Math.min(1, Number(p.yPct) || 0));
    const y = ph - yTop - h;

    page.drawImage(embedded, { x, y, width: w, height: h });
  }

  await fs.promises.mkdir(path.dirname(outputPdfPath), { recursive: true });
  const outBytes = await pdfDoc.save();
  await fs.promises.writeFile(outputPdfPath, outBytes);
  return outputPdfPath;
}

export async function getPdfPageCount(pdfPath) {
  const bytes = await fs.promises.readFile(pdfPath);
  const pdfDoc = await PDFDocument.load(bytes);
  return pdfDoc.getPageCount();
}

export async function copyPdfFile(src, dest) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.copyFile(src, dest);
  return dest;
}
