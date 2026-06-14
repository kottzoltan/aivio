import express from "express";
import OpenAI from "openai";
import path from "path";
import fetch from "node-fetch";
import fs from "fs";

import { getProjectRoot, isDirectNodeEntry } from "./lib/paths.js";
import { buildRobotSystemPrompt, ROBOTS } from "./lib/robots.js";
import { getRobotConfig, listRobotConfigs, saveRobotConfig } from "./lib/cms.js";
import {
  LEAD_STAGES,
  listLeads,
  getLead,
  createLead,
  updateLead,
  addLeadNote,
  getPipelineStats,
  listAppointments,
  createAppointment,
  logConversation,
  logCmsSave,
  listCmsSaveLog
} from "./lib/leads.js";
import { processConversationTurn } from "./lib/conversation.js";
import { ensureStorageFiles, getStorageInfo } from "./lib/storage.js";

console.log("[AIVIO] indulás…");

const projectRoot = getProjectRoot();

if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const credPath = path.join("/tmp", "gcp-credentials.json");
  fs.writeFileSync(credPath, process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
}

const app = express();
const PORT = Number(process.env.PORT) || 8080;
const REV = "rev_human_conversation_flow_2026_06_08";

app.use(express.json({ limit: "2mb" }));

const CORS_ORIGINS = (process.env.CORS_ORIGINS || "https://kaizo.hu,https://www.kaizo.hu,https://aivio3.netlify.app,http://127.0.0.1:8080,http://localhost:8080")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  app.use(express.static(path.join(projectRoot, "public")));
}

ensureStorageFiles();

//////////////////////////////////////////////////////////
// HEALTH
//////////////////////////////////////////////////////////

app.get("/health", async (req, res) => {
  const storage = await getStorageInfo();
  res.json({
    ok: true,
    rev: REV,
    openai: !!process.env.OPENAI_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    supabase: storage.supabaseReady,
    storage: storage.activeStorage,
    debug: {
      cmsStorageProvider: process.env.CMS_STORAGE_PROVIDER || "(nincs, default: file)",
      hasSupabaseUrl: !!process.env.SUPABASE_URL,
      hasSupabaseKey: !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY),
      supabasePreferred: storage.supabasePreferred,
      supabaseError: storage.supabaseLastError || null
    }
  });
});

//////////////////////////////////////////////////////////
// ROBOTS
//////////////////////////////////////////////////////////

app.get("/robots", async (req, res) => {
  const robots = await listRobotConfigs();
  res.json({
    robots: robots.map((cfg) => ({
      key: cfg.key,
      title: cfg.title,
      intro: cfg.intro,
      source: cfg.source,
      updatedAt: cfg.updatedAt
    }))
  });
});

//////////////////////////////////////////////////////////
// THINK — emberi beszélgetés + lead mentés
//////////////////////////////////////////////////////////

app.post("/think", async (req, res) => {
  try {
    const { text, robot = "outbound_sales", history = [], sessionId } = req.body || {};
    if (!text) return res.status(400).json({ error: "Missing text" });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    const cfg = await getRobotConfig(robot);
    if (!cfg) return res.status(400).json({ error: "Unknown robot" });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const chatHistory = Array.isArray(history) ? history.slice(-12) : [];

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      messages: [
        { role: "system", content: buildRobotSystemPrompt(cfg) },
        ...chatHistory,
        { role: "user", content: text }
      ],
      temperature: 0.75,
      max_tokens: 220
    });

    const aiText = completion.choices[0].message.content.trim();

    await logConversation({
      sessionId: sessionId || null,
      robot,
      userText: text,
      aiText,
      createdAt: new Date().toISOString()
    });

    const { lead } = await processConversationTurn({
      sessionId: sessionId || `anon-${Date.now()}`,
      robot,
      history: chatHistory,
      userText: text,
      aiText
    });

    res.json({ text: aiText, sessionId: sessionId || lead.sessionId, leadId: lead.id });
  } catch (err) {
    console.error("THINK ERROR:", err);
    res.status(500).json({ error: "Thinking failed" });
  }
});

