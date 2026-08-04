import {
  abrirBase,
  respaldarLocalStorageLegacy,
  crearTropa,
  obtenerSiguienteIdSugerido,
  actualizarTropa,
  obtenerTropas,
  obtenerTropa,
  obtenerConfig,
  guardarConfig,
  obtenerSyncQueue,
  eliminarSyncTask,
  registrarSyncError,
  contarSyncPendientes,
  guardarMovimiento,
  editarMovimiento,
  eliminarMovimiento,
  obtenerMovimientosPorTropa,
  eliminarTropa,
  obtenerDatosCompletos,
  reemplazarDatos,
  combinarDatos,
  limpiarDatosConRespaldoInterno,
} from "./db.js";
import {
  calcularCompra,
  calcularRecepcion,
  calcularVenta,
  calcularMuerte,
  calcularResumenTropa,
  calcularDiasFeedlot,
  fmt,
  fmt2,
  toNumber,
} from "./calculations.js";

const SCHEMA_VERSION = 1;
const MOVIMIENTO_TIPOS = ["COMPRA", "RECEPCION", "VENTA", "PAGO", "MUERTE"];
const SYNC_ENDPOINT_KEY = "googleSheetsSyncEndpoint";
const SYNC_SHEET_URL_KEY = "googleSheetsUrl";
const LAST_SYNC_KEY = "googleSheetsLastSyncAt";

const state = {
  activeTropaId: "",
  tropas: [],
  movimientos: new Map(),
  editing: null,
  syncing: false,
  sync: {
    endpointUrl: "",
    sheetUrl: "",
    pending: 0,
    lastSyncAt: "",
  },
  modes: {
    cIvaModo: "SIN_IVA",
    cComisionModo: "PORCENTAJE",
    vIvaModo: "SIN_IVA",
  },
};

function $(id) {
  return document.getElementById(id);
}

function text(id, value) {
  const el = $(id);
  if (el) el.innerText = value;
}

function money(value) {
  return `$ ${fmt(value)}`;
}

function timestampForFilename(includeTime = true) {
  const d = new Date();
  const date = d.toISOString().slice(0, 10);
  if (!includeTime) return date;
  const time = d.toTimeString().slice(0, 5).replace(":", "-");
  return `${date}_${time}`;
}

function downloadTextFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  let textValue = String(value).replace(/\r?\n|\r/g, " ");
  if (/^[=+\-@]/.test(textValue)) textValue = `'${textValue}`;
  return `"${textValue.replace(/"/g, '""')}"`;
}

function csvLine(values) {
  return values.map(csvValue).join(";");
}

function calcForMovimiento(movimiento, resumen) {
  if (movimiento.tipo === "COMPRA") return calcularCompra(movimiento.datos);
  if (movimiento.tipo === "RECEPCION") return calcularRecepcion(movimiento.datos, resumen);
  if (movimiento.tipo === "VENTA") return calcularVenta(movimiento.datos, resumen);
  if (movimiento.tipo === "MUERTE") return calcularMuerte(movimiento.datos, resumen);
  return {};
}

const MOVIMIENTO_COLUMNS = [
  "ID Movimiento", "ID Tropa", "Fecha", "Tipo", "Proveedor o Comprador", "Comisionista", "DTE", "Cantidad",
  "Peso Bruto", "Peso Tara", "Peso Neto", "Desbaste %", "Kg Pagados", "Merma Transporte Kg", "Merma Transporte %",
  "Merma Feedlot %", "Kg Reconocidos Feedlot", "Precio Kg", "IVA", "Comisión", "Flete", "Costo Total Compra",
  "Importe Sin IVA Venta", "Total Facturado", "Ingreso Económico Neto", "Costo Asignado", "Resultado", "Importe Pago",
  "Forma Pago", "Kg Muerte", "Observación", "CreatedAt", "UpdatedAt", "Operación",
];

const TROPA_COLUMNS = [
  "ID Tropa", "Proveedor", "Fecha Creación", "Estado", "Comprados", "Vendidos", "Muertos", "Restantes",
  "Kg Disponibles", "Costo Total Compra", "Saldo Proveedor", "Costo Muertes", "Perdida Muertes",
  "Resultado Ventas", "Resultado Total", "Ganancia Realizada", "UpdatedAt", "Operación",
];

function rowFromObject(columns, values) {
  return columns.map((column) => values[column] ?? "");
}

function movimientoSheetRow(movimiento, operation = "UPDATED") {
  const datos = movimiento.payload?.datos || movimiento.datos || {};
  const rawMovimiento = movimiento.payload || movimiento;
  const resumen = resumenDe(rawMovimiento.tropaId);
  const calc = rawMovimiento.tipo === "COMPRA"
    ? calcularCompra(datos)
    : rawMovimiento.tipo === "RECEPCION"
      ? calcularRecepcion(datos, resumen)
      : rawMovimiento.tipo === "VENTA"
        ? calcularVenta(datos, resumen)
        : rawMovimiento.tipo === "MUERTE"
          ? calcularMuerte(datos, resumen)
          : {};

  return rowFromObject(MOVIMIENTO_COLUMNS, {
    "ID Movimiento": rawMovimiento.id,
    "ID Tropa": rawMovimiento.tropaId,
    "Fecha": rawMovimiento.fecha || datos.fecha || "",
    "Tipo": rawMovimiento.tipo,
    "Proveedor o Comprador": datos.proveedor || datos.comprador || "",
    "Comisionista": datos.comisionista || "",
    "DTE": datos.dte || "",
    "Cantidad": datos.animales || datos.cantidad || "",
    "Peso Bruto": datos.pesoBruto || datos.pesoBrutoLlegada || "",
    "Peso Tara": datos.pesoTara || datos.pesoTaraLlegada || "",
    "Peso Neto": calc.pesoNetoOrigen || calc.pesoNetoLlegada || calc.kgVendidos || "",
    "Desbaste %": datos.desbastePct || "",
    "Kg Pagados": calc.kgPagados || "",
    "Merma Transporte Kg": calc.mermaTransporteKg || "",
    "Merma Transporte %": calc.mermaTransportePct || "",
    "Merma Feedlot %": datos.mermaFeedlotPct || calc.mermaFeedlotPct || "",
    "Kg Reconocidos Feedlot": calc.kgReconocidosFeedlot || "",
    "Precio Kg": datos.precioKg || "",
    "IVA": calc.ivaCompra || calc.ivaVenta || "",
    "Comisión": calc.comisionCompra || datos.comisionVenta || "",
    "Flete": datos.flete || "",
    "Costo Total Compra": calc.costoTotalCompra || "",
    "Importe Sin IVA Venta": calc.importeSinIva || "",
    "Total Facturado": calc.totalFacturado || "",
    "Ingreso Económico Neto": calc.ingresoEconomicoNeto || "",
    "Costo Asignado": calc.costoAsignado || "",
    "Resultado": calc.resultadoVenta || "",
    "Importe Pago": datos.importe || "",
    "Forma Pago": datos.forma || "",
    "Kg Muerte": calc.kgDescontados || "",
    "Observación": datos.observacion || "",
    "CreatedAt": rawMovimiento.createdAt || "",
    "UpdatedAt": rawMovimiento.updatedAt || "",
    "Operación": operation,
  });
}

function tropaSheetRow(tropa, operation = "UPDATED") {
  const rawTropa = tropa.payload || tropa;
  const resumen = operation === "DELETED" ? {} : resumenDe(rawTropa.id);
  return rowFromObject(TROPA_COLUMNS, {
    "ID Tropa": rawTropa.id,
    "Proveedor": resumen.proveedor || rawTropa.proveedor || "",
    "Fecha Creación": rawTropa.fechaCreacion || "",
    "Estado": operation === "DELETED" ? "ELIMINADA" : (resumen.estado || rawTropa.estado || ""),
    "Comprados": resumen.comprados || "",
    "Vendidos": resumen.vendidos || "",
    "Muertos": resumen.muertos || "",
    "Restantes": resumen.restantes ?? "",
    "Kg Disponibles": resumen.kgDisponibles ?? "",
    "Costo Total Compra": resumen.costoTotalCompra || "",
    "Saldo Proveedor": resumen.saldoProveedor || "",
    "Costo Muertes": resumen.costoMuertes || "",
    "Perdida Muertes": resumen.perdidaMuertes || "",
    "Resultado Ventas": resumen.resultadoVentas || "",
    "Resultado Total": resumen.resultadoTotal || "",
    "Ganancia Realizada": resumen.gananciaRealizada || "",
    "UpdatedAt": rawTropa.updatedAt || "",
    "Operación": operation,
  });
}

