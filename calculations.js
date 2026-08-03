export function fmt(num) {
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function fmt2(num) {
  if (!Number.isFinite(num)) return "0.00";
  return num.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function round2(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function ivaDesdeModo(base, modo, porcentaje, monto) {
  if (modo === "SIN_IVA") return 0;
  if (modo === "MONTO") return toNumber(monto);
  return base * (toNumber(porcentaje) / 100);
}

function montoDesdeModo(base, modo, porcentaje, monto) {
  if (modo === "MONTO") return toNumber(monto);
  return base * (toNumber(porcentaje) / 100);
}

export function calcularCompra(datos) {
  const pesoNeto = toNumber(datos.pesoBruto) - toNumber(datos.pesoTara);
  const kgPagados = pesoNeto * (1 - toNumber(datos.desbastePct) / 100);
  const costoHacienda = kgPagados * toNumber(datos.precioKg);
  const ivaCompra = ivaDesdeModo(costoHacienda, datos.ivaModo, datos.ivaPct, datos.ivaMonto);
  const comisionCompra = montoDesdeModo(costoHacienda, datos.comisionModo, datos.comisionPct, datos.comisionMonto);
  const fleteCompra = toNumber(datos.flete);
  const costoTotalCompra = costoHacienda + ivaCompra + comisionCompra + fleteCompra;
  const costoTotalPorKg = kgPagados > 0 ? costoTotalCompra / kgPagados : 0;

  return {
    pesoNetoOrigen: round2(pesoNeto),
    kgPagados: round2(kgPagados),
    costoHacienda: round2(costoHacienda),
    ivaCompra: round2(ivaCompra),
    comisionCompra: round2(comisionCompra),
    fleteCompra: round2(fleteCompra),
    costoTotalCompra: round2(costoTotalCompra),
    costoTotalPorKg: round2(costoTotalPorKg),
  };
}

export function calcularRecepcion(datos, resumenCompra) {
  const pesoNetoOrigen = toNumber(resumenCompra.pesoNetoOrigen);
  const pesoNetoLlegada = toNumber(datos.pesoBrutoLlegada) - toNumber(datos.pesoTaraLlegada);
  const mermaTransporteKg = pesoNetoOrigen - pesoNetoLlegada;
  const mermaTransportePct = pesoNetoOrigen > 0
    ? (mermaTransporteKg / pesoNetoOrigen) * 100
    : 0;
  const kgReconocidosFeedlot = pesoNetoLlegada * (1 - toNumber(datos.mermaFeedlotPct) / 100);

  return {
    pesoNetoOrigen: round2(pesoNetoOrigen),
    pesoNetoLlegada: round2(pesoNetoLlegada),
    mermaTransporteKg: round2(mermaTransporteKg),
    mermaTransportePct: round2(mermaTransportePct),
    mermaFeedlotPct: round2(toNumber(datos.mermaFeedlotPct)),
    kgReconocidosFeedlot: round2(kgReconocidosFeedlot),
  };
}

export function calcularVenta(datos, resumenDisponible) {
  const kgVendidos = toNumber(datos.pesoBruto) - toNumber(datos.pesoTara);
  const importeSinIva = kgVendidos * toNumber(datos.precioKg);
  const ivaVenta = ivaDesdeModo(importeSinIva, datos.ivaModo, datos.ivaPct, datos.ivaMonto);
  const totalFacturado = importeSinIva + ivaVenta;
  const ingresoEconomicoNeto = importeSinIva - toNumber(datos.comisionVenta) - toNumber(datos.flete);
  const costoUnitario = toNumber(resumenDisponible.kgReconocidosFeedlot) > 0
    ? toNumber(resumenDisponible.costoTotalCompra) / toNumber(resumenDisponible.kgReconocidosFeedlot)
    : 0;
  const costoAsignado = kgVendidos * costoUnitario;
  const resultadoVenta = ingresoEconomicoNeto - costoAsignado;

  return {
    kgVendidos: round2(kgVendidos),
    importeSinIva: round2(importeSinIva),
    ivaVenta: round2(ivaVenta),
    totalFacturado: round2(totalFacturado),
    ingresoEconomicoNeto: round2(ingresoEconomicoNeto),
    costoUnitario: round2(costoUnitario),
    costoAsignado: round2(costoAsignado),
    resultadoVenta: round2(resultadoVenta),
  };
}

export function calcularMuerte(datos, resumenDisponible) {
  const cantidad = toNumber(datos.cantidad);
  const pesoPromedio = toNumber(resumenDisponible.comprados) > 0
    ? toNumber(resumenDisponible.kgReconocidosFeedlot) / toNumber(resumenDisponible.comprados)
    : 0;
  const kgDescontados = datos.modo === "MANUAL"
    ? toNumber(datos.kgDescontados)
    : pesoPromedio * cantidad;

  return {
    pesoPromedioAnimal: round2(pesoPromedio),
    kgDescontados: round2(kgDescontados),
  };
}

export function calcularResumenTropa(tropa, movimientos) {
  const ordenados = [...movimientos].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const compra = ordenados.find((mov) => mov.tipo === "COMPRA");
  const recepcion = ordenados.find((mov) => mov.tipo === "RECEPCION");
  const ventas = ordenados.filter((mov) => mov.tipo === "VENTA");
  const pagos = ordenados.filter((mov) => mov.tipo === "PAGO");
  const muertes = ordenados.filter((mov) => mov.tipo === "MUERTE");
  const errores = [];

  const compraCalc = compra ? calcularCompra(compra.datos) : {};
  const base = {
    comprados: compra ? toNumber(compra.datos.animales) : 0,
    vendidos: 0,
    muertos: 0,
    restantes: compra ? toNumber(compra.datos.animales) : 0,
    pesoNetoOrigen: compraCalc.pesoNetoOrigen || 0,
    kgPagados: compraCalc.kgPagados || 0,
    pesoNetoLlegada: 0,
    mermaTransporteKg: 0,
    mermaTransportePct: 0,
    mermaFeedlotPct: 0,
    kgReconocidosFeedlot: 0,
    kgVendidos: 0,
    kgDescontadosMuertes: 0,
    kgDisponibles: 0,
    costoHacienda: compraCalc.costoHacienda || 0,
    ivaCompra: compraCalc.ivaCompra || 0,
    comisionCompra: compraCalc.comisionCompra || 0,
    fleteCompra: compraCalc.fleteCompra || 0,
    costoTotalCompra: compraCalc.costoTotalCompra || 0,
    pagosAcumulados: 0,
    saldoProveedor: compraCalc.costoTotalCompra || 0,
    importeSinIvaVentas: 0,
    ivaVentas: 0,
    totalFacturado: 0,
    ingresoEconomicoNeto: 0,
    costoAsignadoAcumulado: 0,
    gananciaRealizada: 0,
    rentabilidadRealizada: 0,
    estado: compra ? "Comprada" : "Sin compra",
    proveedor: compra?.datos.proveedor || tropa?.proveedor || "",
    errores,
  };

  if (!compra) {
    if (movimientos.length > 0) errores.push("La tropa tiene movimientos sin compra inicial.");
    return base;
  }

  if (base.pesoNetoOrigen <= 0) errores.push("La compra tiene peso neto inválido.");
  if (base.kgPagados < 0) errores.push("La compra genera kg pagados negativos.");

  if (recepcion) {
    const recepcionCalc = calcularRecepcion(recepcion.datos, base);
    base.pesoNetoLlegada = recepcionCalc.pesoNetoLlegada;
    base.mermaTransporteKg = recepcionCalc.mermaTransporteKg;
    base.mermaTransportePct = recepcionCalc.mermaTransportePct;
    base.mermaFeedlotPct = recepcionCalc.mermaFeedlotPct;
    base.kgReconocidosFeedlot = recepcionCalc.kgReconocidosFeedlot;
  } else {
    base.kgReconocidosFeedlot = base.kgPagados;
  }

  for (const venta of ventas) {
    const ventaCalc = calcularVenta(venta.datos, base);
    base.vendidos += toNumber(venta.datos.animales);
    base.kgVendidos += ventaCalc.kgVendidos;
    base.importeSinIvaVentas += ventaCalc.importeSinIva;
    base.ivaVentas += ventaCalc.ivaVenta;
    base.totalFacturado += ventaCalc.totalFacturado;
    base.ingresoEconomicoNeto += ventaCalc.ingresoEconomicoNeto;
    base.costoAsignadoAcumulado += ventaCalc.costoAsignado;
    base.gananciaRealizada += ventaCalc.resultadoVenta;
  }

  for (const muerte of muertes) {
    const muerteCalc = calcularMuerte(muerte.datos, base);
    base.muertos += toNumber(muerte.datos.cantidad);
    base.kgDescontadosMuertes += muerteCalc.kgDescontados;
  }

  base.pagosAcumulados = pagos.reduce((total, pago) => total + toNumber(pago.datos.importe), 0);
  base.saldoProveedor = base.costoTotalCompra - base.pagosAcumulados;
  base.restantes = base.comprados - base.vendidos - base.muertos;
  base.kgDisponibles = base.kgReconocidosFeedlot - base.kgVendidos - base.kgDescontadosMuertes;
  base.rentabilidadRealizada = base.costoAsignadoAcumulado > 0
    ? (base.gananciaRealizada / base.costoAsignadoAcumulado) * 100
    : 0;

  if (base.restantes < 0) errores.push("La tropa tiene animales negativos por ventas o muertes.");
  if (base.kgDisponibles < 0) errores.push("La tropa tiene kg disponibles negativos.");

  if (base.restantes === 0) {
    base.estado = "Finalizada";
  } else if (base.vendidos > 0) {
    base.estado = "Venta Parcial";
  } else if (recepcion) {
    base.estado = "En Feedlot";
  } else {
    base.estado = "Comprada";
  }

  for (const key of Object.keys(base)) {
    if (typeof base[key] === "number") base[key] = round2(base[key]);
  }

  return base;
}
