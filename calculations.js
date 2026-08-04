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
  if (modo === "SIN_CARGO") return 0;
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
    pesoNetoOrigen: pesoNeto,
    kgPagados,
    costoHacienda,
    ivaCompra,
    comisionCompra,
    fleteCompra,
    costoTotalCompra,
    costoTotalPorKg,
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
    pesoNetoOrigen,
    pesoNetoLlegada,
    mermaTransporteKg,
    mermaTransportePct,
    mermaFeedlotPct: toNumber(datos.mermaFeedlotPct),
    kgReconocidosFeedlot,
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
    kgVendidos,
    importeSinIva,
    ivaVenta,
    totalFacturado,
    ingresoEconomicoNeto,
    costoUnitario,
    costoAsignado,
    resultadoVenta,
  };
}

export function calcularMuerte(datos, resumenDisponible) {
  const cantidad = toNumber(datos.cantidad);
  const kgReconocidosFeedlot = toNumber(resumenDisponible.kgReconocidosFeedlot);
  const animalesIniciales = toNumber(resumenDisponible.comprados);
  const pesoPromedio = kgReconocidosFeedlot > 0 && animalesIniciales > 0
    ? kgReconocidosFeedlot / animalesIniciales
    : 0;
  const kgDescontados = datos.modo === "MANUAL"
    ? toNumber(datos.kgDescontados)
    : pesoPromedio * cantidad;
  const costoUnitario = kgReconocidosFeedlot > 0
    ? toNumber(resumenDisponible.costoTotalCompra) / kgReconocidosFeedlot
    : 0;
  const costoMuerte = kgDescontados * costoUnitario;

  return {
    pesoPromedioAnimal: pesoPromedio,
    kgDescontados,
    costoUnitario,
    costoMuerte,
    perdidaMuerte: costoMuerte,
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
    resultadoVentas: 0,
    costoMuertes: 0,
    perdidaMuertes: 0,
    resultadoTotal: 0,
    gananciaRealizada: 0,
    rentabilidadRealizada: 0,
    rentabilidadTotal: 0,
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

  if (ordenados.filter((mov) => mov.tipo === "RECEPCION").length > 1) {
    errores.push("La tropa tiene más de una recepción; se usa la primera recepción válida.");
  }

  if (recepcion) {
    const recepcionCalc = calcularRecepcion(recepcion.datos, base);
    base.pesoNetoLlegada = recepcionCalc.pesoNetoLlegada;
    base.mermaTransporteKg = recepcionCalc.mermaTransporteKg;
    base.mermaTransportePct = recepcionCalc.mermaTransportePct;
    base.mermaFeedlotPct = recepcionCalc.mermaFeedlotPct;
    base.kgReconocidosFeedlot = recepcionCalc.kgReconocidosFeedlot;
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
    base.resultadoVentas += ventaCalc.resultadoVenta;
  }

  for (const muerte of muertes) {
    const muerteCalc = calcularMuerte(muerte.datos, base);
    base.muertos += toNumber(muerte.datos.cantidad);
    base.kgDescontadosMuertes += muerteCalc.kgDescontados;
    base.costoMuertes += muerteCalc.costoMuerte;
  }

  base.perdidaMuertes = base.costoMuertes;
  base.pagosAcumulados = pagos.reduce((total, pago) => total + toNumber(pago.datos.importe), 0);
  base.saldoProveedor = base.costoTotalCompra - base.pagosAcumulados;
  base.restantes = base.comprados - base.vendidos - base.muertos;
  base.kgDisponibles = base.kgReconocidosFeedlot - base.kgVendidos - base.kgDescontadosMuertes;
  base.resultadoTotal = base.resultadoVentas - base.costoMuertes;
  base.gananciaRealizada = base.resultadoTotal;
  base.rentabilidadRealizada = base.costoAsignadoAcumulado > 0
    ? (base.resultadoVentas / base.costoAsignadoAcumulado) * 100
    : 0;
  base.rentabilidadTotal = (base.costoAsignadoAcumulado + base.costoMuertes) > 0
    ? (base.resultadoTotal / (base.costoAsignadoAcumulado + base.costoMuertes)) * 100
    : 0;

  if (base.restantes < 0) errores.push("La tropa tiene animales negativos por ventas o muertes.");
  if (base.kgDisponibles < 0) errores.push("La tropa tiene kg disponibles negativos.");
  if (!recepcion && (ventas.length > 0 || muertes.length > 0)) errores.push("La tropa tiene ventas o muertes sin recepción.");

  if (base.restantes === 0) {
    base.estado = "Finalizada";
  } else if (base.vendidos > 0) {
    base.estado = "Venta Parcial";
  } else if (recepcion) {
    base.estado = "En Feedlot";
  } else {
    base.estado = "Comprada";
  }

  return base;
}