//////////////////////////////////////////////////////////
// SPEAK — ElevenLabs TTS
//////////////////////////////////////////////////////////

app.post("/speak", async (req, res) => {
  try {
    const { text, voiceId, model_id } = req.body;
    if (!text || !voiceId) return res.status(400).send("Missing data");
    if (!process.env.ELEVENLABS_API_KEY) return res.status(500).send("Missing ELEVENLABS_API_KEY");

    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: model_id || "eleven_flash_v2_5",
        output_format: "mp3_44100_128"
      })
    });

    if (!r.ok) {
      const upstreamError = await r.text().catch(() => "");
      console.error("SPEAK UPSTREAM ERROR:", r.status, upstreamError);
      return res.status(502).send(`ElevenLabs error (${r.status})`);
    }

    const contentType = (r.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("audio")) {
      return res.status(502).send("ElevenLabs did not return audio");
    }

    const audioBuffer = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", String(audioBuffer.length));
    res.setHeader("Cache-Control", "no-store");
    res.end(audioBuffer);
  } catch (err) {
    console.error("SPEAK ERROR:", err);
    res.status(500).send("TTS error");
  }
});

//////////////////////////////////////////////////////////
// CRM API — saját adatbázis
//////////////////////////////////////////////////////////

app.get("/api/crm/stages", (req, res) => {
  res.json(LEAD_STAGES);
});

app.get("/api/crm/leads", async (req, res) => {
  try {
    res.json(await listLeads());
  } catch (err) {
    console.error("CRM LEADS ERROR:", err);
    res.status(500).json({ error: "CRM leads failed" });
  }
});

app.get("/api/crm/leads/:id", async (req, res) => {
  try {
    const lead = await getLead(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: "Lead fetch failed" });
  }
});

app.post("/api/crm/leads", async (req, res) => {
  try {
    const { name, email, phone, company, stage, expectedRevenue } = req.body || {};
    if (!name) return res.status(400).json({ error: "Missing name" });
    const lead = await createLead({ name, email, phone, company, stage, expectedRevenue, source: "manual" });
    res.json({ ok: true, lead });
  } catch (err) {
    res.status(500).json({ error: "Lead create failed" });
  }
});

app.post("/api/crm/update-stage", async (req, res) => {
  try {
    const { leadId, stageId } = req.body || {};
    if (!leadId || !stageId) return res.status(400).json({ error: "Missing leadId or stageId" });
    const lead = await updateLead(String(leadId), { stage: String(stageId) });
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json({ ok: true, lead });
  } catch (err) {
    res.status(500).json({ error: "Update stage failed" });
  }
});

app.post("/api/crm/add-note", async (req, res) => {
  try {
    const { leadId, message } = req.body || {};
    if (!leadId || !message) return res.status(400).json({ error: "Missing leadId or message" });
    const lead = await addLeadNote(String(leadId), message);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json({ ok: true, lead });
  } catch (err) {
    res.status(500).json({ error: "Add note failed" });
  }
});

app.get("/api/crm/recent", async (req, res) => {
  try {
    const leads = await listLeads({ limit: 10 });
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: "Recent leads failed" });
  }
});

app.get("/api/crm/pipeline", async (req, res) => {
  try {
    const { pipeline, totals } = await getPipelineStats();
    res.json({ rev: REV, generatedAt: new Date().toISOString(), totals, pipeline });
  } catch (err) {
    res.status(500).json({ error: "Pipeline failed" });
  }
});

app.get("/api/crm/appointments", async (req, res) => {
  try {
    res.json(await listAppointments());
  } catch (err) {
    res.status(500).json({ error: "Appointments failed" });
  }
});

app.post("/api/crm/appointments", async (req, res) => {
  try {
    const { name, start, stop, leadId } = req.body || {};
    if (!name || !start || !stop) return res.status(400).json({ error: "Missing name, start or stop" });
    const appt = await createAppointment({ name, start, stop, leadId });
    res.json({ ok: true, appointment: appt });
  } catch (err) {
    res.status(500).json({ error: "Appointment create failed" });
  }
});