const ICONS = {
  bag: '<svg viewBox="0 0 24 24"><path d="M6 8h12l-1 12H7L6 8Z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>',
  truck: '<svg viewBox="0 0 24 24"><path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  tag: '<svg viewBox="0 0 24 24"><path d="M20 13 11 4H4v7l9 9 7-7Z"/><circle cx="8" cy="8" r="1"/></svg>',
  wallet: '<svg viewBox="0 0 24 24"><path d="M4 7h15a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h14"/><path d="M16 13h5"/></svg>',
  "heart-off": '<svg viewBox="0 0 24 24"><path d="m3 3 18 18"/><path d="M19.5 12.5 12 20l-7.5-7.5a5 5 0 0 1 7-7l.5.5.5-.5a5 5 0 0 1 7 7Z"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>',
  export: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 15v4h14v-4"/></svg>',
  import: '<svg viewBox="0 0 24 24"><path d="M12 21V9"/><path d="m7 16 5 5 5-5"/><path d="M5 9V5h14v4"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path d="M17.5 19H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20 12.5 3.5 3.5 0 0 1 17.5 19Z"/><path d="M12 11v5"/><path d="m9.5 13.5 2.5-2.5 2.5 2.5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
  "circle-x": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/></svg>',
  dollar: '<svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M17 7.5A4 4 0 0 0 12 6c-3 0-4.5 1.2-4.5 3s1.5 2.7 4.5 3 4.5 1.2 4.5 3-1.5 3-4.5 3a5 5 0 0 1-5-2"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5"/><path d="M12 16V8"/><path d="M16 16v-3"/></svg>',
};

function icon(name) {
  return `<span class="icon">${ICONS[name] || ""}</span>`;
}

function renderIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.classList.add("icon");
    el.innerHTML = ICONS[el.dataset.icon] || "";
  });
}

let toastTimer;

function showToast(message, ok = true) {
  const toast = $("toast");
  if (!toast) return;
  toast.innerHTML = `${icon(ok ? "check" : "circle-x")} ${message}`;
  toast.classList.add("active");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("active"), 2000);
}

function kg(value) {
  return `${fmt(value)} kg`;
}

function getSelectedTropaId(kind) {
  const selectId = `${kind}TropaId`;
  return $(selectId)?.value || state.activeTropaId || "";
}

function movimientosDe(tropaId) {
  return state.movimientos.get(tropaId) || [];
}

function resumenDe(tropaId, extraMovimientos = null) {
  const tropa = state.tropas.find((item) => item.id === tropaId) || null;
  return calcularResumenTropa(tropa, extraMovimientos || movimientosDe(tropaId));
}

function readValue(id) {
  return $(id)?.value ?? "";
}

function normalizeTropaId(value) {
  return String(value || "").trim().toUpperCase();
}

function setValue(id, value) {
  const el = $(id);
  if (el) el.value = value ?? "";
}

function setErrors(id, errors) {
  const box = $(id);
  if (!box) return;
  box.innerText = errors.join(" ");
  box.classList.toggle("active", errors.length > 0);
}

function clearErrors() {
  ["compraErrores", "recepcionErrores", "ventaErrores", "pagoErrores", "muerteErrores"].forEach((id) => setErrors(id, []));
}

function showHistorialMessage(messages) {
  setErrors("historialErrores", Array.isArray(messages) ? messages : [messages]);
}

function setButtonText(id, value) {
  const button = $(id);
  if (button) button.innerHTML = `${icon("check")} ${value}`;
}

function setCompraIdEditable(editable) {
  const input = $("loteId");
  if (input) input.readOnly = !editable;
}

