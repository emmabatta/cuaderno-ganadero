import assert from "node:assert/strict";
import {
  calcularCompra,
  calcularRecepcion,
  calcularVenta,
  calcularMuerte,
  calcularResumenTropa,
  calcularDiasFeedlot,
} from "../js/calculations.js";

const EPS = 0.01;
const EPS_FULL = 1e-10;

function cerca(actual, expected, label, eps = EPS) {
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: esperado ${expected}, obtenido ${actual}`);
}

function movimiento(id, tipo, fecha, datos = {}) {
  return {
    id,
    tropaId: "TR-0001",
    tipo,
    fecha,
    datos: { fecha, ...datos },
    createdAt: `${fecha}T10:00:00.000Z`,
    updatedAt: `${fecha}T10:00:00.000Z`,
  };
}

function probarDiasFeedlot() {
  const tropa = { id: "TR-0001" };
  const hoy = new Date(2026, 7, 4, 12);
  const recepcion = (fecha) => movimiento(`rec-${fecha}`, "RECEPCION", fecha, {
    pesoBrutoLlegada: 39340,
    pesoTaraLlegada: 20000,
    mermaFeedlotPct: 5,
  });

  assert.equal(calcularDiasFeedlot(tropa, [recepcion("2026-08-04")], hoy).texto, "D\u00edas en feedlot: 0 d\u00edas");
  assert.equal(calcularDiasFeedlot(tropa, [recepcion("2026-08-03")], hoy).texto, "D\u00edas en feedlot: 1 d\u00eda");
  assert.equal(calcularDiasFeedlot(tropa, [recepcion("2026-07-20")], hoy).texto, "D\u00edas en feedlot: 15 d\u00edas");
  assert.equal(calcularDiasFeedlot(tropa, [], hoy).texto, "Sin ingreso al feedlot registrado");
  assert.equal(calcularDiasFeedlot(tropa, [recepcion("2026-08-05")], hoy).texto, "Fecha de ingreso inv\u00e1lida");
  assert.equal(calcularDiasFeedlot({ id: "TR-0002" }, [recepcion("2026-08-03")], hoy).dias, 1);
  assert.equal(calcularDiasFeedlot(tropa, [recepcion("2026-08-04")], new Date(2026, 7, 5, 1)).dias, 1);
}

function probarRegresionGanadera() {
  const tropa = { id: "TR-0001", proveedor: "Proveedor Auditoria", estado: "Comprada" };
  const compraDatos = {
    tropaId: "TR-0001",
    fecha: "2026-08-04",
    proveedor: "Proveedor Auditoria",
    comisionista: "Comisionista Auditoria",
    animales: 30,
    dte: "",
    pesoBruto: 40000,
    pesoTara: 20000,
    desbastePct: 1.49,
    precioKg: 61000000 / 19702,
    ivaModo: "SIN_IVA",
    ivaPct: 0,
    ivaMonto: 0,
    comisionModo: "PORCENTAJE",
    comisionPct: 0,
    comisionMonto: 0,
    flete: 0,
    observacion: "",
  };
  const recepcionDatos = {
    fecha: "2026-08-04",
    pesoBrutoLlegada: 39340,
    pesoTaraLlegada: 20000,
    mermaFeedlotPct: 5,
  };
  const muerteDatos = {
    fecha: "2026-08-04",
    cantidad: 1,
    modo: "AUTOMATICO",
    kgDescontados: 0,
  };
  const ventaDatos = {
    fecha: "2026-08-04",
    comprador: "Cliente Auditoria",
    animales: 6,
    pesoBruto: 5000,
    pesoTara: 1000,
    precioKg: 3800,
    ivaModo: "PORCENTAJE",
    ivaPct: 10.5,
    ivaMonto: 0,
    comisionVenta: 500000,
    flete: 800000,
    observacion: "",
  };

  const compraCalc = calcularCompra(compraDatos);
  cerca(compraCalc.pesoNetoOrigen, 20000, "peso neto origen");
  cerca(compraCalc.kgPagados, 19702, "kg pagados");
  cerca(compraCalc.costoTotalCompra, 61000000, "costo total compra");

  const recepcionCalc = calcularRecepcion(recepcionDatos, compraCalc);
  cerca(recepcionCalc.pesoNetoLlegada, 19340, "peso neto llegada");
  cerca(recepcionCalc.kgReconocidosFeedlot, 18373, "kg reconocidos feedlot");

  const movimientosBase = [
    movimiento("m1", "COMPRA", "2026-08-04", compraDatos),
    movimiento("m2", "RECEPCION", "2026-08-04", recepcionDatos),
  ];
  const resumenBase = calcularResumenTropa(tropa, movimientosBase);
  const muerteCalc = calcularMuerte(muerteDatos, resumenBase);
  cerca(muerteCalc.kgDescontados, 18373 / 30, "muerte automatica", EPS_FULL);

  const movimientosConMuertes = [
    ...movimientosBase,
    movimiento("m3", "MUERTE", "2026-08-04", muerteDatos),
    movimiento("m4", "MUERTE", "2026-08-04", muerteDatos),
  ];
  const resumenMuertes = calcularResumenTropa(tropa, movimientosConMuertes);
  assert.equal(resumenMuertes.restantes, 28);
  cerca(resumenMuertes.kgDisponibles, 17148.133333333333, "kg disponibles despues de dos muertes", EPS_FULL);

  const ventaCalc = calcularVenta(ventaDatos, resumenMuertes);
  cerca(ventaCalc.ingresoEconomicoNeto, 13900000, "ingreso economico neto");
  cerca(ventaCalc.costoAsignado, 13280357.05, "costo asignado");
  cerca(ventaCalc.resultadoVenta, 619642.95, "resultado venta");
}

probarDiasFeedlot();
probarRegresionGanadera();
console.log("Pruebas matematicas OK");
