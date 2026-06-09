import fs from "fs";
import path from "path";
import { getModuleDir } from "./paths.js";

const moduleDir = getModuleDir();

const CMS_STORAGE_PROVIDER = (process.env.CMS_STORAGE_PROVIDER || "file").toLowerCase();

let firestoreDb = null;
let firestoreInitAttempted = false;
let firestoreLastError = null;
let datastoreClient = null;
let datastoreInitAttempted = false;
let datastoreLastError = null;

function isServerlessRuntime() {
  return !!(
    process.env.K_SERVICE ||
    process.env.NETLIFY ||
    process.env.NETLIFY_DEV ||
    process.env.AWS_LAMBDA_FUNCTION_NAME
  );
}

export const DATA_DIR = process.env.DATA_DIR || (
  isServerlessRuntime()
    ? path.join("/tmp", "aivio-data")
    : path.join(moduleDir, "..", "data")
);

function shouldUseFirestore() {
  if (CMS_STORAGE_PROVIDER === "file" || CMS_STORAGE_PROVIDER === "json" || CMS_STORAGE_PROVIDER === "datastore") return false;
  if (CMS_STORAGE_PROVIDER === "firestore") return true;
  return !!process.env.GOOGLE_CLOUD_PROJECT;
}

function shouldUseDatastore() {
  if (CMS_STORAGE_PROVIDER === "file" || CMS_STORAGE_PROVIDER === "json") return false;
  if (CMS_STORAGE_PROVIDER === "datastore") return true;
  return !!process.env.GOOGLE_CLOUD_PROJECT;
}

async function getFirestoreDb() {
  if (firestoreDb) return firestoreDb;
  if (firestoreInitAttempted) return null;
  firestoreInitAttempted = true;
  if (!shouldUseFirestore()) return null;
  try {
    const { Firestore } = await import("@google-cloud/firestore");
    firestoreDb = new Firestore();
    return firestoreDb;
  } catch (err) {
    firestoreLastError = err?.message || String(err);
    console.error("FIRESTORE INIT ERROR:", firestoreLastError);
    return null;
  }
}

async function getDatastoreClient() {
  if (datastoreClient) return datastoreClient;
  if (datastoreInitAttempted) return null;
  datastoreInitAttempted = true;
  if (!shouldUseDatastore()) return null;
  try {
    const { Datastore } = await import("@google-cloud/datastore");
    datastoreClient = new Datastore();
    return datastoreClient;
  } catch (err) {
    datastoreLastError = err?.message || String(err);
    console.error("DATASTORE INIT ERROR:", datastoreLastError);
    return null;
  }
}

export async function getBackend() {
  const fsDb = await getFirestoreDb();
  if (fsDb) return { type: "firestore", client: fsDb };
  const ds = await getDatastoreClient();
  if (ds) return { type: "datastore", client: ds };
  return { type: "file", client: null };
}

export async function getStorageInfo() {
  const backend = await getBackend();
  return {
    provider: CMS_STORAGE_PROVIDER,
    firestorePreferred: shouldUseFirestore(),
    firestoreReady: backend.type === "firestore",
    firestoreLastError,
    datastorePreferred: shouldUseDatastore(),
    datastoreReady: backend.type === "datastore",
    datastoreLastError,
    activeStorage: backend.type
  };
}