function switchTab(tabId, btnEl = null) {
  document.querySelectorAll(".tab-content").forEach((tab) => tab.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach((button) => button.classList.remove("active"));
  $(`tab-${tabId}`).classList.add("active");
  const button = btnEl || document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (button) button.classList.add("active");
  if (tabId === "historial") renderHistorial();
}

function setMode(group, value) {
  state.modes[group] = value;
  document.querySelectorAll(`[data-toggle-group="${group}"]`).forEach((button) => {
    button.classList.toggle("active", button.dataset.toggleValue === value);
  });

  if (group === "cIvaModo") {
    $("cBoxIvaPct").style.display = value === "PORCENTAJE" ? "block" : "none";
    $("cBoxIvaMonto").style.display = value === "MONTO" ? "block" : "none";
  }
  if (group === "cComisionModo") {
    $("cBoxComisionPct").style.display = value === "PORCENTAJE" ? "block" : "none";
    $("cBoxComisionMonto").style.display = value === "MONTO" ? "block" : "none";
  }
  if (group === "vIvaModo") {
    $("vBoxIvaPct").style.display = value === "PORCENTAJE" ? "block" : "none";
    $("vBoxIvaMonto").style.display = value === "MONTO" ? "block" : "none";
  }

  renderPreviews();
}

function compraDatos() {
  return {
    tropaId: normalizeTropaId(readValue("loteId")),
    fecha: readValue("cFecha"),
    proveedor: readValue("cProveedor").trim(),
    comisionista: readValue("cComisionista").trim(),
    animales: toNumber(readValue("cAnimales")),
    dte: readValue("cDte").trim(),
    pesoBruto: toNumber(readValue("cPesoBruto")),
    pesoTara: toNumber(readValue("cPesoTara")),
    desbastePct: toNumber(readValue("cDesbastePct")),
    precioKg: toNumber(readValue("cPrecioKg")),
    ivaModo: state.modes.cIvaModo,
    ivaPct: toNumber(readValue("cIvaPct")),
    ivaMonto: toNumber(readValue("cIvaMonto")),
    comisionModo: state.modes.cComisionModo,
    comisionPct: toNumber(readValue("cComisionPct")),
    comisionMonto: toNumber(readValue("cComisionMonto")),
    flete: toNumber(readValue("cFlete")),
    observacion: readValue("cObservacion").trim(),
  };
}

function recepcionDatos() {
  return {
    fecha: readValue("dFecha"),
    pesoBrutoLlegada: toNumber(readValue("dPesoBrutoLlegada")),
    pesoTaraLlegada: toNumber(readValue("dPesoTaraLlegada")),
    mermaFeedlotPct: toNumber(readValue("dMermaFeedlotPct")),
  };
}

function ventaDatos() {
  return {
    fecha: readValue("vFecha"),
    comprador: readValue("vComprador").trim(),
    animales: toNumber(readValue("vAnimales")),
    pesoBruto: toNumber(readValue("vPesoBruto")),
    pesoTara: toNumber(readValue("vPesoTara")),
    precioKg: toNumber(readValue("vPrecioKg")),
    ivaModo: state.modes.vIvaModo,
    ivaPct: toNumber(readValue("vIvaPct")),
    ivaMonto: toNumber(readValue("vIvaMonto")),
    comisionVenta: toNumber(readValue("vComisionVenta")),
    flete: toNumber(readValue("vFlete")),
    observacion: readValue("vObservacion").trim(),
  };
}

function pagoDatos() {
  return {
    fecha: readValue("pFecha"),
    importe: toNumber(readValue("pImporte")),
    forma: readValue("pForma"),
    observacion: readValue("pObservacion").trim(),
  };
}

function muerteDatos() {
  return {
    fecha: readValue("mFecha"),
    cantidad: toNumber(readValue("mCantidad")),
    modo: readValue("mModo"),
    kgDescontados: toNumber(readValue("mKgDescontados")),
  };
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function validateRequiredDate(value, label, errors) {
  if (!value) errors.push(`${label} es obligatoria.`);
}

function validatePct(value, label, errors) {
  if (!isFiniteNumber(value) || value < 0 || value > 100) errors.push(`${label} debe estar entre 0 y 100.`);
}

function validatePctLessThan100(value, label, errors) {
  if (!isFiniteNumber(value) || value < 0 || value >= 100) errors.push(`${label} debe ser mayor o igual a 0 y menor que 100.`);
}

function validateNonNegative(value, label, errors) {
  if (!isFiniteNumber(value) || value < 0) errors.push(`${label} debe ser un número no negativo.`);
}

function validatePositive(value, label, errors) {
  if (!isFiniteNumber(value) || value <= 0) errors.push(`${label} debe ser mayor que cero.`);
}

function validatePositiveInteger(value, label, errors) {
  if (!Number.isInteger(Number(value)) || Number(value) <= 0) errors.push(`${label} debe ser un entero positivo.`);
}

function validateCompra(datos, editingMovimiento = null) {
  const errors = [];
  if (!datos.tropaId) errors.push("ID Lote / Tropa es obligatorio.");
  const existing = state.tropas.find((tropa) => tropa.id === datos.tropaId);
  if (!editingMovimiento && existing) errors.push("Ya existe otra tropa con ese ID.");
  validateRequiredDate(datos.fecha, "La fecha de compra", errors);
  if (!datos.proveedor) errors.push("Proveedor es obligatorio.");
  if (!datos.comisionista) errors.push("Comisionista es obligatorio.");
  validatePositiveInteger(datos.animales, "Cantidad de animales", errors);
  validatePositive(datos.pesoBruto, "Peso bruto", errors);
  validateNonNegative(datos.pesoTara, "Peso tara", errors);
  if (datos.pesoBruto <= datos.pesoTara) errors.push("Peso bruto debe ser mayor que tara.");
  validatePct(datos.desbastePct, "Desbaste", errors);
  validatePositive(datos.precioKg, "Precio por kg", errors);
  validateNonNegative(datos.flete, "Flete", errors);
  if (datos.ivaModo === "PORCENTAJE") validatePct(datos.ivaPct, "IVA", errors);
  if (datos.ivaModo === "MONTO") validateNonNegative(datos.ivaMonto, "Monto IVA", errors);
  if (datos.comisionModo === "PORCENTAJE") validatePct(datos.comisionPct, "Comisión", errors);
  if (datos.comisionModo === "MONTO") validateNonNegative(datos.comisionMonto, "Comisión fija", errors);

  if (editingMovimiento) {
    const movs = movimientosDe(editingMovimiento.tropaId);
    const duplicate = movs.some((mov) => mov.tipo === "COMPRA" && mov.id !== editingMovimiento.id);
    if (duplicate) errors.push("La tropa ya tiene una compra inicial.");
  }

  return errors;
}

function validateRecepcion(tropaId, datos, editingMovimiento = null) {
  const errors = [];
  if (!tropaId) errors.push("Debe seleccionar una tropa.");
  validateRequiredDate(datos.fecha, "La fecha de recepción", errors);
  validatePositive(datos.pesoBrutoLlegada, "Peso bruto llegada", errors);
  validateNonNegative(datos.pesoTaraLlegada, "Peso tara llegada", errors);
  if (datos.pesoBrutoLlegada <= datos.pesoTaraLlegada) errors.push("Peso bruto llegada debe ser mayor que tara.");
  validatePctLessThan100(datos.mermaFeedlotPct, "Merma Feedlot", errors);

  const movs = movimientosDe(tropaId);
  if (!movs.some((mov) => mov.tipo === "COMPRA")) errors.push("No se puede guardar recepción sin compra.");
  const existing = movs.find((mov) => mov.tipo === "RECEPCION");
  if (existing && existing.id !== editingMovimiento?.id) errors.push("La tropa ya tiene una recepción activa. Usá Editar.");

  return errors;
}

function validateVenta(tropaId, datos, editingMovimiento = null) {
  const errors = [];
  if (!tropaId) errors.push("Debe seleccionar una tropa.");
  validateRequiredDate(datos.fecha, "La fecha de venta", errors);
  if (!datos.comprador) errors.push("Comprador es obligatorio.");
  validatePositiveInteger(datos.animales, "Cantidad de animales", errors);
  validatePositive(datos.pesoBruto, "Peso bruto", errors);
  validateNonNegative(datos.pesoTara, "Peso tara", errors);
  if (datos.pesoBruto <= datos.pesoTara) errors.push("Peso bruto debe ser mayor que tara.");
  validatePositive(datos.precioKg, "Precio por kg", errors);
  validateNonNegative(datos.comisionVenta, "Comisión venta", errors);
  validateNonNegative(datos.flete, "Flete", errors);
  if (datos.ivaModo === "PORCENTAJE") validatePct(datos.ivaPct, "IVA venta", errors);
  if (datos.ivaModo === "MONTO") validateNonNegative(datos.ivaMonto, "Monto IVA venta", errors);

  const movs = movimientosDe(tropaId);
  if (!movs.some((mov) => mov.tipo === "COMPRA")) errors.push("No se puede guardar venta sin compra.");
  if (!movs.some((mov) => mov.tipo === "RECEPCION")) errors.push("No se puede guardar venta sin recepción.");

  const baseMovs = editingMovimiento ? movs.filter((mov) => mov.id !== editingMovimiento.id) : movs;
  const resumen = resumenDe(tropaId, baseMovs);
  const ventaCalc = calcularVenta(datos, resumen);
  if (datos.animales > resumen.restantes) errors.push("No se puede vender más animales que los disponibles.");
  if (ventaCalc.kgVendidos > resumen.kgDisponibles) errors.push("No se puede vender más kg que los disponibles.");

  return errors;
}

function validatePago(tropaId, datos) {
  const errors = [];
  if (!tropaId) errors.push("Debe seleccionar una tropa.");
  validateRequiredDate(datos.fecha, "La fecha de pago", errors);
  validatePositive(datos.importe, "Importe", errors);
  if (!datos.forma) errors.push("Forma de pago es obligatoria.");
  const movs = movimientosDe(tropaId);
  if (!movs.some((mov) => mov.tipo === "COMPRA")) errors.push("No se puede guardar pago sin compra.");
  return errors;
}

function validateMuerte(tropaId, datos, editingMovimiento = null) {
  const errors = [];
  if (!tropaId) errors.push("Debe seleccionar una tropa.");
  validateRequiredDate(datos.fecha, "La fecha de muerte", errors);
  validatePositiveInteger(datos.cantidad, "Cantidad", errors);
  if (datos.modo !== "AUTOMATICO" && datos.modo !== "MANUAL") errors.push("Modo de muerte inválido.");
  if (datos.modo === "MANUAL") validatePositive(datos.kgDescontados, "Kg descontados", errors);

  const movs = movimientosDe(tropaId);
  if (!movs.some((mov) => mov.tipo === "COMPRA")) errors.push("No se puede guardar muerte sin compra.");
  if (!movs.some((mov) => mov.tipo === "RECEPCION")) errors.push("No se puede guardar muerte sin recepción.");

  const baseMovs = editingMovimiento ? movs.filter((mov) => mov.id !== editingMovimiento.id) : movs;
  const resumen = resumenDe(tropaId, baseMovs);
  const muerteCalc = calcularMuerte(datos, resumen);
  if (datos.modo === "AUTOMATICO" && resumen.kgReconocidosFeedlot <= 0) {
    errors.push("La muerte automática necesita una recepción con kg reconocidos Feedlot.");
  }
  if (datos.cantidad > resumen.restantes) errors.push("No se puede registrar más muertos que animales disponibles.");
  if (muerteCalc.kgDescontados <= 0) errors.push("Kg descontados debe ser mayor que cero.");
  if (muerteCalc.kgDescontados > resumen.kgDisponibles) errors.push("No se puede descontar más kg que los disponibles.");

  return errors;
}

function renderCompraPreview() {
  const calc = calcularCompra(compraDatos());
  text("cPesoNeto", kg(calc.pesoNetoOrigen));
  text("cKgPagados", kg(calc.kgPagados));
  text("cCostoHacienda", money(calc.costoHacienda));
  text("cIvaResult", money(calc.ivaCompra));
  text("cComisionResult", money(calc.comisionCompra));
  text("cCostoTotalPorKg", money(calc.costoTotalPorKg));
  text("cCostoTotal", money(calc.costoTotalCompra));
}

function renderRecepcionPreview() {
  const tropaId = getSelectedTropaId("d");
  renderDiasFeedlot(tropaId);
  const hasRecepcionInput = ["dPesoBrutoLlegada", "dPesoTaraLlegada", "dMermaFeedlotPct"].some((id) => readValue(id) !== "");
  if (!hasRecepcionInput) {
    text("dPesoNetoLlegada", "0 kg");
    text("dMermaTransporteKg", "0 kg");
    text("dMermaTransportePct", "0,00 %");
    text("dKgReconocidosFeedlot", "0 kg");
    if ($("recepcionErrores")?.innerText.includes("Aumento de peso")) setErrors("recepcionErrores", []);
    return;
  }
  const resumen = resumenDe(tropaId);
  const calc = calcularRecepcion(recepcionDatos(), resumen);
  text("dPesoNetoLlegada", kg(calc.pesoNetoLlegada));
  text("dMermaTransporteKg", kg(calc.mermaTransporteKg));
  text("dMermaTransportePct", `${fmt2(calc.mermaTransportePct)} %`);
  text("dKgReconocidosFeedlot", kg(calc.kgReconocidosFeedlot));
  if (calc.mermaTransporteKg < 0) {
    setErrors("recepcionErrores", ["Advertencia: el peso de llegada es mayor que el de origen. Aumento de peso."]);
  } else if ($("recepcionErrores")?.innerText.includes("Aumento de peso")) {
    setErrors("recepcionErrores", []);
  }
}

function renderDiasFeedlot(tropaId) {
  const tropa = state.tropas.find((item) => item.id === tropaId) || null;
  const movimientos = movimientosDe(tropaId);
  const info = calcularDiasFeedlot(tropa, movimientos);
  text("dDiasFeedlot", info.texto);
}

function renderMuertePreview() {
  $("mBoxKgManual").style.display = readValue("mModo") === "MANUAL" ? "block" : "none";
  const tropaId = getSelectedTropaId("m");
  const resumen = resumenDe(tropaId);
  const calc = calcularMuerte(muerteDatos(), resumen);
  text("mKgDescontadosResult", kg(calc.kgDescontados));
  text("mCostoMuerteResult", money(calc.costoMuerte));
}

function renderVentaPreview() {
  const tropaId = getSelectedTropaId("v");
  const movs = movimientosDe(tropaId);
  const baseMovs = state.editing?.tipo === "VENTA" ? movs.filter((mov) => mov.id !== state.editing.id) : movs;
  const resumen = resumenDe(tropaId, baseMovs);
  const calc = calcularVenta(ventaDatos(), resumen);
  text("vKgVendidos", kg(calc.kgVendidos));
  text("vIvaResult", money(calc.ivaVenta));
  text("vImporteSinIva", money(calc.importeSinIva));
  text("vTotalFacturado", money(calc.totalFacturado));
  text("vIngresoNeto", money(calc.ingresoEconomicoNeto));
  text("vCostoAsignado", money(calc.costoAsignado));
  text("vResultadoVenta", money(calc.resultadoVenta));
}

function renderBadges() {
  const tropaId = state.activeTropaId || getSelectedTropaId("d") || getSelectedTropaId("v");
  const resumen = resumenDe(tropaId);
  const label = tropaId || "sin tropa";
  text("lblSyncOrigen", `Sincronizado con Tropa: ${label} (${resumen.restantes || 0} animales | ${fmt(resumen.kgDisponibles || 0)} kg disp.)`);
  text("lblSyncVentas", `Sincronizado con Tropa: ${label} | Estado: ${resumen.estado || "Sin compra"}`);
}

function renderPreviews() {
  renderCompraPreview();
  renderRecepcionPreview();
  renderMuertePreview();
  renderVentaPreview();
  renderBadges();
}

async function refreshData() {
  state.tropas = await obtenerTropas();
  state.movimientos = new Map();
  for (const tropa of state.tropas) {
    state.movimientos.set(tropa.id, await obtenerMovimientosPorTropa(tropa.id));
  }
  if (!state.activeTropaId && state.tropas.length > 0) state.activeTropaId = state.tropas[0].id;
  renderTropaSelects();
  await suggestNextTropaId();
  renderPreviews();
}

async function suggestNextTropaId() {
  if (state.editing?.tipo === "COMPRA") return;
  const input = $("loteId");
  if (!input || input.value) return;
  setCompraIdEditable(true);
  input.value = await obtenerSiguienteIdSugerido();
}

function renderTropaSelects() {
  ["dTropaId", "mTropaId", "vTropaId", "pTropaId"].forEach((id) => {
    const select = $(id);
    if (!select) return;
    const current = select.value || state.activeTropaId;
    select.replaceChildren();
    const empty = document.createElement("option");
    empty.value = "";
    empty.innerText = "Seleccionar tropa";
    select.appendChild(empty);
    state.tropas.forEach((tropa) => {
      const option = document.createElement("option");
      option.value = tropa.id;
      option.innerText = tropa.id;
      select.appendChild(option);
    });
    select.value = state.tropas.some((tropa) => tropa.id === current) ? current : "";
  });
}

async function actualizarEstadoTropa(tropaId) {
  if (!tropaId) return;
  const tropa = await obtenerTropa(tropaId);
  if (!tropa) return;
  const movs = await obtenerMovimientosPorTropa(tropaId);
  const resumen = calcularResumenTropa(tropa, movs);
  await actualizarTropa(tropaId, { estado: resumen.estado, proveedor: resumen.proveedor });
}

function clearCompraForm() {
  ["cFecha", "cProveedor", "cComisionista", "cAnimales", "cDte", "cPesoBruto", "cPesoTara", "cDesbastePct", "cPrecioKg", "cIvaPct", "cIvaMonto", "cComisionPct", "cComisionMonto", "cFlete", "cObservacion"].forEach((id) => setValue(id, ""));
  setMode("cIvaModo", "SIN_IVA");
  setMode("cComisionModo", "PORCENTAJE");
  setCompraIdEditable(true);
  setValue("loteId", "");
}

function clearRecepcionForm(tropaId = "") {
  ["dFecha", "dPesoBrutoLlegada", "dPesoTaraLlegada", "dMermaFeedlotPct"].forEach((id) => setValue(id, ""));
  setValue("dTropaId", tropaId);
}

function clearVentaForm(tropaId = "") {
  ["vFecha", "vComprador", "vAnimales", "vPesoBruto", "vPesoTara", "vPrecioKg", "vIvaPct", "vIvaMonto", "vComisionVenta", "vFlete", "vObservacion"].forEach((id) => setValue(id, ""));
  setMode("vIvaModo", "SIN_IVA");
  setValue("vTropaId", tropaId);
}

function clearPagoForm(tropaId = "") {
  ["pFecha", "pImporte", "pObservacion"].forEach((id) => setValue(id, ""));
  setValue("pForma", "Transferencia");
  setValue("pTropaId", tropaId);
}

function clearMuerteForm(tropaId = "") {
  ["mFecha", "mCantidad", "mKgDescontados"].forEach((id) => setValue(id, ""));
  setValue("mModo", "AUTOMATICO");
  setValue("mTropaId", tropaId);
}

async function clearFormAfterSave(tipo, tropaId) {
  if (tipo === "COMPRA") {
    clearCompraForm();
    await suggestNextTropaId();
  }
  if (tipo === "RECEPCION") clearRecepcionForm(tropaId);
  if (tipo === "VENTA") clearVentaForm(tropaId);
  if (tipo === "PAGO") clearPagoForm(tropaId);
  if (tipo === "MUERTE") clearMuerteForm(tropaId);
  clearErrors();
  renderPreviews();
}

async function afterSave(tropaId, tipo) {
  await actualizarEstadoTropa(tropaId);
  state.activeTropaId = tropaId;
  clearEditing();
  await refreshData();
  await clearFormAfterSave(tipo, tropaId);
  await renderHistorial();
  await refreshSyncStatus();
  triggerAutoSync();
}

async function saveCompra() {
  const datos = compraDatos();
  const errors = validateCompra(datos, state.editing?.tipo === "COMPRA" ? state.editing : null);
  setErrors("compraErrores", errors);
  if (errors.length > 0) return false;

  if (state.editing?.tipo === "COMPRA") {
    await editarMovimiento(state.editing.id, {
      fecha: datos.fecha,
      datos: { ...datos, calculos: calcularCompra(datos) },
    });
    await afterSave(state.editing.tropaId, "COMPRA");
    return true;
  }

  const tropa = await crearTropa({ id: datos.tropaId, proveedor: datos.proveedor, estado: "Comprada" });
  await guardarMovimiento({
    tropaId: tropa.id,
    tipo: "COMPRA",
    fecha: datos.fecha,
    datos: { ...datos, calculos: calcularCompra(datos) },
  });
  await afterSave(tropa.id, "COMPRA");
  return true;
}

async function saveRecepcion() {
  const tropaId = getSelectedTropaId("d");
  const datos = recepcionDatos();
  const editing = state.editing?.tipo === "RECEPCION" ? state.editing : null;
  const errors = validateRecepcion(tropaId, datos, editing);
  setErrors("recepcionErrores", errors);
  if (errors.length > 0) return false;

  const resumen = resumenDe(tropaId);
  const payload = { ...datos, calculos: calcularRecepcion(datos, resumen) };
  if (editing) {
    await editarMovimiento(editing.id, { fecha: datos.fecha, datos: payload });
  } else {
    await guardarMovimiento({ tropaId, tipo: "RECEPCION", fecha: datos.fecha, datos: payload });
  }
  await afterSave(tropaId, "RECEPCION");
  return true;
}

async function saveVenta() {
  const tropaId = getSelectedTropaId("v");
  const datos = ventaDatos();
  const editing = state.editing?.tipo === "VENTA" ? state.editing : null;
  const errors = validateVenta(tropaId, datos, editing);
  setErrors("ventaErrores", errors);
  if (errors.length > 0) return false;

  const movs = movimientosDe(tropaId);
  const baseMovs = editing ? movs.filter((mov) => mov.id !== editing.id) : movs;
  const resumen = resumenDe(tropaId, baseMovs);
  const payload = { ...datos, calculos: calcularVenta(datos, resumen) };
  if (editing) {
    await editarMovimiento(editing.id, { fecha: datos.fecha, datos: payload });
  } else {
    await guardarMovimiento({ tropaId, tipo: "VENTA", fecha: datos.fecha, datos: payload });
  }
  await afterSave(tropaId, "VENTA");
  return true;
}

async function savePago() {
  const tropaId = getSelectedTropaId("p");
  const datos = pagoDatos();
  const editing = state.editing?.tipo === "PAGO" ? state.editing : null;
  const errors = validatePago(tropaId, datos);
  setErrors("pagoErrores", errors);
  if (errors.length > 0) return false;

  if (editing) {
    await editarMovimiento(editing.id, { fecha: datos.fecha, datos });
  } else {
    await guardarMovimiento({ tropaId, tipo: "PAGO", fecha: datos.fecha, datos });
  }
  await afterSave(tropaId, "PAGO");
  return true;
}

async function saveMuerte() {
  const tropaId = getSelectedTropaId("m");
  const datos = muerteDatos();
  const editing = state.editing?.tipo === "MUERTE" ? state.editing : null;
  const errors = validateMuerte(tropaId, datos, editing);
  setErrors("muerteErrores", errors);
  if (errors.length > 0) return false;

  const movs = movimientosDe(tropaId);
  const baseMovs = editing ? movs.filter((mov) => mov.id !== editing.id) : movs;
  const resumen = resumenDe(tropaId, baseMovs);
  const payload = { ...datos, calculos: calcularMuerte(datos, resumen) };
  if (editing) {
    await editarMovimiento(editing.id, { fecha: datos.fecha, datos: payload });
  } else {
    await guardarMovimiento({ tropaId, tipo: "MUERTE", fecha: datos.fecha, datos: payload });
  }
  await afterSave(tropaId, "MUERTE");
  return true;
}

function clearEditing() {
  state.editing = null;
  setCompraIdEditable(true);
  setButtonText("btnGuardarCompra", "Guardar");
  setButtonText("btnGuardarRecepcion", "Guardar");
  setButtonText("btnGuardarVenta", "Guardar Venta");
  setButtonText("btnGuardarPago", "Guardar Pago");
  setButtonText("btnGuardarMuerte", "Guardar");
}

function fillCompra(movimiento) {
  const d = movimiento.datos;
  state.editing = { tipo: "COMPRA", id: movimiento.id, tropaId: movimiento.tropaId };
  state.activeTropaId = movimiento.tropaId;
  setValue("loteId", movimiento.tropaId);
  setCompraIdEditable(false);
  setValue("cFecha", d.fecha);
  setValue("cProveedor", d.proveedor);
  setValue("cComisionista", d.comisionista);
  setValue("cAnimales", d.animales);
  setValue("cDte", d.dte);
  setValue("cPesoBruto", d.pesoBruto);
  setValue("cPesoTara", d.pesoTara);
  setValue("cDesbastePct", d.desbastePct);
  setValue("cPrecioKg", d.precioKg);
  setMode("cIvaModo", d.ivaModo || "SIN_IVA");
  setValue("cIvaPct", d.ivaPct);
  setValue("cIvaMonto", d.ivaMonto);
  setMode("cComisionModo", d.comisionModo || "PORCENTAJE");
  setValue("cComisionPct", d.comisionPct);
  setValue("cComisionMonto", d.comisionMonto);
  setValue("cFlete", d.flete);
  setValue("cObservacion", d.observacion);
  setButtonText("btnGuardarCompra", "Guardar");
  switchTab("origen");
  renderPreviews();
}

function fillRecepcion(movimiento) {
  const d = movimiento.datos;
  state.editing = { tipo: "RECEPCION", id: movimiento.id, tropaId: movimiento.tropaId };
  state.activeTropaId = movimiento.tropaId;
  setValue("dTropaId", movimiento.tropaId);
  setValue("dFecha", d.fecha);
  setValue("dPesoBrutoLlegada", d.pesoBrutoLlegada);
  setValue("dPesoTaraLlegada", d.pesoTaraLlegada);
  setValue("dMermaFeedlotPct", d.mermaFeedlotPct);
  setButtonText("btnGuardarRecepcion", "Guardar");
  switchTab("destino");
  renderPreviews();
}

function fillVenta(movimiento) {
  const d = movimiento.datos;
  state.editing = { tipo: "VENTA", id: movimiento.id, tropaId: movimiento.tropaId };
  state.activeTropaId = movimiento.tropaId;
  setValue("vTropaId", movimiento.tropaId);
  setValue("vFecha", d.fecha);
  setValue("vComprador", d.comprador);
  setValue("vAnimales", d.animales);
  setValue("vPesoBruto", d.pesoBruto);
  setValue("vPesoTara", d.pesoTara);
  setValue("vPrecioKg", d.precioKg);
  setMode("vIvaModo", d.ivaModo || "SIN_IVA");
  setValue("vIvaPct", d.ivaPct);
  setValue("vIvaMonto", d.ivaMonto);
  setValue("vComisionVenta", d.comisionVenta);
  setValue("vFlete", d.flete);
  setValue("vObservacion", d.observacion);
  setButtonText("btnGuardarVenta", "Guardar Venta");
  switchTab("ventas");
  renderPreviews();
}

function fillPago(movimiento) {
  const d = movimiento.datos;
  state.editing = { tipo: "PAGO", id: movimiento.id, tropaId: movimiento.tropaId };
  state.activeTropaId = movimiento.tropaId;
  setValue("pTropaId", movimiento.tropaId);
  setValue("pFecha", d.fecha);
  setValue("pImporte", d.importe);
  setValue("pForma", d.forma);
  setValue("pObservacion", d.observacion);
  setButtonText("btnGuardarPago", "Guardar Pago");
  switchTab("ventas");
  renderPreviews();
}

function fillMuerte(movimiento) {
  const d = movimiento.datos;
  state.editing = { tipo: "MUERTE", id: movimiento.id, tropaId: movimiento.tropaId };
  state.activeTropaId = movimiento.tropaId;
  setValue("mTropaId", movimiento.tropaId);
  setValue("mFecha", d.fecha);
  setValue("mCantidad", d.cantidad);
  setValue("mModo", d.modo);
  setValue("mKgDescontados", d.kgDescontados);
  setButtonText("btnGuardarMuerte", "Guardar");
  switchTab("destino");
  renderPreviews();
}

function editMovimiento(movimiento) {
  clearErrors();
  if (movimiento.tipo === "COMPRA") fillCompra(movimiento);
  if (movimiento.tipo === "RECEPCION") fillRecepcion(movimiento);
  if (movimiento.tipo === "VENTA") fillVenta(movimiento);
  if (movimiento.tipo === "PAGO") fillPago(movimiento);
  if (movimiento.tipo === "MUERTE") fillMuerte(movimiento);
}

async function deleteMovimiento(movimiento) {
  if (movimiento.tipo === "RECEPCION") {
    const dependientes = movimientosDe(movimiento.tropaId).some((mov) => mov.id !== movimiento.id && (mov.tipo === "VENTA" || mov.tipo === "MUERTE"));
    if (dependientes && !confirm("Eliminar la recepción deja ventas o muertes sin base Feedlot. La tropa se recalculará desde movimientos y mostrará el error hasta cargar una nueva recepción. ¿Continuar?")) return;
  }
  if (!confirm(`¿Seguro que querés eliminar el movimiento ${movimiento.tipo}?`)) return;
  await eliminarMovimiento(movimiento.id);
  await afterSave(movimiento.tropaId, movimiento.tipo);
  showToast("Datos guardados");
}

function appendPair(container, label, value) {
  const div = document.createElement("div");
  const bold = document.createElement("b");
  div.append(`${label}: `);
  bold.innerText = String(value);
  div.appendChild(bold);
  container.appendChild(div);
}

function movimientoDetalle(movimiento, resumenTropa) {
  const detail = document.createElement("div");
  detail.className = "history-detail";
  const datos = movimiento.datos || {};

  if (movimiento.tipo === "COMPRA") {
    const calc = calcularCompra(datos);
    appendPair(detail, "Compra", movimiento.fecha);
    appendPair(detail, "Proveedor", datos.proveedor || "S/D");
    appendPair(detail, "Animales", datos.animales || 0);
    appendPair(detail, "Kg pagados", fmt(calc.kgPagados));
    appendPair(detail, "Total", money(calc.costoTotalCompra));
  }

  if (movimiento.tipo === "RECEPCION") {
    const calc = calcularRecepcion(datos, resumenTropa);
    appendPair(detail, "Recepción", movimiento.fecha);
    appendPair(detail, "Kg llegada", fmt(calc.pesoNetoLlegada));
    appendPair(detail, "Merma transporte", `${fmt(calc.mermaTransporteKg)} kg`);
    appendPair(detail, "Kg reconocidos", fmt(calc.kgReconocidosFeedlot));
  }

  if (movimiento.tipo === "VENTA") {
    const calc = calcularVenta(datos, resumenTropa);
    appendPair(detail, "Venta", movimiento.fecha);
    appendPair(detail, "Comprador", datos.comprador || "S/D");
    appendPair(detail, "Animales", datos.animales || 0);
    appendPair(detail, "Kg vendidos", fmt(calc.kgVendidos));
    appendPair(detail, "Ingreso neto", money(calc.ingresoEconomicoNeto));
    appendPair(detail, "Resultado", money(calc.resultadoVenta));
  }

  if (movimiento.tipo === "PAGO") {
    appendPair(detail, "Pago", movimiento.fecha);
    appendPair(detail, "Forma", datos.forma || "S/D");
    appendPair(detail, "Importe", money(datos.importe || 0));
  }

  if (movimiento.tipo === "MUERTE") {
    const calc = calcularMuerte(datos, resumenTropa);
    appendPair(detail, "Muerte", movimiento.fecha);
    appendPair(detail, "Cantidad", datos.cantidad || 0);
    appendPair(detail, "Modo", datos.modo || "S/D");
    appendPair(detail, "Kg descontados", fmt(calc.kgDescontados));
    appendPair(detail, "Costo muerte", money(calc.costoMuerte));
  }

  return detail;
}

function renderMovimientoCard(movimiento, resumenTropa) {
  const card = document.createElement("div");
  card.className = "history-card";

  const header = document.createElement("div");
  header.className = "history-header";
  const titleBox = document.createElement("div");
  const title = document.createElement("span");
  title.className = "history-title";
  title.innerText = movimiento.tipo;
  const date = document.createElement("div");
  date.className = "history-date";
  date.innerText = `Guardado: ${new Date(movimiento.createdAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}`;
  titleBox.append(title, date);

  const actions = document.createElement("div");
  const edit = document.createElement("button");
  edit.className = "btn-edit";
  edit.innerHTML = `${icon("edit")} Editar`;
  edit.addEventListener("click", () => editMovimiento(movimiento));
  const del = document.createElement("button");
  del.className = "btn-delete";
  del.innerHTML = `${icon("trash")} Eliminar`;
  del.addEventListener("click", () => deleteMovimiento(movimiento));
  actions.append(edit, del);

  header.append(titleBox, actions);
  card.append(header, movimientoDetalle(movimiento, resumenTropa));
  return card;
}

async function renderHistorial() {
  const contenedor = $("listaHistorialLotes");
  contenedor.replaceChildren();

  if (state.tropas.length === 0) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.style.textAlign = "center";
    empty.style.color = "#6b7280";
    empty.innerText = "No hay tropas guardadas en el historial todavía.";
    contenedor.appendChild(empty);
    return;
  }

  for (const tropa of state.tropas) {
    const movimientos = movimientosDe(tropa.id);
    const resumen = calcularResumenTropa(tropa, movimientos);
    const card = document.createElement("div");
    card.className = "history-card";

    const header = document.createElement("div");
    header.className = "history-header";
    const titleBox = document.createElement("div");
    const title = document.createElement("span");
    title.className = "history-title";
    title.innerText = tropa.id;
    const date = document.createElement("div");
    date.className = "history-date";
    date.innerText = `Creada: ${new Date(tropa.fechaCreacion).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}`;
    titleBox.append(title, date);

    const del = document.createElement("button");
    del.className = "btn-delete";
    del.innerHTML = `${icon("trash")} Eliminar`;
    del.addEventListener("click", async () => {
      if (!confirm(`¿Seguro que querés borrar la tropa ${tropa.id} y todos sus movimientos?`)) return;
      await eliminarTropa(tropa.id);
      if (state.activeTropaId === tropa.id) state.activeTropaId = "";
      await refreshData();
      await renderHistorial();
      await refreshSyncStatus();
      triggerAutoSync();
    });

    header.append(titleBox, del);
    card.appendChild(header);

    const detail = document.createElement("div");
    detail.className = "history-detail";
    appendPair(detail, "Proveedor", resumen.proveedor || "S/D");
    appendPair(detail, "Cantidad inicial", resumen.comprados);
    appendPair(detail, "Estado", resumen.estado);
    appendPair(detail, "Animales restantes", resumen.restantes);
    appendPair(detail, "Kg disponibles", fmt(resumen.kgDisponibles));
    appendPair(detail, "Kg muertos", fmt(resumen.kgDescontadosMuertes));
    appendPair(detail, "Costo total", money(resumen.costoTotalCompra));
    appendPair(detail, "Costo muertes", money(resumen.costoMuertes));
    appendPair(detail, "Saldo proveedor", money(resumen.saldoProveedor));
    appendPair(detail, "Resultado ventas", money(resumen.resultadoVentas));
    appendPair(detail, "Resultado total", money(resumen.resultadoTotal));
    card.appendChild(detail);

    if (resumen.errores.length > 0) {
      const error = document.createElement("div");
      error.className = "validation-box active";
      error.innerText = resumen.errores.join(" ");
      card.appendChild(error);
    }

    contenedor.appendChild(card);
    movimientos.forEach((movimiento) => contenedor.appendChild(renderMovimientoCard(movimiento, resumen)));
  }
}

async function buildBackupObject(metadata = {}) {
  const data = await obtenerDatosCompletos();
  const backup = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    metadata: {
      app: "Cuaderno Digital Ganadero",
      stage: 3,
      ...metadata,
    },
    tropas: data.tropas,
    movimientos: data.movimientos,
    config: data.config,
  };

  if (backup.tropas.length !== data.tropas.length || backup.movimientos.length !== data.movimientos.length || backup.config.length !== data.config.length) {
    throw new Error("No se pudo validar que el respaldo contenga todos los registros.");
  }

  return backup;
}

