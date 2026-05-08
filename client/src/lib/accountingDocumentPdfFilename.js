import { toYmdFromDbOrString } from './appTime.js';

/** Safe fragment for a downloaded PDF filename (Windows/macOS). */
export function sanitizeAccountingPdfPart(value, fallback) {
  const raw = value != null && String(value).trim() ? String(value).trim() : '';
  const base = raw || (fallback != null ? String(fallback) : '');
  if (!base) return '';
  return base
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** YYYY-MM-DD for filenames, or fallback if missing/invalid. */
export function issueDateSlugForPdf(dateValue) {
  if (!dateValue) return 'no-date';
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return 'no-date';
  return toYmdFromDbOrString(d);
}

/**
 * Download name: customer (or supplier) name, reference number, company name, issue date.
 * Order: Party — Reference — Company — Date.pdf
 */
export function buildAccountingPdfFilename({ partyName, reference, companyName, issueDate }) {
  const party = sanitizeAccountingPdfPart(partyName, 'Customer') || 'Customer';
  const ref = sanitizeAccountingPdfPart(reference, 'REF') || 'REF';
  const company = sanitizeAccountingPdfPart(companyName, 'Company') || 'Company';
  const datePart = issueDateSlugForPdf(issueDate);
  return `${party} - ${ref} - ${company} - ${datePart}.pdf`;
}

/**
 * Statement of account PDF download name:
 * Customer statement — customer name — company name — date.pdf
 */
export function buildCustomerStatementPdfFilename({ customerName, companyName, statementDate }) {
  const cust = sanitizeAccountingPdfPart(customerName, 'Customer') || 'Customer';
  const co = sanitizeAccountingPdfPart(companyName, 'Company') || 'Company';
  const datePart = issueDateSlugForPdf(statementDate);
  return `Customer statement - ${cust} - ${co} - ${datePart}.pdf`;
}