function filePath(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readFileArray(collection) {
  ensureDataDir();
  const fp = filePath(collection);
  if (!fs.existsSync(fp)) {
    fs.writeFileSync(fp, "[]");
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeFileArray(collection, rows) {
  ensureDataDir();
  fs.writeFileSync(filePath(collection), JSON.stringify(rows, null, 2));
}

function readFileObject(collection, docId) {
  ensureDataDir();
  const fp = path.join(DATA_DIR, `${collection}-${docId}.json`);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function writeFileObject(collection, docId, data) {
  ensureDataDir();
  const fp = path.join(DATA_DIR, `${collection}-${docId}.json`);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

export async function readObject(collection, docId) {
  const backend = await getBackend();
  if (backend.type === "file") {
    const rows = readFileArray(collection);
    return rows.find((r) => String(r.id) === String(docId)) || readFileObject(collection, docId);
  }

  if (backend.type === "firestore") {
    const snap = await backend.client.collection(`aivio_${collection}`).doc(docId).get();
    return snap.exists ? snap.data() : null;
  }

  const key = backend.client.key([collection, docId]);
  const [entity] = await backend.client.get(key);
  return entity || null;
}

export async function writeObject(collection, docId, data) {
  const backend = await getBackend();
  const payload = { ...data, id: docId, updatedAt: new Date().toISOString() };

  if (backend.type === "file") {
    const rows = readFileArray(collection);
    const idx = rows.findIndex((r) => String(r.id) === String(docId));
    if (idx >= 0) rows[idx] = { ...rows[idx], ...payload };
    else rows.push(payload);
    writeFileArray(collection, rows);
    return payload;
  }

  if (backend.type === "firestore") {
    await backend.client.collection(`aivio_${collection}`).doc(docId).set(payload);
    return payload;
  }

  const key = backend.client.key([collection, docId]);
  await backend.client.save({ key, data: payload });
  return payload;
}

export async function listRecords(collection, { limit = 500, orderField = "createdAt" } = {}) {
  const backend = await getBackend();

  if (backend.type === "file") {
    const rows = readFileArray(collection);
    return rows
      .sort((a, b) => String(b[orderField] || "").localeCompare(String(a[orderField] || "")))
      .slice(0, limit);
  }

  if (backend.type === "firestore") {
    const snap = await backend.client.collection(`aivio_${collection}`)
      .orderBy(orderField, "desc")
      .limit(limit)
      .get();
    const rows = [];
    snap.forEach((doc) => rows.push({ id: doc.id, ...doc.data() }));
    return rows;
  }

  const query = backend.client.createQuery(collection).order(orderField, { descending: true }).limit(limit);
  const [rows] = await backend.client.runQuery(query);
  return rows.map((row) => ({ ...row }));
}

export async function appendRecord(collection, item) {
  const backend = await getBackend();
  const record = { ...item, id: item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };

  if (backend.type === "file") {
    const rows = readFileArray(collection);
    rows.push(record);
    writeFileArray(collection, rows);
    return record;
  }

  if (backend.type === "firestore") {
    await backend.client.collection(`aivio_${collection}`).doc(String(record.id)).set(record);
    return record;
  }

  const key = backend.client.key([collection, String(record.id)]);
  await backend.client.save({ key, data: record });
  return record;
}

export async function upsertRecord(collection, id, patch) {
  const existing = await readObject(collection, id);
  const merged = {
    ...(existing || {}),
    ...patch,
    id: String(id),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  return writeObject(collection, id, merged);
}

export async function updateRecord(collection, id, patch) {
  const existing = await readObject(collection, id);
  if (!existing) return null;
  const merged = { ...existing, ...patch, id: String(id), updatedAt: new Date().toISOString() };
  return writeObject(collection, id, merged);
}

export async function findRecord(collection, predicate) {
  const rows = await listRecords(collection, { limit: 2000 });
  return rows.find(predicate) || null;
}

export function ensureStorageFiles() {
  try {
    ensureDataDir();
    for (const name of ["leads", "appointments", "conversations", "cms_save_log"]) {
      const fp = filePath(name);
      if (!fs.existsSync(fp)) fs.writeFileSync(fp, "[]");
    }
    const cmsFp = path.join(DATA_DIR, "robot-cms.json");
    if (!fs.existsSync(cmsFp)) fs.writeFileSync(cmsFp, "{}");
  } catch (err) {
    console.warn("[Storage] init hiba:", err?.message || err);
  }
}
