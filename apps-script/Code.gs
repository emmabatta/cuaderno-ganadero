const SHEETS = {
  MOVIMIENTOS: "MOVIMIENTOS",
  TROPAS: "TROPAS",
};

function doGet() {
  return jsonResponse({ status: "success", id: "healthcheck", action: "updated" });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const payload = JSON.parse(e.postData.contents || "{}");
    const items = Array.isArray(payload.items) ? payload.items : [];
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const results = items.map((item) => upsertItem(spreadsheet, item));
    return jsonResponse({ status: "success", results });
  } catch (error) {
    return jsonResponse({ status: "error", message: String(error.message || error) });
  } finally {
    lock.releaseLock();
  }
}

function upsertItem(spreadsheet, item) {
  if (!item || !item.id || !item.sheet || !Array.isArray(item.columns) || !Array.isArray(item.row)) {
    return { status: "error", id: item && item.id ? item.id : "", action: "invalid" };
  }

  const sheetName = item.sheet === SHEETS.TROPAS ? SHEETS.TROPAS : SHEETS.MOVIMIENTOS;
  const sheet = getOrCreateSheet(spreadsheet, sheetName, item.columns);
  const idColumn = 1;
  const rowNumber = findRowById(sheet, idColumn, item.id);
  const normalizedRow = normalizeRow(item.columns, item.row);

  if (rowNumber > 0) {
    sheet.getRange(rowNumber, 1, 1, normalizedRow.length).setValues([normalizedRow]);
    return { status: "success", id: item.id, action: "updated", queueId: item.queueId || "" };
  }

  sheet.appendRow(normalizedRow);
  return { status: "success", id: item.id, action: "inserted", queueId: item.queueId || "" };
}

function getOrCreateSheet(spreadsheet, sheetName, columns) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);

  const width = Math.max(columns.length, 1);
  const currentHeaders = sheet.getRange(1, 1, 1, width).getValues()[0];
  const hasHeaders = currentHeaders.some((value) => String(value || "").trim() !== "");
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, width).setValues([columns]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function findRowById(sheet, idColumn, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const values = sheet.getRange(2, idColumn, lastRow - 1, 1).getValues();
  const target = String(id);
  for (let index = 0; index < values.length; index += 1) {
    if (String(values[index][0]) === target) return index + 2;
  }
  return 0;
}

function normalizeRow(columns, row) {
  return columns.map((_, index) => sanitizeCell(row[index]));
}

function sanitizeCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : value;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
