const SHEETS = {
  MOVIMIENTOS: "MOVIMIENTOS",
  TROPAS: "TROPAS",
  FICHAS: "FICHAS",
};

const TIPOS_PERMITIDOS = ["COMPRA", "RECEPCION", "VENTA", "PAGO", "MUERTE"];

const MOVIMIENTO_COLUMNS = [
  "ID Movimiento", "ID Tropa", "Fecha", "Tipo", "Proveedor o Comprador", "Comisionista", "DTE", "Cantidad",
  "Peso Bruto", "Peso Tara", "Peso Neto", "Desbaste %", "Kg Pagados", "Merma Transporte Kg", "Merma Transporte %",
  "Merma Feedlot %", "Kg Reconocidos Feedlot", "Precio Kg", "IVA", "Comision", "Flete", "Costo Total Compra",
  "Importe Sin IVA Venta", "Total Facturado", "Ingreso Economico Neto", "Costo Asignado", "Resultado", "Importe Pago",
  "Forma Pago", "Kg Muerte", "Observacion", "CreatedAt", "UpdatedAt", "Operacion",
];

const TROPA_COLUMNS = [
  "ID Tropa", "Proveedor", "Fecha Creacion", "Estado", "Comprados", "Vendidos", "Muertos", "Restantes",
  "Kg Disponibles", "Costo Total Compra", "Saldo Proveedor", "Ganancia Realizada", "UpdatedAt", "Operacion",
];

function doGet() {
  return jsonResponse({ status: "success" });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const payload = parseRequestPayload(e);
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    ensureSheets(spreadsheet);
    limpiarRegistrosInvalidosActuales(spreadsheet);

    const items = Array.isArray(payload.items) ? payload.items : [];
    const results = items.map((item) => processSyncItem(spreadsheet, item));

    recalcularTropas(spreadsheet);
    regenerarFichas(spreadsheet);

    return jsonResponse({ status: "success", results });
  } catch (error) {
    return jsonResponse({ status: "error", message: String(error.message || error) });
  } finally {
    lock.releaseLock();
  }
}

function parseRequestPayload(e) {
  if (!e || !e.postData || typeof e.postData.contents !== "string") {
    throw new Error("Solicitud sin cuerpo JSON.");
  }
  const payload = JSON.parse(e.postData.contents || "{}");
  if (!payload || typeof payload !== "object") {
    throw new Error("JSON invalido.");
  }
  return payload;
}

function ensureSheets(spreadsheet) {
  getOrCreateSheet(spreadsheet, SHEETS.MOVIMIENTOS, MOVIMIENTO_COLUMNS);
  getOrCreateSheet(spreadsheet, SHEETS.TROPAS, TROPA_COLUMNS);
  getOrCreateSheet(spreadsheet, SHEETS.FICHAS, ["Campo", "Valor"]);
}

function processSyncItem(spreadsheet, item) {
  const queueId = item && item.queueId ? String(item.queueId) : "";
  const entity = normalizeEntity(item);
  const id = item && (item.entityId || item.id) ? String(item.entityId || item.id) : "";

  if (entity === "TROPA") {
    const validation = validateTropaItem(item, id);
    if (!validation.valid) return errorResult(id, queueId, validation.message);
    return { status: "success", id, action: "updated", queueId };
  }

  if (entity !== "MOVIMIENTO") {
    return errorResult(id, queueId, "Entidad de sincronizacion invalida.");
  }

  const validation = validateMovimientoItem(item);
  if (!validation.valid) return errorResult(validation.id || id, queueId, validation.message);

  return upsertMovimiento(spreadsheet, item, validation);
}

function normalizeEntity(item) {
  const explicit = String((item && (item.entity || item.entityType)) || "").trim().toUpperCase();
  if (explicit === "TROPA" || explicit === "MOVIMIENTO") return explicit;

  const sheet = String((item && item.sheet) || "").trim().toUpperCase();
  if (sheet === SHEETS.TROPAS) return "TROPA";
  if (sheet === SHEETS.MOVIMIENTOS) return "MOVIMIENTO";
  return "";
}