app.get("/crm/list", async (req, res) => {
  try {
    res.json(await listLeads({ limit: 50 }));
  } catch (err) {
    res.status(500).json({ error: "CRM list failed" });
  }
});

//////////////////////////////////////////////////////////
// CMS API
//////////////////////////////////////////////////////////

app.get("/api/cms/robots", async (req, res) => {
  const robots = await listRobotConfigs();
  const saveLog = await listCmsSaveLog(20);
  const storage = await getStorageInfo();
  res.json({ rev: REV, storage, robots, saveLog });
});

app.get("/api/cms/robots/:key", async (req, res) => {
  const cfg = await getRobotConfig(req.params.key);
  if (!cfg) return res.status(404).json({ error: "Unknown robot" });
  res.json(cfg);
});

app.put("/api/cms/robots/:key", async (req, res) => {
  try {
    const robotKey = req.params.key;
    if (!ROBOTS[robotKey]) return res.status(404).json({ error: "Unknown robot" });

    const {
      title = "",
      intro = "",
      systemPrompt = "",
      styleGuide = "",
      script = "",
      knowledgeBase = ""
    } = req.body || {};

    const robot = await saveRobotConfig(robotKey, {
      title, intro, systemPrompt, styleGuide, script, knowledgeBase
    });

    const updatedAt = new Date().toISOString();
    await logCmsSave({ robotKey, updatedAt, action: "save" });

    res.json({ ok: true, robot });
  } catch (err) {
    console.error("CMS UPDATE ERROR:", err);
    res.status(500).json({ error: "CMS update failed" });
  }
});

//////////////////////////////////////////////////////////
// GCP SECRET MANAGER
//////////////////////////////////////////////////////////

const SECRET_NAMES = [
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "ELEVENLABS_API_KEY",
  "CMS_STORAGE_PROVIDER"
];

function getMissingSecretNames() {
  return SECRET_NAMES.filter((name) => !process.env[name]);
}

async function loadEnvFromSecretManager() {
  const missing = getMissingSecretNames();
  if (missing.length === 0) return;

  let projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!projectId && process.env.K_SERVICE) {
    try {
      const r = await fetch("http://metadata.google.internal/computeMetadata/v1/project/project-id", {
        headers: { "Metadata-Flavor": "Google" }
      });
      if (r.ok) projectId = await r.text();
    } catch (_) {}
  }
  if (!projectId) return;

  try {
    const { SecretManagerServiceClient } = await import("@google-cloud/secret-manager");
    const client = new SecretManagerServiceClient();
    for (const name of missing) {
      try {
        const [version] = await client.accessSecretVersion({
          name: `projects/${projectId}/secrets/${name}/versions/latest`
        });
        const payload = version.payload?.data;
        if (payload) process.env[name] = Buffer.from(payload).toString("utf8").trim();
      } catch (e) {
        if (e?.code !== 5) console.warn(`[Secret Manager] ${name}: ${e?.message || e}`);
      }
    }
  } catch (err) {
    console.warn("[Secret Manager] Init hiba:", err?.message || err);
  }
}

//////////////////////////////////////////////////////////
// START SERVER
//////////////////////////////////////////////////////////

export { app, REV };

const isMain = isDirectNodeEntry(import.meta?.url, process.argv[1]);

if (isMain) {
  const HOST = process.env.HOST || "0.0.0.0";
  const server = app.listen(PORT, HOST, () => {
    console.log(`[AIVIO] backend fut: ${HOST}:${PORT} | ${REV}`);
  });
  server.on("error", (err) => {
    console.error("[AIVIO] szerver indítási hiba:", err);
    process.exit(1);
  });
  loadEnvFromSecretManager().catch((err) => {
    console.warn("[Secret Manager] Háttérbetöltés hiba:", err?.message || err);
  });
}
