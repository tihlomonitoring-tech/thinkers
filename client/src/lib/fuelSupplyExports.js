import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportFuelActivitiesPdf(activities, title = 'Supply activity log') {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 14;
  doc.setFontSize(15);
  doc.text(title, 14, y);
  y += 8;
  doc.setFontSize(9);
  for (const a of activities || []) {
    const line = `${a.created_at ? new Date(a.created_at).toLocaleString() : ''} | ${a.activity_type || ''} | ${a.title || ''}`;
    const split = doc.splitTextToSize(`${line}\n${a.depot_name || ''} → ${a.delivery_site_name || ''}`, 180);
    if (y + split.length * 4 > 285) {
      doc.addPage();
      y = 14;
    }
    doc.text(split, 14, y);
    y += split.length * 4 + 2;
  }
  doc.save(`fuel-activities-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export async function exportFuelActivitiesExcel(activities, filename = 'fuel-supply-activities.xlsx') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Activities');
  ws.columns = [
    { header: 'Created', key: 'created', width: 20 },
    { header: 'Type', key: 'type', width: 14 },
    { header: 'Title', key: 'title', width: 36 },
    { header: 'Depot', key: 'depot', width: 22 },
    { header: 'Site', key: 'site', width: 22 },
    { header: 'Driver', key: 'driver', width: 18 },
    { header: 'Liters', key: 'liters', width: 12 },
    { header: 'Location', key: 'loc', width: 20 },
    { header: 'Odometer km', key: 'odo', width: 12 },
    { header: 'Duration min', key: 'dur', width: 12 },
    { header: 'Tags', key: 'tags', width: 18 },
    { header: 'Notes', key: 'notes', width: 40 },
  ];
  for (const a of activities || []) {
    ws.addRow({
      created: a.created_at ? new Date(a.created_at).toISOString() : '',
      type: a.activity_type || '',
      title: a.title || '',
      depot: a.depot_name || '',
      site: a.delivery_site_name || '',
      driver: a.driver_name || '',
      liters: a.liters_related != null ? a.liters_related : '',
      loc: a.location_label || '',
      odo: a.odometer_km != null ? a.odometer_km : '',
      dur: a.duration_minutes != null ? a.duration_minutes : '',
      tags: a.tags || '',
      notes: a.notes || '',
    });
  }
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

export function exportFuelReconciliationsPdf(rows, title = 'Fuel reconciliations') {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 14;
  doc.setFontSize(15);
  doc.text(title, 14, y);
  y += 10;
  doc.setFontSize(9);
  for (const r of rows || []) {
    const amt = Number(r.invoice_amount) || 0;
    const fee = Number(r.handling_fee) || 0;
    const txt = `${r.invoice_reference || ''} | R ${amt.toFixed(2)} + fee R ${fee.toFixed(2)} | ${r.payment_status || ''} | ${r.depot_name || ''} → ${r.delivery_site_name || ''}`;
    const split = doc.splitTextToSize(txt, 180);
    if (y + split.length * 4 > 285) {
      doc.addPage();
      y = 14;
    }
    doc.text(split, 14, y);
    y += split.length * 4 + 2;
  }
  doc.save(`fuel-reconciliations-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export async function exportFuelReconciliationsExcel(rows, filename = 'fuel-supply-reconciliations.xlsx') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Reconciliations');
  ws.columns = [
    { header: 'Created', key: 'c', width: 20 },
    { header: 'Invoice ref', key: 'inv', width: 16 },
    { header: 'Amount', key: 'amt', width: 12 },
    { header: 'Handling fee', key: 'fee', width: 12 },
    { header: 'Total', key: 'tot', width: 12 },
    { header: 'Payment', key: 'pay', width: 12 },
    { header: 'Depot', key: 'dep', width: 22 },
    { header: 'Site', key: 'site', width: 22 },
    { header: 'Order status', key: 'ost', width: 14 },
    { header: 'Notes', key: 'notes', width: 36 },
  ];
  for (const r of rows || []) {
    const amt = Number(r.invoice_amount) || 0;
    const fee = Number(r.handling_fee) || 0;
    ws.addRow({
      c: r.created_at ? new Date(r.created_at).toISOString() : '',
      inv: r.invoice_reference || '',
      amt,
      fee,
      tot: amt + fee,
      pay: r.payment_status || '',
      dep: r.depot_name || '',
      site: r.delivery_site_name || '',
      ost: r.order_status || '',
      notes: r.notes || '',
    });
  }
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

export function exportProductionVsExpensesPdf({ series, assumedPricePerLiter, forecast }, title = 'Production vs expenses') {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 14;
  doc.setFontSize(16);
  doc.text(title, 14, y);
  y += 8;
  doc.setFontSize(10);
  doc.text(`Generated ${new Date().toLocaleString()}`, 14, y);
  y += 10;
  if (forecast?.liters != null || forecast?.cost != null) {
    doc.setFont('helvetica', 'bold');
    doc.text('Forecast (next month, trend)', 14, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Volume (L): ${forecast.liters != null ? forecast.liters.toFixed(0) : '—'}   Cost (R): ${forecast.cost != null ? forecast.cost.toFixed(2) : '—'}`,
      14,
      y
    );
    y += 10;
  }
  doc.setFont('helvetica', 'bold');
  doc.text('Month', 14, y);
  doc.text('Liters delivered', 45, y);
  doc.text('Cost (R)', 85, y);
  doc.text(`Income @ ${assumedPricePerLiter}/L`, 115, y);
  doc.text('Margin', 165, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  const price = Number(assumedPricePerLiter) || 0;
  for (const s of series || []) {
    const liters = Number(s.liters) || 0;
    const cost = Number(s.cost) || 0;
    const income = price > 0 ? liters * price : 0;
    const margin = income - cost;
    if (y > 270) {
      doc.addPage();
      y = 14;
    }
    doc.text(String(s.ym || ''), 14, y);
    doc.text(liters.toFixed(1), 45, y);
    doc.text(cost.toFixed(2), 85, y);
    doc.text(price > 0 ? income.toFixed(2) : '—', 115, y);
    doc.text(price > 0 ? margin.toFixed(2) : '—', 165, y);
    y += 6;
  }
  doc.save(`fuel-production-vs-expenses-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export async function exportProductionVsExpensesExcel({ series, assumedPricePerLiter, forecast }, filename) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Monthly');
  ws.columns = [
    { header: 'Month', key: 'ym', width: 12 },
    { header: 'Liters delivered', key: 'liters', width: 16 },
    { header: 'Invoice (R)', key: 'inv', width: 14 },
    { header: 'Fees (R)', key: 'fee', width: 12 },
    { header: 'Total cost (R)', key: 'cost', width: 14 },
    { header: `Income @ ${assumedPricePerLiter}/L`, key: 'inc', width: 18 },
    { header: 'Margin (R)', key: 'margin', width: 14 },
  ];
  const price = Number(assumedPricePerLiter) || 0;
  for (const s of series || []) {
    const liters = Number(s.liters) || 0;
    const inv = Number(s.invoice_total) || 0;
    const fee = Number(s.fees_total) || 0;
    const cost = Number(s.cost) || inv + fee;
    const income = price > 0 ? liters * price : 0;
    ws.addRow({
      ym: s.ym,
      liters,
      inv,
      fee,
      cost,
      inc: price > 0 ? income : '',
      margin: price > 0 ? income - cost : '',
    });
  }
  if (forecast) {
    ws.addRow({
      ym: 'Forecast next',
      liters: forecast.liters,
      inv: '',
      fee: '',
      cost: forecast.cost,
      inc: '',
      margin: '',
    });
  }
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename || `fuel-production-vs-expenses-${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}