function validateTropaItem(item, id) {
  if (!item || typeof item !== "object") return { valid: false, message: "Item de tropa invalido." };
  if (!id) return { valid: false, message: "ID Tropa obligatorio." };
  if (!isValidTropaId(id)) return { valid: false, message: "ID Tropa invalido: " + id };
  return { valid: true };
}

function validateMovimientoItem(item) {
  if (!item || typeof item !== "object") return { valid: false, id: "", message: "Item de movimiento invalido." };
  if (!Array.isArray(item.columns) || !Array.isArray(item.row)) {
    return { valid: false, id: String(item.id || ""), message: "Movimiento sin columnas o fila." };
  }

  const values = rowToObject(item.columns, item.row);
  const id = String(item.id || values["ID Movimiento"] || "").trim();
  const tropaId = String(item.entityTropaId || values["ID Tropa"] || "").trim();
  const tipo = String(values["Tipo"] || "").trim().toUpperCase();

  if (!id) return { valid: false, id, message: "ID Movimiento obligatorio." };
  if (!tropaId) return { valid: false, id, message: "ID Tropa obligatorio para movimiento " + id };
  if (!isValidTropaId(tropaId)) return { valid: false, id, message: "ID Tropa invalido para movimiento " + id + ": " + tropaId };
  if (TIPOS_PERMITIDOS.indexOf(tipo) === -1) return { valid: false, id, message: "Tipo de movimiento invalido para " + id + ": " + tipo };

  return { valid: true, id, tropaId, tipo, values };
}

function upsertMovimiento(spreadsheet, item, validation) {
  const sheet = getOrCreateSheet(spreadsheet, SHEETS.MOVIMIENTOS, MOVIMIENTO_COLUMNS);
  const columns = getHeaders(sheet, MOVIMIENTO_COLUMNS);
  const row = normalizeRowForHeaders(columns, item.columns, item.row);
  const rowNumber = findRowById(sheet, 1, validation.id);

  if (rowNumber > 0) {
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    return { status: "success", id: validation.id, action: "updated", queueId: item.queueId || "" };
  }

  sheet.appendRow(row);
  return { status: "success", id: validation.id, action: "inserted", queueId: item.queueId || "" };
}

function errorResult(id, queueId, message) {
  return {
    status: "error",
    id: id || "",
    action: "invalid",
    queueId: queueId || "",
    message: message || "Item invalido.",
  };
}

function limpiarRegistrosInvalidosActuales(spreadsheet) {
  const sheet = getOrCreateSheet(spreadsheet, SHEETS.MOVIMIENTOS, MOVIMIENTO_COLUMNS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), MOVIMIENTO_COLUMNS.length)).getValues();
  for (let index = data.length - 1; index >= 0; index -= 1) {
    const row = data[index];
    const idMovimiento = String(row[0] || "").trim();
    const idTropa = String(row[1] || "").trim();
    if (idMovimiento === "TR-0001" && idTropa.toLowerCase() === "asd") {
      sheet.deleteRow(index + 2);
    }
  }
}

function recalcularTropas(spreadsheet) {
  const movimientosSheet = getOrCreateSheet(spreadsheet, SHEETS.MOVIMIENTOS, MOVIMIENTO_COLUMNS);
  const tropasSheet = getOrCreateSheet(spreadsheet, SHEETS.TROPAS, TROPA_COLUMNS);
  const movimientos = readMovimientosValidos(movimientosSheet);
  const resumenes = buildResumenes(movimientos);
  const rows = resumenes.map((resumen) => rowFromObject(TROPA_COLUMNS, {
    "ID Tropa": resumen.id,
    "Proveedor": resumen.proveedor,
    "Fecha Creacion": resumen.fechaCompra,
    "Estado": resumen.estado,
    "Comprados": resumen.comprados,
    "Vendidos": resumen.vendidos,
    "Muertos": resumen.muertos,
    "Restantes": resumen.restantes,
    "Kg Disponibles": resumen.kgDisponibles,
    "Costo Total Compra": resumen.costoTotalCompra,
    "Saldo Proveedor": resumen.saldoProveedor,
    "Ganancia Realizada": resumen.gananciaRealizada,
    "UpdatedAt": resumen.updatedAt,
    "Operacion": "RECALCULADA",
  }));

  tropasSheet.clear();
  tropasSheet.getRange(1, 1, 1, TROPA_COLUMNS.length).setValues([TROPA_COLUMNS]);
  tropasSheet.setFrozenRows(1);
  if (rows.length > 0) tropasSheet.getRange(2, 1, rows.length, TROPA_COLUMNS.length).setValues(rows);
  formatTropasSheet(tropasSheet);
}