function validateBackupObject(data) {
  const errors = [];
  if (!data || typeof data !== "object") errors.push("El archivo no contiene un JSON válido de respaldo.");
  if (data?.schemaVersion !== SCHEMA_VERSION) errors.push("La versión del esquema no es compatible.");
  if (!Array.isArray(data?.tropas)) errors.push("El respaldo no contiene un array de tropas.");
  if (!Array.isArray(data?.movimientos)) errors.push("El respaldo no contiene un array de movimientos.");
  if (!Array.isArray(data?.config)) errors.push("El respaldo no contiene un array de config.");

  const tropaIds = new Set();
  const tropas = Array.isArray(data?.tropas) ? data.tropas : [];
  const movimientos = Array.isArray(data?.movimientos) ? data.movimientos : [];
  const config = Array.isArray(data?.config) ? data.config : [];

  tropas.forEach((tropa, index) => {
    if (!tropa || typeof tropa !== "object" || !tropa.id) errors.push(`Tropa inválida en posición ${index}.`);
    if (tropa?.id) tropaIds.add(tropa.id);
  });

  movimientos.forEach((movimiento, index) => {
    if (!movimiento || typeof movimiento !== "object" || !movimiento.id) errors.push(`Movimiento inválido en posición ${index}.`);
    if (!MOVIMIENTO_TIPOS.includes(movimiento?.tipo)) errors.push(`Tipo de movimiento inválido en posición ${index}.`);
    if (!movimiento?.tropaId) errors.push(`Movimiento sin tropa en posición ${index}.`);
    if (movimiento?.tropaId && !tropaIds.has(movimiento.tropaId)) errors.push(`Movimiento ${movimiento.id || index} apunta a una tropa inexistente.`);
    if (!movimiento?.createdAt || !movimiento?.updatedAt) errors.push(`Movimiento ${movimiento?.id || index} no tiene fechas internas.`);
  });

  config.forEach((item, index) => {
    if (!item || typeof item !== "object" || !item.key) errors.push(`Config inválida en posición ${index}.`);
  });

  if (errors.length > 0) {
    const error = new Error(errors.join(" "));
    error.validationErrors = errors;
    throw error;
  }

  return {
    schemaVersion: data.schemaVersion,
    exportedAt: data.exportedAt || "",
    metadata: data.metadata || {},
    tropas: data.tropas,
    movimientos: data.movimientos,
    config: data.config,
  };
}

