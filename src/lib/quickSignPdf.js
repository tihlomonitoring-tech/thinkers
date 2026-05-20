/**
 * Build a signed-document record PDF (signature + audit metadata).
 * Original file is kept separately; this PDF is the tamper-evident signing record.
 */

import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

export async function buildSignedRecordPdf(outPath, {
  title,
  originalFileName,
  recipientName,
  recipientEmail,
  signerIdNumber,
  signedAt,
  latitude,
  longitude,
  locationAccuracy,
  signatureImagePath,
}) {
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);
    stream.on('finish', () => resolve(outPath));
    stream.on('error', reject);
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#111827').text('Quick Sign — Signed document record', { align: 'left' });
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(10).fillColor('#6b7280').text(`Generated ${new Date().toISOString()}`, { align: 'left' });
    doc.moveDown(1.2);

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#374151').text('Document');
    doc.font('Helvetica').fontSize(10).fillColor('#111827');
    doc.text(title || '—');
    doc.text(`Original file: ${originalFileName || '—'}`);
    doc.moveDown(0.8);

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#374151').text('Signer');
    doc.font('Helvetica').fontSize(10).fillColor('#111827');
    doc.text(`Name: ${recipientName || '—'}`);
    doc.text(`Email: ${recipientEmail || '—'}`);
    doc.text(`ID number: ${signerIdNumber || '—'}`);
    doc.text(`Signed at: ${signedAt ? new Date(signedAt).toLocaleString() : '—'}`);
    doc.moveDown(0.8);

    if (latitude != null && longitude != null) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#374151').text('Location (at signing)');
      doc.font('Helvetica').fontSize(10).fillColor('#111827');
      doc.text(`Latitude: ${latitude}`);
      doc.text(`Longitude: ${longitude}`);
      if (locationAccuracy != null) doc.text(`Accuracy (m): ${locationAccuracy}`);
      doc.moveDown(0.8);
    }

    if (signatureImagePath && fs.existsSync(signatureImagePath)) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#374151').text('Signature');
      doc.moveDown(0.3);
      try {
        doc.image(signatureImagePath, { fit: [400, 120] });
      } catch (_) {
        doc.font('Helvetica').fontSize(10).text('(Signature image unavailable)');
      }
    }

    doc.moveDown(1);
    doc.font('Helvetica').fontSize(8).fillColor('#9ca3af')
      .text('This record was created by the Thinkers Quick Sign service. The original uploaded file is stored separately.', { align: 'left' });

    doc.end();
  });
}
