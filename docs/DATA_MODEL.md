# Modelo De Datos

## TROPA

Campos usados:

- `id`
- `fechaCreacion`
- `estado`
- `proveedor`
- `createdAt`
- `updatedAt`

## MOVIMIENTO Base

Campos comunes:

- `id`
- `tropaId`
- `tipo`
- `fecha`
- `datos`
- `createdAt`
- `updatedAt`

Tipos permitidos:

- `COMPRA`
- `RECEPCION`
- `VENTA`
- `PAGO`
- `MUERTE`

## COMPRA datos

- `tropaId`
- `fecha`
- `proveedor`
- `comisionista`
- `animales`
- `dte`
- `pesoBruto`
- `pesoTara`
- `desbastePct`
- `precioKg`
- `ivaModo`
- `ivaPct`
- `ivaMonto`
- `comisionModo`
- `comisionPct`
- `comisionMonto`
- `flete`
- `observacion`
- `calculos`

Calculos:

- `pesoNetoOrigen`
- `kgPagados`
- `costoHacienda`
- `ivaCompra`
- `comisionCompra`
- `fleteCompra`
- `costoTotalCompra`
- `costoTotalPorKg`

## RECEPCION datos

- `fecha`
- `pesoBrutoLlegada`
- `pesoTaraLlegada`
- `mermaFeedlotPct`
- `calculos`

Calculos:

- `pesoNetoOrigen`
- `pesoNetoLlegada`
- `mermaTransporteKg`
- `mermaTransportePct`
- `mermaFeedlotPct`
- `kgReconocidosFeedlot`

## MUERTE datos

- `fecha`
- `cantidad`
- `modo`
- `kgDescontados`
- `observacion`
- `calculos`

Calculos:

- `pesoPromedioAnimal`
- `kgDescontados`
- `costoUnitario`
- `costoMuerte`
- `perdidaMuerte`

## VENTA datos

- `fecha`
- `comprador`
- `animales`
- `pesoBruto`
- `pesoTara`
- `precioKg`
- `ivaModo`
- `ivaPct`
- `ivaMonto`
- `comisionVenta`
- `flete`
- `observacion`
- `calculos`

Calculos:

- `kgVendidos`
- `importeSinIva`
- `ivaVenta`
- `totalFacturado`
- `ingresoEconomicoNeto`
- `costoUnitario`
- `costoAsignado`
- `resultadoVenta`

## PAGO datos

- `fecha`
- `importe`
- `forma`
- `observacion`

## sync_queue

Campos usados:

- `id`
- `entityType`
- `entityId`
- `operation`
- `payload`
- `attempts`
- `lastError`
- `createdAt`
- `updatedAt`

`payload` conserva la entidad completa que sera enviada al respaldo.

## Config

Campos usados:

- `key`
- `value`
- `updatedAt`

Claves conocidas:

- `tropaSequence`
- `googleSheetsSyncEndpoint`
- `googleSheetsUrl`
- `googleSheetsLastSyncAt`
- `internalBackupBeforeClear`