async function exportarRespaldoJson() {
  try {
    const backup = await buildBackupObject({ reason: "manual-export" });
    const filename = `Cuaderno_Ganadero_${timestampForFilename(true)}.json`;
    downloadTextFile(filename, JSON.stringify(backup, null, 2), "application/json;charset=utf-8");
    showHistorialMessage(`Respaldo exportado: ${backup.tropas.length} tropas y ${backup.movimientos.length} movimientos.`);
  } catch (error) {
    showHistorialMessage(error.message);
  }
}

async function importarRespaldoDesdeArchivo(file) {
  try {
    const textContent = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(textContent);
    } catch {
      throw new Error("El archivo no es un JSON válido.");
    }

    const backup = validateBackupObject(parsed);
    const fecha = backup.exportedAt ? new Date(backup.exportedAt).toLocaleString("es-AR") : "sin fecha";
    const proceed = confirm(`Respaldo válido.\nTropas: ${backup.tropas.length}\nMovimientos: ${backup.movimientos.length}\nFecha: ${fecha}\n\n¿Querés continuar?`);
    if (!proceed) return;

    const normalized = readValue("importMode");

    if (normalized === "REEMPLAZAR") {
      const currentBackup = await buildBackupObject({ reason: "before-replace-import" });
      localStorage.setItem(`ganado_backup_before_import_${Date.now()}`, JSON.stringify(currentBackup));
      await reemplazarDatos(backup);
      await refreshData();
      await renderHistorial();
      showHistorialMessage(`Importación por reemplazo completa: ${backup.tropas.length} tropas y ${backup.movimientos.length} movimientos.`);
      return;
    }

    if (normalized === "COMBINAR") {
      const result = await combinarDatos(backup);
      await refreshData();
      await renderHistorial();
      showHistorialMessage(`Importación combinada: ${result.tropasAgregadas} tropas nuevas, ${result.tropasActualizadas} tropas actualizadas, ${result.movimientosAgregados} movimientos nuevos, ${result.movimientosActualizados} movimientos actualizados, ${result.movimientosOmitidos} movimientos omitidos.`);
      return;
    }

    showHistorialMessage("Importación cancelada: opción inválida.");
  } catch (error) {
    showHistorialMessage(error.validationErrors || error.message);
  } finally {
    setValue("backupFileInput", "");
  }
}

