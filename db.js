const DB_NAME = "cuaderno_ganadero_db";
const DB_VERSION = 2;
const STORES = {
  tropas: "tropas",
  movimientos: "movimientos",
  config: "config",
  syncQueue: "sync_queue",
};
const TIPOS_PERMITIDOS = ["COMPRA", "RECEPCION", "VENTA", "PAGO", "MUERTE"];

let dbPromise;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function nowIso() {
  return new Date().toISOString();
}

function createSyncTask({ entityType, entityId, operation, payload }) {
  const createdAt = nowIso();
  return {
    id: `${entityType}-${entityId}-${operation}-${createdAt}-${Math.random().toString(16).slice(2)}`,
    entityType,
    entityId,
    operation,
    payload,
    attempts: 0,
    lastError: "",
    createdAt,
    updatedAt: createdAt,
  };
}

function addSyncTask(store, task) {
  store.add(createSyncTask(task));
}

function assertTipoMovimiento(tipo) {
  if (!TIPOS_PERMITIDOS.includes(tipo)) {
    throw new Error(`Tipo de movimiento inválido: ${tipo}`);
  }
}

export function abrirBase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORES.tropas)) {
        db.createObjectStore(STORES.tropas, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(STORES.movimientos)) {
        const movimientos = db.createObjectStore(STORES.movimientos, { keyPath: "id" });
        movimientos.createIndex("tropaId", "tropaId", { unique: false });
        movimientos.createIndex("tipo", "tipo", { unique: false });
        movimientos.createIndex("tropaTipo", ["tropaId", "tipo"], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.config)) {
        db.createObjectStore(STORES.config, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(STORES.syncQueue)) {
        const syncQueue = db.createObjectStore(STORES.syncQueue, { keyPath: "id" });
        syncQueue.createIndex("createdAt", "createdAt", { unique: false });
        syncQueue.createIndex("entityId", "entityId", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

export async function respaldarLocalStorageLegacy() {
  const actual = localStorage.getItem("ganado_cuaderno_actual");
  const historial = localStorage.getItem("ganado_historial_completo");
  if (actual === null && historial === null) return null;

  const existingBackupKey = localStorage.getItem("ganado_backup_legacy_key");
  if (existingBackupKey && localStorage.getItem(existingBackupKey)) return existingBackupKey;

  const backupKey = `ganado_backup_legacy_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const backup = {
    createdAt: nowIso(),
    ganado_cuaderno_actual: actual,
    ganado_historial_completo: historial,
  };

  localStorage.setItem(backupKey, JSON.stringify(backup));
  localStorage.setItem("ganado_backup_legacy_key", backupKey);
  return backupKey;
}

export async function generarSiguienteId() {
  const db = await abrirBase();
  const tx = db.transaction(STORES.config, "readwrite");
  const store = tx.objectStore(STORES.config);
  const current = await requestToPromise(store.get("tropaSequence"));
  const nextValue = current?.value ? current.value + 1 : 1;
  store.put({ key: "tropaSequence", value: nextValue, updatedAt: nowIso() });
  await txDone(tx);
  return `TR-${String(nextValue).padStart(4, "0")}`;
}

export async function obtenerSiguienteIdSugerido() {
  const db = await abrirBase();
  const tx = db.transaction([STORES.tropas, STORES.config], "readonly");
  const configStore = tx.objectStore(STORES.config);
  const current = await requestToPromise(configStore.get("tropaSequence"));
  const tropas = await requestToPromise(tx.objectStore(STORES.tropas).getAll());
  await txDone(tx);
  const maxExisting = maxTropaSequence(tropas);
  const nextValue = Math.max(current?.value || 0, maxExisting) + 1;
  return `TR-${String(nextValue).padStart(4, "0")}`;
}

function sequenceFromTropaId(id) {
  const match = String(id || "").match(/^TR-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

export async function crearTropa({ id: customId = "", proveedor = "", estado = "ABIERTA" } = {}) {
  const db = await abrirBase();
  const id = customId || await generarSiguienteId();
  const fecha = nowIso();
  const tropa = {
    id,
    fechaCreacion: fecha,
    estado,
    proveedor,
    createdAt: fecha,
    updatedAt: fecha,
  };

  const tx = db.transaction([STORES.tropas, STORES.config, STORES.syncQueue], "readwrite");
  tx.objectStore(STORES.tropas).add(tropa);
  addSyncTask(tx.objectStore(STORES.syncQueue), { entityType: "TROPA", entityId: tropa.id, operation: "CREATED", payload: tropa });
  const configStore = tx.objectStore(STORES.config);
  const current = await requestToPromise(configStore.get("tropaSequence"));
  const nextSequence = Math.max(current?.value || 0, sequenceFromTropaId(id));
  configStore.put({ key: "tropaSequence", value: nextSequence, updatedAt: nowIso() });
  await txDone(tx);
  return tropa;
}

export async function obtenerTropas() {
  const db = await abrirBase();
  const tx = db.transaction(STORES.tropas, "readonly");
  const tropas = await requestToPromise(tx.objectStore(STORES.tropas).getAll());
  await txDone(tx);
  return tropas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function obtenerTropa(id) {
  const db = await abrirBase();
  const tx = db.transaction(STORES.tropas, "readonly");
  const tropa = await requestToPromise(tx.objectStore(STORES.tropas).get(id));
  await txDone(tx);
  return tropa || null;
}

export async function obtenerConfig() {
  const db = await abrirBase();
  const tx = db.transaction(STORES.config, "readonly");
  const config = await requestToPromise(tx.objectStore(STORES.config).getAll());
  await txDone(tx);
  return config;
}

export async function guardarConfig(key, value) {
  const db = await abrirBase();
  const tx = db.transaction(STORES.config, "readwrite");
  tx.objectStore(STORES.config).put({ key, value, updatedAt: nowIso() });
  await txDone(tx);
  return { key, value };
}

export async function actualizarTropa(id, updates) {
  const db = await abrirBase();
  const tx = db.transaction([STORES.tropas, STORES.syncQueue], "readwrite");
  const store = tx.objectStore(STORES.tropas);
  const tropa = await requestToPromise(store.get(id));
  if (!tropa) throw new Error(`No existe la tropa ${id}.`);

  const updatedAt = nowIso();
  const actualizada = {
    ...tropa,
    ...updates,
    updatedAt,
  };

  store.put(actualizada);
  addSyncTask(tx.objectStore(STORES.syncQueue), { entityType: "TROPA", entityId: id, operation: "UPDATED", payload: actualizada });
  await txDone(tx);
  return actualizada;
}

export async function guardarMovimiento({ tropaId, tipo, fecha, datos }) {
  assertTipoMovimiento(tipo);
  if (!tropaId) throw new Error("El movimiento necesita una tropa vinculada.");

  const tropa = await obtenerTropa(tropaId);
  if (!tropa) throw new Error(`No existe la tropa ${tropaId}.`);

  const db = await abrirBase();
  const createdAt = nowIso();
  const movimiento = {
    id: `${tropaId}-${tipo}-${createdAt}-${Math.random().toString(16).slice(2)}`,
    tropaId,
    tipo,
    fecha: fecha || createdAt.slice(0, 10),
    datos: datos || {},
    createdAt,
    updatedAt: createdAt,
  };

  const tx = db.transaction([STORES.movimientos, STORES.tropas, STORES.syncQueue], "readwrite");
  tx.objectStore(STORES.movimientos).add(movimiento);
  tx.objectStore(STORES.tropas).put({ ...tropa, updatedAt: createdAt });
  addSyncTask(tx.objectStore(STORES.syncQueue), { entityType: "MOVIMIENTO", entityId: movimiento.id, operation: "CREATED", payload: movimiento });
  await txDone(tx);
  return movimiento;
}

export async function editarMovimiento(id, updates) {
  const db = await abrirBase();
  const tx = db.transaction([STORES.movimientos, STORES.syncQueue], "readwrite");
  const store = tx.objectStore(STORES.movimientos);
  const existing = await requestToPromise(store.get(id));
  if (!existing) throw new Error(`No existe el movimiento ${id}.`);

  const tipo = updates.tipo || existing.tipo;
  assertTipoMovimiento(tipo);

  const updated = {
    ...existing,
    ...updates,
    tipo,
    updatedAt: nowIso(),
  };

  store.put(updated);
  addSyncTask(tx.objectStore(STORES.syncQueue), { entityType: "MOVIMIENTO", entityId: updated.id, operation: "UPDATED", payload: updated });
  await txDone(tx);
  return updated;
}

export async function eliminarMovimiento(id) {
  const db = await abrirBase();
  const tx = db.transaction([STORES.movimientos, STORES.syncQueue], "readwrite");
  const store = tx.objectStore(STORES.movimientos);
  const existing = await requestToPromise(store.get(id));
  store.delete(id);
  if (existing) addSyncTask(tx.objectStore(STORES.syncQueue), { entityType: "MOVIMIENTO", entityId: id, operation: "DELETED", payload: existing });
  await txDone(tx);
  return true;
}

export async function obtenerMovimientosPorTropa(tropaId) {
  const db = await abrirBase();
  const tx = db.transaction(STORES.movimientos, "readonly");
  const index = tx.objectStore(STORES.movimientos).index("tropaId");
  const movimientos = await requestToPromise(index.getAll(tropaId));
  await txDone(tx);
  return movimientos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function eliminarTropa(id) {
  const db = await abrirBase();
  const tx = db.transaction([STORES.tropas, STORES.movimientos, STORES.syncQueue], "readwrite");
  const tropasStore = tx.objectStore(STORES.tropas);
  const movimientosStore = tx.objectStore(STORES.movimientos);
  const syncStore = tx.objectStore(STORES.syncQueue);
  const index = movimientosStore.index("tropaId");
  const movimientos = await requestToPromise(index.getAll(id));
  const tropa = await requestToPromise(tropasStore.get(id));

  movimientos.forEach((movimiento) => {
    movimientosStore.delete(movimiento.id);
    addSyncTask(syncStore, { entityType: "MOVIMIENTO", entityId: movimiento.id, operation: "DELETED", payload: movimiento });
  });
  tropasStore.delete(id);
  if (tropa) addSyncTask(syncStore, { entityType: "TROPA", entityId: id, operation: "DELETED", payload: tropa });

  await txDone(tx);
  return true;
}

export async function obtenerTodasLasTropasConMovimientos() {
  const tropas = await obtenerTropas();
  const completas = [];

  for (const tropa of tropas) {
    const movimientos = await obtenerMovimientosPorTropa(tropa.id);
    completas.push({ tropa, movimientos });
  }

  return completas;
}

export async function obtenerDatosCompletos() {
  const db = await abrirBase();
  const tx = db.transaction([STORES.tropas, STORES.movimientos, STORES.config], "readonly");
  const tropas = await requestToPromise(tx.objectStore(STORES.tropas).getAll());
  const movimientos = await requestToPromise(tx.objectStore(STORES.movimientos).getAll());
  const config = await requestToPromise(tx.objectStore(STORES.config).getAll());
  await txDone(tx);
  return { tropas, movimientos, config };
}

export async function obtenerSyncQueue() {
  const db = await abrirBase();
  const tx = db.transaction(STORES.syncQueue, "readonly");
  const items = await requestToPromise(tx.objectStore(STORES.syncQueue).getAll());
  await txDone(tx);
  return items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function contarSyncPendientes() {
  const db = await abrirBase();
  const tx = db.transaction(STORES.syncQueue, "readonly");
  const count = await requestToPromise(tx.objectStore(STORES.syncQueue).count());
  await txDone(tx);
  return count;
}

export async function eliminarSyncTask(id) {
  const db = await abrirBase();
  const tx = db.transaction(STORES.syncQueue, "readwrite");
  tx.objectStore(STORES.syncQueue).delete(id);
  await txDone(tx);
  return true;
}

export async function registrarSyncError(id, message) {
  const db = await abrirBase();
  const tx = db.transaction(STORES.syncQueue, "readwrite");
  const store = tx.objectStore(STORES.syncQueue);
  const task = await requestToPromise(store.get(id));
  if (task) {
    store.put({
      ...task,
      attempts: (task.attempts || 0) + 1,
      lastError: String(message || "Error de sincronización"),
      updatedAt: nowIso(),
    });
  }
  await txDone(tx);
  return true;
}

function maxTropaSequence(tropas) {
  return tropas.reduce((max, tropa) => {
    const match = String(tropa.id || "").match(/^TR-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

export async function reemplazarDatos({ tropas, movimientos, config }) {
  const db = await abrirBase();
  const tx = db.transaction([STORES.tropas, STORES.movimientos, STORES.config, STORES.syncQueue], "readwrite");
  const tropasStore = tx.objectStore(STORES.tropas);
  const movimientosStore = tx.objectStore(STORES.movimientos);
  const configStore = tx.objectStore(STORES.config);

  tropasStore.clear();
  movimientosStore.clear();
  configStore.clear();
  tx.objectStore(STORES.syncQueue).clear();

  tropas.forEach((tropa) => tropasStore.add(tropa));
  movimientos.forEach((movimiento) => movimientosStore.add(movimiento));
  config.forEach((item) => configStore.put(item));
  configStore.put({ key: "tropaSequence", value: maxTropaSequence(tropas), updatedAt: nowIso() });

  await txDone(tx);
  return { tropas: tropas.length, movimientos: movimientos.length, config: config.length };
}

export async function combinarDatos({ tropas, movimientos, config }) {
  const db = await abrirBase();
  const existing = await obtenerDatosCompletos();
  const existingTropas = new Map(existing.tropas.map((tropa) => [tropa.id, tropa]));
  const existingMovimientos = new Map(existing.movimientos.map((movimiento) => [movimiento.id, movimiento]));
  const existingConfig = new Map(existing.config.map((item) => [item.key, item]));
  const result = { tropasAgregadas: 0, tropasActualizadas: 0, tropasOmitidas: 0, movimientosAgregados: 0, movimientosActualizados: 0, movimientosOmitidos: 0, configActualizada: 0 };

  const tx = db.transaction([STORES.tropas, STORES.movimientos, STORES.config], "readwrite");
  const tropasStore = tx.objectStore(STORES.tropas);
  const movimientosStore = tx.objectStore(STORES.movimientos);
  const configStore = tx.objectStore(STORES.config);

  tropas.forEach((tropa) => {
    const current = existingTropas.get(tropa.id);
    if (!current) {
      tropasStore.add(tropa);
      result.tropasAgregadas += 1;
      return;
    }
    if (String(tropa.updatedAt || "") > String(current.updatedAt || "")) {
      tropasStore.put(tropa);
      result.tropasActualizadas += 1;
    } else {
      result.tropasOmitidas += 1;
    }
  });

  movimientos.forEach((movimiento) => {
    const current = existingMovimientos.get(movimiento.id);
    if (!current) {
      movimientosStore.add(movimiento);
      result.movimientosAgregados += 1;
      return;
    }
    if (String(movimiento.updatedAt || "") > String(current.updatedAt || "")) {
      movimientosStore.put(movimiento);
      result.movimientosActualizados += 1;
    } else {
      result.movimientosOmitidos += 1;
    }
  });

  config.forEach((item) => {
    const current = existingConfig.get(item.key);
    if (!current || String(item.updatedAt || "") > String(current.updatedAt || "")) {
      configStore.put(item);
      result.configActualizada += 1;
    }
  });

  const allTropas = [...existing.tropas, ...tropas];
  configStore.put({ key: "tropaSequence", value: maxTropaSequence(allTropas), updatedAt: nowIso() });

  await txDone(tx);
  return result;
}

export async function limpiarDatosConRespaldoInterno() {
  const backup = {
    schemaVersion: 1,
    exportedAt: nowIso(),
    metadata: { app: "Cuaderno Digital Ganadero", reason: "backup-before-clear" },
    ...(await obtenerDatosCompletos()),
  };

  const db = await abrirBase();
  const tx = db.transaction([STORES.tropas, STORES.movimientos, STORES.config, STORES.syncQueue], "readwrite");
  tx.objectStore(STORES.tropas).clear();
  tx.objectStore(STORES.movimientos).clear();
  tx.objectStore(STORES.syncQueue).clear();
  const configStore = tx.objectStore(STORES.config);
  configStore.put({ key: "internalBackupBeforeClear", value: backup, updatedAt: nowIso() });
  configStore.put({ key: "tropaSequence", value: 0, updatedAt: nowIso() });
  await txDone(tx);
  return backup;
}
