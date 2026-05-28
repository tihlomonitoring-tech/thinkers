/** Load ExcelJS only when exporting (keeps Command Centre initial bundle smaller). */
let excelModulePromise;

export function loadExcelJS() {
  if (!excelModulePromise) {
    excelModulePromise = import('exceljs').then((m) => m.default || m);
  }
  return excelModulePromise;
}