function regenerarFichas(spreadsheet) {
  const movimientosSheet = getOrCreateSheet(spreadsheet, SHEETS.MOVIMIENTOS, MOVIMIENTO_COLUMNS);
  const fichasSheet = getOrCreateSheet(spreadsheet, SHEETS.FICHAS, ["Campo", "Valor"]);
  const movimientos = readMovimientosValidos(movimientosSheet);
  const resumenes = buildResumenes(movimientos);

  fichasSheet.getRange(1, 1, fichasSheet.getMaxRows(), fichasSheet.getMaxColumns()).breakApart();
  fichasSheet.clear();
  fichasSheet.setColumnWidths(1, 1, 190);
  fichasSheet.setColumnWidths(2, 1, 230);

  let row = 1;
  resumenes.forEach((resumen) => {
    row = writeFichaTropa(fichasSheet, row, resumen);
    row += 3;
  });
}

function writeFichaTropa(sheet, row, resumen) {
  const title = "TROPA " + resumen.id;
  sheet.getRange(row, 1, 1, 2).merge().setValue(title);
  sheet.getRange(row, 1, 1, 2).setBackground("#1f4d2b").setFontColor("#ffffff").setFontWeight("bold");
  row += 2;

  row = writeSection(sheet, row, "RESUMEN", [
    ["Proveedor", resumen.proveedor],
    ["Fecha de compra", resumen.fechaCompra],
    ["Estado", resumen.estado],
    ["Comprados", resumen.comprados],
    ["Vendidos", resumen.vendidos],
    ["Muertos", resumen.muertos],
    ["Restantes", resumen.restantes],
    ["Kg disponibles", resumen.kgDisponibles, "kg"],
    ["Costo total compra", resumen.costoTotalCompra, "money"],
    ["Pagado", resumen.pagado, "money"],
    ["Saldo proveedor", resumen.saldoProveedor, "money"],
    ["Ganancia realizada", resumen.gananciaRealizada, "money"],
  ]);

  row = writeMovimientoSection(sheet, row, "COMPRA", resumen.movimientos.filter((m) => m.tipo === "COMPRA"));
  row = writeMovimientoSection(sheet, row, "RECEPCION", resumen.movimientos.filter((m) => m.tipo === "RECEPCION"));
  row = writeMovimientoSection(sheet, row, "VENTAS", resumen.movimientos.filter((m) => m.tipo === "VENTA"));
  row = writeMovimientoSection(sheet, row, "PAGOS", resumen.movimientos.filter((m) => m.tipo === "PAGO"));
  row = writeMovimientoSection(sheet, row, "MUERTES", resumen.movimientos.filter((m) => m.tipo === "MUERTE"));

  return row;
}

function writeMovimientoSection(sheet, row, title, movimientos) {
  if (movimientos.length === 0) return row;
  movimientos.forEach((movimiento, index) => {
    const suffix = movimientos.length > 1 ? " " + (index + 1) : "";
    row = writeSection(sheet, row, title + suffix, fichaRowsForMovimiento(movimiento));
  });
  return row;
}