async function exportarMovimientosCsv() {
  const rows = [];
  const headers = [
    "ID Movimiento", "ID Tropa", "Fecha", "Tipo", "Proveedor o Comprador", "Comisionista", "DTE", "Cantidad Animales",
    "Peso Bruto", "Peso Tara", "Peso Neto", "Desbaste %", "Kg Pagados", "Merma Transporte Kg", "Merma Transporte %",
    "Merma Feedlot %", "Kg Reconocidos Feedlot", "Precio por Kg", "Modo IVA", "Valor IVA", "Monto IVA",
    "Modo Comisión", "Valor Comisión", "Monto Comisión", "Flete", "Costo Hacienda", "Costo Total Compra",
    "Importe Sin IVA Venta", "IVA Venta", "Total Facturado", "Ingreso Económico Neto", "Costo Asignado",
    "Resultado Venta", "Importe Pago", "Forma Pago", "Kg Muerte", "Costo Muerte", "Perdida Muerte", "Observación", "CreatedAt", "UpdatedAt",
  ];
  rows.push(headers);

  for (const tropa of state.tropas) {
    const movimientos = movimientosDe(tropa.id);
    const resumen = calcularResumenTropa(tropa, movimientos);
    movimientos.forEach((movimiento) => {
      const d = movimiento.datos || {};
      const c = calcForMovimiento(movimiento, resumen);
      rows.push([
        movimiento.id,
        movimiento.tropaId,
        movimiento.fecha,
        movimiento.tipo,
        d.proveedor || d.comprador || "",
        d.comisionista || "",
        d.dte || "",
        d.animales || d.cantidad || "",
        d.pesoBruto || d.pesoBrutoLlegada || "",
        d.pesoTara || d.pesoTaraLlegada || "",
        c.pesoNetoOrigen || c.pesoNetoLlegada || c.kgVendidos || "",
        d.desbastePct || "",
        c.kgPagados || "",
        c.mermaTransporteKg || "",
        c.mermaTransportePct || "",
        d.mermaFeedlotPct || c.mermaFeedlotPct || "",
        c.kgReconocidosFeedlot || "",
        d.precioKg || "",
        d.ivaModo || "",
        d.ivaModo === "PORCENTAJE" ? d.ivaPct : d.ivaMonto || "",
        c.ivaCompra || c.ivaVenta || "",
        d.comisionModo || "",
        d.comisionModo === "PORCENTAJE" ? d.comisionPct : d.comisionMonto || "",
        c.comisionCompra || d.comisionVenta || "",
        d.flete || "",
        c.costoHacienda || "",
        c.costoTotalCompra || "",
        c.importeSinIva || "",
        c.ivaVenta || "",
        c.totalFacturado || "",
        c.ingresoEconomicoNeto || "",
        c.costoAsignado || "",
        c.resultadoVenta || "",
        d.importe || "",
        d.forma || "",
        c.kgDescontados || "",
        c.costoMuerte || "",
        c.perdidaMuerte || "",
        d.observacion || "",
        movimiento.createdAt || "",
        movimiento.updatedAt || "",
      ]);
    });
  }

  const csv = `\ufeff${rows.map(csvLine).join("\n")}`;
  downloadTextFile(`Movimientos_Ganaderos_${timestampForFilename(false)}.csv`, csv, "text/csv;charset=utf-8");
  showHistorialMessage(`CSV de movimientos exportado: ${rows.length - 1} movimientos.`);
}

