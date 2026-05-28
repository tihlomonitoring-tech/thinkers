import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';

async function downloadWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadAssetTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Assets');
  ws.addRow(['asset_code', 'name', 'category', 'location', 'serial_number', 'purchase_date', 'purchase_value', 'status', 'notes']);
  ws.addRow(['OFF-001', 'HP LaserJet Pro', 'IT', 'Reception', 'SN12345', '2024-01-15', '8500', 'active', '']);
  ws.getRow(1).font = { bold: true };
  await downloadWorkbook(wb, 'office-assets-template.xlsx');
}

export async function downloadConsumableTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Consumables');
  ws.addRow(['name', 'category', 'unit', 'quantity_on_hand', 'reorder_level', 'unit_cost', 'notes']);
  ws.addRow(['Arabica beans 1kg', 'coffee', 'bag', '10', '5', '250', '']);
  ws.addRow(['Rooibos tea box', 'tea', 'box', '20', '8', '85', '']);
  ws.getRow(1).font = { bold: true };
  await downloadWorkbook(wb, 'office-consumables-template.xlsx');
}

export async function exportAssetsExcel(assets) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Asset register');
  ws.addRow(['Asset code', 'Name', 'Category', 'Location', 'Serial', 'Purchase date', 'Value', 'Status', 'Notes']);
  (assets || []).forEach((a) => {
    ws.addRow([
      a.asset_code,
      a.name,
      a.category,
      a.location,
      a.serial_number,
      a.purchase_date ? String(a.purchase_date).slice(0, 10) : '',
      a.purchase_value,
      a.status,
      a.notes,
    ]);
  });
  ws.getRow(1).font = { bold: true };
  await downloadWorkbook(wb, `office-assets-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export async function exportConsumablesExcel(items) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Consumables');
  ws.addRow(['Name', 'Category', 'Unit', 'Qty on hand', 'Reorder level', 'Unit cost', 'Notes']);
  (items || []).forEach((c) => {
    ws.addRow([c.name, c.category, c.unit, c.quantity_on_hand, c.reorder_level, c.unit_cost, c.notes]);
  });
  ws.getRow(1).font = { bold: true };
  await downloadWorkbook(wb, `office-consumables-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportAssetsPdf(assets, title = 'Office asset register') {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 14;
  let y = margin;
  doc.setFontSize(16);
  doc.text(title, margin, y);
  y += 10;
  doc.setFontSize(9);
  (assets || []).slice(0, 80).forEach((a) => {
    if (y > 280) {
      doc.addPage();
      y = margin;
    }
    const line = `${a.asset_code || '—'} · ${a.name || '—'} · ${a.status || ''} · ${a.location || ''}`;
    doc.text(line.slice(0, 120), margin, y);
    y += 5;
  });
  doc.save(`office-assets-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function exportMaintenancePdf(reports, records) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 14;
  let y = margin;
  doc.setFontSize(14);
  doc.text('Maintenance summary', margin, y);
  y += 8;
  doc.setFontSize(10);
  doc.text('Open reports', margin, y);
  y += 6;
  doc.setFontSize(9);
  (reports || []).forEach((r) => {
    if (y > 280) {
      doc.addPage();
      y = margin;
    }
    doc.text(`${r.title} (${r.status}) — ${r.asset_name_snapshot || r.asset_name || ''}`.slice(0, 100), margin, y);
    y += 5;
  });
  y += 4;
  doc.setFontSize(10);
  doc.text('Maintenance records', margin, y);
  y += 6;
  doc.setFontSize(9);
  (records || []).forEach((m) => {
    if (y > 280) {
      doc.addPage();
      y = margin;
    }
    doc.text(`${m.asset_code || ''} ${m.asset_name || ''}: ${String(m.description || '').slice(0, 80)}`, margin, y);
    y += 5;
  });
  doc.save(`office-maintenance-${new Date().toISOString().slice(0, 10)}.pdf`);
}