function writeSection(sheet, row, title, entries) {
  sheet.getRange(row, 1, 1, 2).merge().setValue(title);
  sheet.getRange(row, 1, 1, 2).setFontWeight("bold").setBackground("#d9ead3").setFontColor("#1f4d2b");
  row += 1;

  entries.forEach((entry) => {
    sheet.getRange(row, 1).setValue(entry[0]).setFontWeight("bold");
    const cell = sheet.getRange(row, 2).setValue(normalizeFichaValue(entry[1], entry[2]));
    applyFichaFormat(cell, entry[2]);
    row += 1;
  });

  return row + 1;
}

function fichaRowsForMovimiento(movimiento) {
  if (movimiento.tipo === "COMPRA") {
    return [
      ["Fecha", movimiento.fecha, "date"],
      ["Proveedor", movimiento.proveedorComprador],
      ["Comisionista", movimiento.comisionista],
      ["DTE", movimiento.dte],
      ["Cantidad", movimiento.cantidad],
      ["Peso bruto", movimiento.pesoBruto, "kg"],
      ["Peso tara", movimiento.pesoTara, "kg"],
      ["Peso neto", movimiento.pesoNeto, "kg"],
      ["Desbaste", movimiento.desbastePct, "percentPlain"],
      ["Kg pagados", movimiento.kgPagados, "kg"],
      ["Precio por kg", movimiento.precioKg, "money"],
      ["IVA", movimiento.iva, "money"],
      ["Comision", movimiento.comision, "money"],
      ["Flete", movimiento.flete, "money"],
      ["Costo total compra", movimiento.costoTotalCompra, "money"],
    ];
  }

  if (movimiento.tipo === "RECEPCION") {
    return [
      ["Fecha", movimiento.fecha, "date"],
      ["Peso bruto llegada", movimiento.pesoBruto, "kg"],
      ["Peso tara llegada", movimiento.pesoTara, "kg"],
      ["Peso neto llegada", movimiento.pesoNeto, "kg"],
      ["Merma transporte kg", movimiento.mermaTransporteKg, "kg"],
      ["Merma transporte %", movimiento.mermaTransportePct, "percentPlain"],
      ["Merma Feedlot %", movimiento.mermaFeedlotPct, "percentPlain"],
      ["Kg reconocidos", movimiento.kgReconocidosFeedlot, "kg"],
    ];
  }

  if (movimiento.tipo === "VENTA") {
    return [
      ["Fecha", movimiento.fecha, "date"],
      ["Comprador", movimiento.proveedorComprador],
      ["Cantidad", movimiento.cantidad],
      ["Kg vendidos", movimiento.pesoNeto, "kg"],
      ["Precio kg", movimiento.precioKg, "money"],
      ["Importe sin IVA", movimiento.importeSinIvaVenta, "money"],
      ["Total facturado", movimiento.totalFacturado, "money"],
      ["Ingreso economico neto", movimiento.ingresoEconomicoNeto, "money"],
      ["Costo asignado", movimiento.costoAsignado, "money"],
      ["Resultado", movimiento.resultado, "money"],
    ];
  }

  if (movimiento.tipo === "PAGO") {
    return [
      ["Fecha", movimiento.fecha, "date"],
      ["Importe pago", movimiento.importePago, "money"],
      ["Forma pago", movimiento.formaPago],
      ["Observacion", movimiento.observacion],
    ];
  }

  return [
    ["Fecha", movimiento.fecha, "date"],
    ["Cantidad", movimiento.cantidad],
    ["Kg muerte", movimiento.kgMuerte, "kg"],
    ["Observacion", movimiento.observacion],
  ];
}