async function exportarResumenTropasCsv() {
  const rows = [[
    "ID Tropa", "Proveedor", "Fecha Compra", "Estado", "Comprados", "Vendidos", "Muertos", "Restantes",
    "Peso Neto Origen", "Kg Pagados", "Peso Neto Llegada", "Merma Transporte Kg", "Merma Transporte %",
    "Merma Feedlot %", "Kg Reconocidos Feedlot", "Kg Vendidos", "Kg Muertes", "Kg Disponibles",
    "Costo Hacienda", "IVA Compra", "Comisión Compra", "Flete Compra", "Costo Total Compra", "Pagos",
    "Saldo Proveedor", "Importe Sin IVA Ventas", "IVA Ventas", "Total Facturado", "Ingreso Económico Neto",
    "Costo Asignado", "Costo Muertes", "Perdida Muertes", "Resultado Ventas", "Resultado Total",
    "Ganancia Realizada", "Rentabilidad Realizada %", "Rentabilidad Total %",
  ]];

  state.tropas.forEach((tropa) => {
    const movimientos = movimientosDe(tropa.id);
    const resumen = calcularResumenTropa(tropa, movimientos);
    const compra = movimientos.find((movimiento) => movimiento.tipo === "COMPRA");
    rows.push([
      tropa.id,
      resumen.proveedor || tropa.proveedor || "",
      compra?.fecha || "",
      resumen.estado,
      resumen.comprados,
      resumen.vendidos,
      resumen.muertos,
      resumen.restantes,
      resumen.pesoNetoOrigen,
      resumen.kgPagados,
      resumen.pesoNetoLlegada,
      resumen.mermaTransporteKg,
      resumen.mermaTransportePct,
      resumen.mermaFeedlotPct,
      resumen.kgReconocidosFeedlot,
      resumen.kgVendidos,
      resumen.kgDescontadosMuertes,
      resumen.kgDisponibles,
      resumen.costoHacienda,
      resumen.ivaCompra,
      resumen.comisionCompra,
      resumen.fleteCompra,
      resumen.costoTotalCompra,
      resumen.pagosAcumulados,
      resumen.saldoProveedor,
      resumen.importeSinIvaVentas,
      resumen.ivaVentas,
      resumen.totalFacturado,
      resumen.ingresoEconomicoNeto,
      resumen.costoAsignadoAcumulado,
      resumen.costoMuertes,
      resumen.perdidaMuertes,
      resumen.resultadoVentas,
      resumen.resultadoTotal,
      resumen.gananciaRealizada,
      resumen.rentabilidadRealizada,
      resumen.rentabilidadTotal,
    ]);
  });

  const csv = `\ufeff${rows.map(csvLine).join("\n")}`;
  downloadTextFile(`Resumen_Tropas_Ganaderas_${timestampForFilename(false)}.csv`, csv, "text/csv;charset=utf-8");
  showHistorialMessage(`CSV de resumen exportado: ${rows.length - 1} tropas.`);
}

async function limpiarDatosDePrueba() {
  const data = await obtenerDatosCompletos();
  const visual = confirm(`Esta acción limpiará los datos actuales de IndexedDB.\nTropas: ${data.tropas.length}\nMovimientos: ${data.movimientos.length}\n\nAntes de borrar se guardará un respaldo interno en config.\n\n¿Querés continuar?`);
  if (!visual) return;
  const typed = readValue("cleanConfirmText");
  if (typed !== "BORRAR DATOS") {
    showHistorialMessage("Limpieza cancelada: escribí exactamente BORRAR DATOS en el campo de confirmación.");
    return;
  }

  const backup = await limpiarDatosConRespaldoInterno();
  state.activeTropaId = "";
  clearEditing();
  await refreshData();
  await renderHistorial();
  setValue("cleanConfirmText", "");
  showHistorialMessage(`Datos limpiados. Respaldo interno guardado con ${backup.tropas.length} tropas y ${backup.movimientos.length} movimientos.`);
}

