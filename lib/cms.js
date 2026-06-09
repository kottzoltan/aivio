import fs from "fs";
import path from "path";
import { DATA_DIR, getBackend, readObject, writeObject } from "./storage.js";
import { ROBOTS, getRobotConfigFromOverrides } from "./robots.js";

const ROBOT_CMS_FILE = path.join(DATA_DIR, "robot-cms.json");

function readLocalOverrides() {
  try {
    if (!fs.existsSync(ROBOT_CMS_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(ROBOT_CMS_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalOverrides(overrides) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ROBOT_CMS_FILE, JSON.stringify(overrides, null, 2));
}

export async function readCmsOverrides() {
  const localOverrides = readLocalOverrides();
  const backend = await getBackend();

  if (backend.type === "file") return localOverrides;

  if (backend.type === "firestore") {
    try {
      const snap = await backend.client.collection("aivio_cms").doc("robot_overrides").get();
      if (!snap.exists) {
        if (Object.keys(localOverrides).length > 0) {
          await backend.client.collection("aivio_cms").doc("robot_overrides").set({
            overrides: localOverrides,
            updatedAt: new Date().toISOString()
          });
        }
        return localOverrides;
      }
      const data = snap.data() || {};
      const remote = data.overrides && typeof data.overrides === "object" ? data.overrides : {};
      return Object.keys(remote).length === 0 && Object.keys(localOverrides).length > 0 ? localOverrides : remote;
    } catch (err) {
      console.error("CMS READ ERROR:", err?.message || err);
      return localOverrides;
    }
  }

  try {
    const key = backend.client.key(["AivioCmsConfig", "robot_overrides"]);
    const [entity] = await backend.client.get(key);
    if (!entity) {
      if (Object.keys(localOverrides).length > 0) {
        await backend.client.save({
          key,
          data: { overrides: localOverrides, updatedAt: new Date().toISOString() },
          excludeFromIndexes: ["overrides"]
        });
      }
      return localOverrides;
    }
    const remote = entity.overrides && typeof entity.overrides === "object" ? entity.overrides : {};
    return Object.keys(remote).length === 0 && Object.keys(localOverrides).length > 0 ? localOverrides : remote;
  } catch (err) {
    console.error("CMS READ ERROR (DATASTORE):", err?.message || err);
    return localOverrides;
  }
}

export async function writeCmsOverrides(overrides) {
  const backend = await getBackend();
  writeLocalOverrides(overrides);

  if (backend.type === "file") return;

  if (backend.type === "firestore") {
    await backend.client.collection("aivio_cms").doc("robot_overrides").set({
      overrides,
      updatedAt: new Date().toISOString()
    });
    return;
  }

  const key = backend.client.key(["AivioCmsConfig", "robot_overrides"]);
  await backend.client.save({
    key,
    data: { overrides, updatedAt: new Date().toISOString() },
    excludeFromIndexes: ["overrides"]
  });
}

export async function getRobotConfig(robotKey) {
  const overrides = await readCmsOverrides();
  return getRobotConfigFromOverrides(robotKey, overrides);
}

export async function listRobotConfigs() {
  const overrides = await readCmsOverrides();
  return Object.keys(ROBOTS).map((key) => getRobotConfigFromOverrides(key, overrides));
}

export async function saveRobotConfig(robotKey, fields) {
  const base = ROBOTS[robotKey];
  if (!base) return null;

  const overrides = await readCmsOverrides();
  const updatedAt = new Date().toISOString();

  overrides[robotKey] = {
    title: String(fields.title || base.title).trim(),
    intro: String(fields.intro || base.intro).trim(),
    systemPrompt: String(fields.systemPrompt || base.systemPrompt).trim(),
    styleGuide: String(fields.styleGuide || "").trim(),
    script: String(fields.script || "").trim(),
    knowledgeBase: String(fields.knowledgeBase || "").trim(),
    updatedAt
  };

  await writeCmsOverrides(overrides);
  return getRobotConfigFromOverrides(robotKey, overrides);
}