function readMovimientosValidos(sheet) {
  const headers = getHeaders(sheet, MOVIMIENTO_COLUMNS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map((row) => movimientoFromRow(headers, row))
    .filter((movimiento) => movimiento.id && isValidTropaId(movimiento.tropaId) && TIPOS_PERMITIDOS.indexOf(movimiento.tipo) !== -1 && movimiento.operacion !== "DELETED");
}

function movimientoFromRow(headers, row) {
  const obj = rowToObject(headers, row);
  return {
    id: stringField(obj, "ID Movimiento"),
    tropaId: stringField(obj, "ID Tropa"),
    fecha: obj["Fecha"] || "",
    tipo: stringField(obj, "Tipo").toUpperCase(),
    proveedorComprador: stringField(obj, "Proveedor o Comprador"),
    comisionista: stringField(obj, "Comisionista"),
    dte: stringField(obj, "DTE"),
    cantidad: numberField(obj, "Cantidad"),
    pesoBruto: numberField(obj, "Peso Bruto"),
    pesoTara: numberField(obj, "Peso Tara"),
    pesoNeto: numberField(obj, "Peso Neto"),
    desbastePct: numberField(obj, "Desbaste %"),
    kgPagados: numberField(obj, "Kg Pagados"),
    mermaTransporteKg: numberField(obj, "Merma Transporte Kg"),
    mermaTransportePct: numberField(obj, "Merma Transporte %"),
    mermaFeedlotPct: numberField(obj, "Merma Feedlot %"),
    kgReconocidosFeedlot: numberField(obj, "Kg Reconocidos Feedlot"),
    precioKg: numberField(obj, "Precio Kg"),
    iva: numberField(obj, "IVA"),
    comision: numberField(obj, "Comision"),
    flete: numberField(obj, "Flete"),
    costoTotalCompra: numberField(obj, "Costo Total Compra"),
    importeSinIvaVenta: numberField(obj, "Importe Sin IVA Venta"),
    totalFacturado: numberField(obj, "Total Facturado"),
    ingresoEconomicoNeto: numberField(obj, "Ingreso Economico Neto"),
    costoAsignado: numberField(obj, "Costo Asignado"),
    resultado: numberField(obj, "Resultado"),
    importePago: numberField(obj, "Importe Pago"),
    formaPago: stringField(obj, "Forma Pago"),
    kgMuerte: numberField(obj, "Kg Muerte"),
    observacion: stringField(obj, "Observacion"),
    createdAt: obj["CreatedAt"] || "",
    updatedAt: obj["UpdatedAt"] || "",
    operacion: stringField(obj, "Operacion").toUpperCase(),
  };
}

function buildResumenes(movimientos) {
  const byTropa = {};
  movimientos.forEach((movimiento) => {
    if (!byTropa[movimiento.tropaId]) byTropa[movimiento.tropaId] = createResumen(movimiento.tropaId);
    applyMovimientoToResumen(byTropa[movimiento.tropaId], movimiento);
  });

  return Object.keys(byTropa).sort().map((id) => finalizeResumen(byTropa[id]));
}

function createResumen(id) {
  return {
    id,
    proveedor: "",
    fechaCompra: "",
    estado: "ABIERTA",
    comprados: 0,
    vendidos: 0,
    muertos: 0,
    restantes: 0,
    kgCompra: 0,
    kgRecepcion: 0,
    kgVendidos: 0,
    kgMuertos: 0,
    kgDisponibles: 0,
    costoTotalCompra: 0,
    pagado: 0,
    saldoProveedor: 0,
    gananciaRealizada: 0,
    updatedAt: "",
    movimientos: [],
  };
}

function applyMovimientoToResumen(resumen, movimiento) {
  resumen.movimientos.push(movimiento);
  resumen.updatedAt = maxString(resumen.updatedAt, movimiento.updatedAt || movimiento.createdAt || "");

  if (movimiento.tipo === "COMPRA") {
    resumen.proveedor = resumen.proveedor || movimiento.proveedorComprador;
    resumen.fechaCompra = resumen.fechaCompra || movimiento.fecha;
    resumen.comprados += movimiento.cantidad || 0;
    resumen.kgCompra += movimiento.kgPagados || movimiento.pesoNeto || 0;
    resumen.costoTotalCompra += movimiento.costoTotalCompra || 0;
  } else if (movimiento.tipo === "RECEPCION") {
    resumen.kgRecepcion = movimiento.kgReconocidosFeedlot || movimiento.pesoNeto || resumen.kgRecepcion;
  } else if (movimiento.tipo === "VENTA") {
    resumen.vendidos += movimiento.cantidad || 0;
    resumen.kgVendidos += movimiento.pesoNeto || 0;
    resumen.gananciaRealizada += movimiento.resultado || 0;
  } else if (movimiento.tipo === "PAGO") {
    resumen.pagado += movimiento.importePago || 0;
  } else if (movimiento.tipo === "MUERTE") {
    resumen.muertos += movimiento.cantidad || 0;
    resumen.kgMuertos += movimiento.kgMuerte || 0;
  }
}

function finalizeResumen(resumen) {
  resumen.movimientos.sort((a, b) => String(a.fecha || a.createdAt).localeCompare(String(b.fecha || b.createdAt)));
  resumen.restantes = resumen.comprados - resumen.vendidos - resumen.muertos;
  const baseKg = resumen.kgRecepcion || resumen.kgCompra;
  resumen.kgDisponibles = baseKg - resumen.kgVendidos - resumen.kgMuertos;
  resumen.saldoProveedor = resumen.costoTotalCompra - resumen.pagado;
  if (resumen.comprados > 0 && resumen.restantes <= 0) {
    resumen.estado = "FINALIZADA";
  } else if (resumen.kgRecepcion > 0) {
    resumen.estado = "EN FEEDLOT";
  } else if (resumen.comprados > 0) {
    resumen.estado = "COMPRADA";
  }
  return resumen;
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

function getHeaders(sheet, fallback) {
  const width = Math.max(sheet.getLastColumn(), fallback.length, 1);
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0].map((value) => normalizeHeader(value));
  const hasHeaders = headers.some((value) => value);
  return hasHeaders ? headers : fallback.slice();
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

function normalizeRowForHeaders(targetColumns, sourceColumns, sourceRow) {
  const source = rowToObject(sourceColumns, sourceRow);
  return targetColumns.map((column) => sanitizeCell(source[column]));
}

function rowFromObject(columns, values) {
  return columns.map((column) => sanitizeCell(values[column]));
}

function rowToObject(columns, row) {
  const obj = {};
  columns.forEach((column, index) => {
    obj[normalizeHeader(column)] = row[index];
  });
  return obj;
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Comisi.n/g, "Comision")
    .replace(/Econ.mico/g, "Economico")
    .replace(/Observaci.n/g, "Observacion")
    .replace(/Operaci.n/g, "Operacion")
    .replace(/Creaci.n/g, "Creacion")
    .trim();
}

function isValidTropaId(value) {
  return /^TR-/.test(String(value || "").trim());
}

function stringField(obj, key) {
  return String(obj[key] === null || obj[key] === undefined ? "" : obj[key]).trim();
}

function numberField(obj, key) {
  const value = obj[key];
  if (typeof value === "number") return value;
  const normalized = String(value || "").replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function maxString(a, b) {
  return String(a || "") > String(b || "") ? a : b;
}

function sanitizeCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" && /^[=+\-@]/.test(value)) return "'" + value;
  return value;
}

function normalizeFichaValue(value, type) {
  if (type === "date") return toDateValue(value);
  return value === null || value === undefined ? "" : value;
}

function toDateValue(value) {
  if (!value) return "";
  if (Object.prototype.toString.call(value) === "[object Date]") return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date;
}

function applyFichaFormat(range, type) {
  if (type === "money") range.setNumberFormat('$ #,##0.00');
  if (type === "kg") range.setNumberFormat('#,##0.##');
  if (type === "percentPlain") range.setNumberFormat('0.00');
  if (type === "date") range.setNumberFormat('dd/mm/yyyy');
}

function formatTropasSheet(sheet) {
  sheet.getRange(1, 1, 1, TROPA_COLUMNS.length).setFontWeight("bold");
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 10, sheet.getLastRow() - 1, 3).setNumberFormat('$ #,##0.00');
    sheet.getRange(2, 9, sheet.getLastRow() - 1, 1).setNumberFormat('#,##0.##');
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