async function verifyInternalClearBackupExists() {
  const config = await obtenerConfig();
  return config.some((item) => item.key === "internalBackupBeforeClear" && item.value?.schemaVersion === SCHEMA_VERSION);
}

function configValue(config, key) {
  return config.find((item) => item.key === key)?.value || "";
}

async function loadSyncConfig() {
  const config = await obtenerConfig();
  state.sync.endpointUrl = configValue(config, SYNC_ENDPOINT_KEY);
  state.sync.sheetUrl = configValue(config, SYNC_SHEET_URL_KEY);
  state.sync.lastSyncAt = configValue(config, LAST_SYNC_KEY);
  setValue("syncEndpointUrl", state.sync.endpointUrl);
  setValue("syncSheetUrl", state.sync.sheetUrl);
}

function setCloudSyncStatus(textValue) {
  text("cloudSyncStatus", textValue);
}

async function refreshSyncStatus() {
  state.sync.pending = await contarSyncPendientes();
  if (state.sync.pending > 0) {
    setCloudSyncStatus(`Pendiente de respaldo (${state.sync.pending})`);
    return;
  }
  if (state.sync.lastSyncAt) {
    setCloudSyncStatus("Respaldado en la nube");
    return;
  }
  setCloudSyncStatus("Guardado en el teléfono");
}

function taskToSheetItem(task) {
  if (task.entityType === "MOVIMIENTO") {
    return {
      queueId: task.id,
      entity: "MOVIMIENTO",
      entityType: "MOVIMIENTO",
      entityId: task.entityId,
      sheet: "MOVIMIENTOS",
      id: task.entityId,
      operation: task.operation,
      columns: MOVIMIENTO_COLUMNS,
      row: movimientoSheetRow(task, task.operation),
    };
  }

  return {
    queueId: task.id,
    entity: "TROPA",
    entityType: "TROPA",
    entityId: task.entityId,
    sheet: "TROPAS",
    id: task.entityId,
    operation: task.operation,
    columns: TROPA_COLUMNS,
    row: tropaSheetRow(task, task.operation),
  };
}

function validSyncResult(result) {
  return result
    && result.status === "success"
    && result.id
    && (result.action === "inserted" || result.action === "updated");
}

async function syncNow(showMessage = true) {
  if (state.syncing) return false;
  await loadSyncConfig();
  const endpoint = String(state.sync.endpointUrl || "").trim();
  const sheetUrl = String(state.sync.sheetUrl || "").trim();
  if (!endpoint || !sheetUrl) {
    if (showMessage) showHistorialMessage("Configurá la URL de Apps Script y la URL de Google Sheets antes de sincronizar.");
    await refreshSyncStatus();
    return false;
  }

  const tasks = await obtenerSyncQueue();
  if (tasks.length === 0) {
    await refreshSyncStatus();
    if (showMessage) showHistorialMessage("No hay datos pendientes de respaldo.");
    return true;
  }

  state.syncing = true;
  setCloudSyncStatus(`Pendiente de respaldo (${tasks.length})`);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        app: "cuaderno-ganadero",
        sentAt: new Date().toISOString(),
        items: tasks.map(taskToSheetItem),
      }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (result.status === "error") throw new Error(result.message || "Error de sincronizaciÃ³n.");
    const results = Array.isArray(result.results) ? result.results : [result];
    const byQueueId = new Map(results.map((item) => [item.queueId || item.id, item]));

    for (const task of tasks) {
      const itemResult = byQueueId.get(task.id) || byQueueId.get(task.entityId);
      if (validSyncResult(itemResult) && itemResult.id === task.entityId) {
        await eliminarSyncTask(task.id);
      } else {
        await registrarSyncError(task.id, "Respuesta de sincronización inválida.");
      }
    }

    state.sync.lastSyncAt = new Date().toISOString();
    await guardarConfig(LAST_SYNC_KEY, state.sync.lastSyncAt);
    await refreshSyncStatus();
    if (showMessage) showHistorialMessage("Sincronización finalizada.");
    return true;
  } catch (error) {
    for (const task of tasks) await registrarSyncError(task.id, error.message);
    await refreshSyncStatus();
    if (showMessage) showHistorialMessage("No se pudo sincronizar. Los datos siguen guardados en el teléfono.");
    return false;
  } finally {
    state.syncing = false;
  }
}

function triggerAutoSync() {
  if (navigator.onLine && state.sync.endpointUrl && state.sync.sheetUrl) {
    syncNow(false);
  } else {
    refreshSyncStatus();
  }
}

async function guardarSyncConfig() {
  const endpointUrl = readValue("syncEndpointUrl").trim();
  const sheetUrl = readValue("syncSheetUrl").trim();
  await guardarConfig(SYNC_ENDPOINT_KEY, endpointUrl);
  await guardarConfig(SYNC_SHEET_URL_KEY, sheetUrl);
  await loadSyncConfig();
  await refreshSyncStatus();
  showToast("Configuración guardada");
  triggerAutoSync();
}

function abrirRespaldoCloud() {
  const url = String(state.sync.sheetUrl || readValue("syncSheetUrl") || "").trim();
  if (!url) {
    showHistorialMessage("Configurá la URL de Google Sheets para abrir el respaldo.");
    return;
  }
  window.open(url, "_blank", "noopener");
}

function bindEvents() {
  document.querySelectorAll(".tab-btn").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab, button));
  });

  document.addEventListener("wheel", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === "number" && document.activeElement === target) {
      target.blur();
    }
  }, { passive: true });

  document.querySelectorAll("[data-form]").forEach((input) => {
    input.addEventListener("input", () => {
      if (input.id === "loteId") input.value = normalizeTropaId(input.value);
      renderPreviews();
    });
    input.addEventListener("change", () => {
      if (input.id.endsWith("TropaId")) state.activeTropaId = input.value;
      renderPreviews();
    });
  });

  document.querySelectorAll("[data-toggle-group]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.toggleGroup, button.dataset.toggleValue));
  });

  const runSave = async (button, fn) => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      const saved = await fn();
      if (saved) showToast("Datos guardados");
    } catch {
      showToast("No se pudieron guardar los datos", false);
    } finally {
      button.disabled = false;
    }
  };

  $("btnGuardarCompra").addEventListener("click", (event) => runSave(event.currentTarget, saveCompra));
  $("btnGuardarRecepcion").addEventListener("click", (event) => runSave(event.currentTarget, saveRecepcion));
  $("btnGuardarVenta").addEventListener("click", (event) => runSave(event.currentTarget, saveVenta));
  $("btnGuardarPago").addEventListener("click", (event) => runSave(event.currentTarget, savePago));
  $("btnGuardarMuerte").addEventListener("click", (event) => runSave(event.currentTarget, saveMuerte));
  $("btnToggleExcelOptions").addEventListener("click", () => $("excelOptions").classList.toggle("active"));
  $("btnExportarRespaldo").addEventListener("click", exportarRespaldoJson);
  $("btnImportarRespaldo").addEventListener("click", () => $("backupFileInput").click());
  $("backupFileInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) importarRespaldoDesdeArchivo(file);
  });
  $("btnExportarMovimientosCsv").addEventListener("click", exportarMovimientosCsv);
  $("btnExportarResumenCsv").addEventListener("click", exportarResumenTropasCsv);
  $("btnLimpiarDatos").addEventListener("click", limpiarDatosDePrueba);
  $("btnGuardarSyncConfig").addEventListener("click", guardarSyncConfig);
  $("btnSincronizarAhora").addEventListener("click", () => syncNow(true));
  $("btnAbrirRespaldo").addEventListener("click", abrirRespaldoCloud);
  window.addEventListener("online", triggerAutoSync);
  window.addEventListener("offline", refreshSyncStatus);
}

async function init() {
  renderIcons();
  bindEvents();
  await respaldarLocalStorageLegacy();
  await abrirBase();
  await loadSyncConfig();
  await refreshData();
  await refreshSyncStatus();
  await renderHistorial();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }
}

window.addEventListener("load", init);

window.__ganaderoTest = {
  state,
  refreshData,
  resumenDe,
  saveCompra,
  saveRecepcion,
  saveVenta,
  savePago,
  saveMuerte,
  setValue,
  setMode,
  editMovimiento,
  deleteMovimiento,
  buildBackupObject,
  validateBackupObject,
  exportarRespaldoJson,
  importarRespaldoDesdeArchivo,
  exportarMovimientosCsv,
  exportarResumenTropasCsv,
  limpiarDatosDePrueba,
  verifyInternalClearBackupExists,
  syncNow,
  refreshSyncStatus,
  taskToSheetItem,
};
