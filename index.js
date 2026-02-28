import express from "express";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 8080;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REV = "rev_stt_lock_and_retry_2026_02_16";

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

//////////////////////////////////////////////////////////
// FILE STORAGE (JSON - CLOUD RUN KOMPATIBILIS DEMO)
//////////////////////////////////////////////////////////

const DATA_DIR = path.join(__dirname, "data");
const CONV_FILE = path.join(DATA_DIR, "conversations.json");
const STRUCTURED_FILE = path.join(DATA_DIR, "structured-conversations.json");
const APPOINTMENTS_FILE = path.join(DATA_DIR, "appointments.json");
const SURVEY_FILE = path.join(DATA_DIR, "survey-answers.json");
const ROBOT_CMS_FILE = path.join(DATA_DIR, "robot-cms.json");
const ROBOT_CMS_SYNC_FILE = path.join(DATA_DIR, "robot-cms-sync-log.json");

const CMS_STORAGE_PROVIDER = (process.env.CMS_STORAGE_PROVIDER || "auto").toLowerCase();
let firestoreDb = null;
let firestoreInitAttempted = false;
let firestoreLastError = null;
let datastoreClient = null;
let datastoreInitAttempted = false;
let datastoreLastError = null;

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
    firestoreLastError = null;
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
    datastoreLastError = null;
    return datastoreClient;
  } catch (err) {
    datastoreLastError = err?.message || String(err);
    console.error("DATASTORE INIT ERROR:", datastoreLastError);
    return null;
  }
}

async function getCmsBackend() {
  const fs = await getFirestoreDb();
  if (fs) return { type: "firestore", client: fs };

  const ds = await getDatastoreClient();
  if (ds) return { type: "datastore", client: ds };

  return { type: "file", client: null };
}

async function getCmsStorageInfo() {
  const backend = await getCmsBackend();
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
function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONV_FILE)) fs.writeFileSync(CONV_FILE, JSON.stringify([]));
  if (!fs.existsSync(STRUCTURED_FILE)) fs.writeFileSync(STRUCTURED_FILE, JSON.stringify([]));
  if (!fs.existsSync(APPOINTMENTS_FILE)) fs.writeFileSync(APPOINTMENTS_FILE, JSON.stringify([]));
  if (!fs.existsSync(SURVEY_FILE)) fs.writeFileSync(SURVEY_FILE, JSON.stringify([]));
  if (!fs.existsSync(ROBOT_CMS_FILE)) fs.writeFileSync(ROBOT_CMS_FILE, JSON.stringify({}));
  if (!fs.existsSync(ROBOT_CMS_SYNC_FILE)) fs.writeFileSync(ROBOT_CMS_SYNC_FILE, JSON.stringify([]));
}

function readJsonArray(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendJsonItem(filePath, item) {
  const data = readJsonArray(filePath);
  data.push(item);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}


function readJsonObject(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonObject(filePath, data) {
  const safe = data && typeof data === "object" ? data : {};
  fs.writeFileSync(filePath, JSON.stringify(safe, null, 2));
}

ensureDataFiles();

//////////////////////////////////////////////////////////
// HEALTH
//////////////////////////////////////////////////////////

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    rev: REV,
    openai: !!process.env.OPENAI_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    odoo: !!process.env.ODOO_URL
  });
});

//////////////////////////////////////////////////////////
// ROBOTS (VÁLTOZATLAN LOGIKA)
//////////////////////////////////////////////////////////

const ROBOTS = {
  outbound_sales: {
    title: "Kimenő Sales Ügynök",
    intro: "Szia! Ari vagyok, az AIVIO AI sales specialistája. Azért hívom, hogy bemutassam, hogyan segíthet az AI megoldásunk az értékesítési folyamatában.",
    systemPrompt: `You are Ari, a professional outbound sales AI agent for AIVIO. You are making a sales call to qualify prospects and schedule a demo.

CONVERSATION FLOW:
1. Warm introduction: Briefly introduce yourself and the purpose of the call. Ask if this is a good time.
2. Rapport building: Ask about their current sales process or biggest challenge in reaching customers.
3. Pain point discovery: Ask one focused question about their current outreach or conversion challenges.
4. Value proposition: Share how AIVIO's AI voice agents solve that specific pain point (automated calls, 24/7 availability, consistent messaging).
5. Qualification: Ask about team size and whether they currently use any automation tools.
6. Appointment: Propose a 20-minute product demo and ask for their preferred day and time this week or next.
7. Confirmation: Confirm the appointment, get their email address for the calendar invite, and thank them.

RULES:
- Ask only ONE question at a time and wait for the answer.
- Keep responses short (2-3 sentences max).
- Be friendly, professional, and consultative - never pushy.
- If they object, acknowledge it empathetically and ask a clarifying question.
- Gather: name, company, email, phone number, preferred appointment date/time.
- Language: respond in the same language the prospect uses (Hungarian or English).`
  },
  email_sales: {
    title: "Időpontfoglaló Asszisztens",
    intro: "Jó napot! A Foglaló Asszisztens vagyok. Segítek Önnek időpontot és szolgáltatást kiválasztani.",
    systemPrompt: `You are a friendly booking assistant for a service business. Your job is to help callers reserve a time slot and select the right service.

CONVERSATION FLOW:
1. Greeting: Welcome the caller and ask for their name.
2. Service selection: Ask which service they are interested in (e.g., consultation, demo, maintenance, training). Present up to 3 options if they are unsure.
3. Date preference: Ask for their preferred date ("Do you have a specific day in mind, or shall I suggest available slots?").
4. Time preference: Once the date is confirmed, ask for a preferred time window (morning / afternoon / evening).
5. Contact details: Ask for their phone number and email address to send a confirmation.
6. Summary & confirmation: Read back all booking details (name, service, date, time) and ask the caller to confirm.
7. Closing: Thank them, mention they will receive a confirmation email, and wish them a good day.

RULES:
- Ask only ONE question at a time.
- Keep responses concise and clear.
- If a requested slot is unavailable, apologize and offer the next available option.
- Confirm all details before ending the call.
- Gather: full name, selected service, appointment date, appointment time, phone number, email.
- Language: respond in the same language the caller uses (Hungarian or English).`
  },
  support_inbound: {
    title: "Bejövő Ügyfélszolgálat",
    intro: "Üdvözlöm! Az ügyfélszolgálaton vagyok. Hogyan segíthetek Önnek ma?",
    systemPrompt: `You are an empathetic inbound customer support AI agent. Your goal is to understand the customer's issue and guide them to a resolution step by step.

CONVERSATION FLOW:
1. Empathetic greeting: Acknowledge the customer and ask them to describe the issue in their own words.
2. Active listening & clarification: Summarize what you understood ("Just to make sure I understand -- you're experiencing X. Is that correct?") and ask one clarifying question if needed.
3. Troubleshooting step 1: Provide the first, simplest troubleshooting step and ask them to try it.
4. Check result: Ask whether the issue is resolved. If yes, proceed to closing. If no, continue to the next step.
5. Troubleshooting step 2: Provide the next step (escalation, restart, settings change, etc.) and confirm the outcome.
6. Escalation (if unresolved): If the issue persists after two steps, apologise, gather their contact details (name, email, phone), and inform them a specialist will follow up within 24 hours.
7. Closing: Summarise the resolution (or escalation), ask if there is anything else you can help with, and thank them for contacting support.

RULES:
- Ask only ONE question at a time.
- Always acknowledge the customer's frustration before jumping to solutions.
- Keep technical instructions simple and jargon-free.
- Never make the customer feel blamed for the issue.
- Gather: customer name, contact email or phone, issue description, resolution status.
- Language: respond in the same language the customer uses (Hungarian or English).`
  },
  lead_qualifier: {
    title: "Lead Minősítő Ügynök",
    intro: "Szia! A Lead Minősítő Asszisztens vagyok. Néhány gyors kérdéssel szeretném megérteni, miben segíthetek a legjobban.",
    systemPrompt: `You are a lead qualification AI agent using the BANT framework (Budget, Authority, Need, Timeline). Your goal is to qualify inbound leads efficiently and hand off high-quality prospects to the sales team.

CONVERSATION FLOW:
1. Introduction: Briefly explain the purpose of the conversation ("I'd like to ask a few quick questions to understand how we can best help you.").
2. NEED - Discover the problem: Ask what challenge or goal brought them to reach out today. Listen actively and probe with one follow-up question if the need is vague.
3. AUTHORITY - Decision-maker check: Ask who is typically involved in decisions like this at their company ("Are you the main person evaluating solutions like ours, or are there others involved?").
4. BUDGET - Budget awareness: Ask if they have a budget range in mind or if they are still in the early research phase. Frame it non-intrusively ("Just so I can point you to the right options.").
5. TIMELINE - Urgency: Ask when they would ideally like to have a solution in place.
6. Summary & scoring: Briefly summarise what you heard and tell them what the next step will be (demo, proposal, or referral to a specialist).
7. Contact capture: Ask for their full name, email, company name, and phone number to pass to the right team member.

RULES:
- Ask only ONE question at a time and wait for the full answer before continuing.
- Be conversational and curious, not interrogative.
- If a prospect hesitates on budget, reassure them and move on - don't pressure.
- Qualify honestly: if the fit seems poor, politely let them know and suggest alternatives.
- Gather: name, company, email, phone, budget range, decision-making role, primary need, desired timeline.
- Language: respond in the same language the lead uses (Hungarian or English).`
  },
  customer_satisfaction: {
    title: "Visszajelzés Gyűjtő",
    intro: "Jó napot! A visszajelzés-gyűjtő asszisztens vagyok. Csak néhány percet venne igénybe — az Ön véleménye nagyon fontos számunkra.",
    systemPrompt: `You are a friendly feedback collection AI agent conducting a post-interaction survey. Your goal is to gather structured, actionable feedback from customers.

CONVERSATION FLOW:
1. Introduction: Thank the customer for their time and explain the survey will take about 2 minutes.
2. Overall satisfaction: Ask them to rate their overall experience on a scale of 1 to 5 (1 = very dissatisfied, 5 = very satisfied). Wait for the number.
3. Follow-up on score: If the score is 4 or 5, ask what specifically they appreciated most. If the score is 1, 2, or 3, ask empathetically what went wrong or could be improved.
4. Service quality: Ask specifically about the quality of the service they received ("How would you rate the quality of our service on a scale of 1-5?").
5. Staff/communication: Ask how satisfied they were with communication or the support they received, on a scale of 1 to 5.
6. Improvement suggestion: Ask one open-ended question: "Is there anything specific we could do better next time?"
7. Recommendation: Ask how likely they are to recommend the service to a friend or colleague on a scale of 1-10 (Net Promoter Score).
8. Closing: Thank them sincerely, let them know their feedback will be reviewed, and wish them a great day.

RULES:
- Ask only ONE question at a time. Wait for the answer before moving on.
- When the customer gives a numeric rating, always acknowledge it before asking the next question.
- Keep the tone warm, appreciative, and non-pressuring.
- If the customer wants to elaborate, let them - then gently guide back to the next question.
- Gather: overall satisfaction score (1-5), service quality score (1-5), communication score (1-5), open improvement comment, NPS score (1-10).
- Language: respond in the same language the customer uses (Hungarian or English).`
  }
};

async function readCmsOverrides() {
  const localOverrides = readJsonObject(ROBOT_CMS_FILE);
  const backend = await getCmsBackend();

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
      firestoreLastError = err?.message || String(err);
      console.error("CMS READ ERROR:", firestoreLastError);
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
    datastoreLastError = err?.message || String(err);
    console.error("CMS READ ERROR (DATASTORE):", datastoreLastError);
    return localOverrides;
  }
}

async function writeCmsOverrides(overrides) {
  const backend = await getCmsBackend();

  writeJsonObject(ROBOT_CMS_FILE, overrides);

  if (backend.type === "file") return;

  if (backend.type === "firestore") {
    try {
      await backend.client.collection("aivio_cms").doc("robot_overrides").set({
        overrides,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      firestoreLastError = err?.message || String(err);
      console.error("CMS WRITE ERROR:", firestoreLastError);
    }
    return;
  }

  try {
    const key = backend.client.key(["AivioCmsConfig", "robot_overrides"]);
    await backend.client.save({
      key,
      data: { overrides, updatedAt: new Date().toISOString() },
      excludeFromIndexes: ["overrides"]
    });
  } catch (err) {
    datastoreLastError = err?.message || String(err);
    console.error("CMS WRITE ERROR (DATASTORE):", datastoreLastError);
  }
}

async function readCmsSyncLog(limit = 20) {
  const localRows = readJsonArray(ROBOT_CMS_SYNC_FILE).slice(-limit).reverse();
  const backend = await getCmsBackend();
  if (backend.type === "file") return localRows;

  if (backend.type === "firestore") {
    try {
      const snap = await backend.client
        .collection("aivio_cms_sync_log")
        .orderBy("updatedAt", "desc")
        .limit(limit)
        .get();

      const rows = [];
      snap.forEach((doc) => rows.push(doc.data()));
      return rows.length > 0 ? rows : localRows;
    } catch (err) {
      firestoreLastError = err?.message || String(err);
      console.error("CMS SYNC LOG READ ERROR:", firestoreLastError);
      return localRows;
    }
  }

  try {
    const query = backend.client.createQuery("AivioCmsSyncLog").order("updatedAt", { descending: true }).limit(limit);
    const [rows] = await backend.client.runQuery(query);
    return rows && rows.length > 0 ? rows : localRows;
  } catch (err) {
    datastoreLastError = err?.message || String(err);
    console.error("CMS SYNC LOG READ ERROR (DATASTORE):", datastoreLastError);
    return localRows;
  }
}

async function appendCmsSyncLog(item) {
  appendJsonItem(ROBOT_CMS_SYNC_FILE, item);

  const backend = await getCmsBackend();
  if (backend.type === "file") return;

  if (backend.type === "firestore") {
    try {
      await backend.client.collection("aivio_cms_sync_log").doc(String(item.id)).set(item);
    } catch (err) {
      firestoreLastError = err?.message || String(err);
      console.error("CMS SYNC LOG WRITE ERROR:", firestoreLastError);
    }
    return;
  }

  try {
    const key = backend.client.key(["AivioCmsSyncLog", String(item.id)]);
    await backend.client.save({
      key,
      data: item,
      excludeFromIndexes: ["odooSync.error"]
    });
  } catch (err) {
    datastoreLastError = err?.message || String(err);
    console.error("CMS SYNC LOG WRITE ERROR (DATASTORE):", datastoreLastError);
  }
}

function getRobotConfigFromOverrides(robotKey, overrides = {}) {
  const base = ROBOTS[robotKey];
  if (!base) return null;

  const cms = overrides[robotKey] || {};
  return {
    key: robotKey,
    title: String(cms.title || base.title),
    intro: String(cms.intro || base.intro),
    systemPrompt: String(cms.systemPrompt || base.systemPrompt),
    styleGuide: String(cms.styleGuide || ""),
    script: String(cms.script || ""),
    knowledgeBase: String(cms.knowledgeBase || ""),
    updatedAt: cms.updatedAt || null,
    source: cms.updatedAt ? "cms_override" : "default"
  };
}

async function getRobotConfig(robotKey) {
  const overrides = await readCmsOverrides();
  return getRobotConfigFromOverrides(robotKey, overrides);
}

function buildRobotSystemPrompt(cfg) {
  const parts = [cfg.systemPrompt.trim()];

  if (cfg.styleGuide?.trim()) {
    parts.push(`STÍLUS ÚTMUTATÓ:
${cfg.styleGuide.trim()}`);
  }

  if (cfg.script?.trim()) {
    parts.push(`KÖTELEZŐ SCRIPT / MENET:
${cfg.script.trim()}`);
  }

  if (cfg.knowledgeBase?.trim()) {
    parts.push(`TUDÁSANYAG:
${cfg.knowledgeBase.trim()}`);
  }

  return parts.join("\n\n");
}

app.get("/robots", async (req, res) => {
  const overrides = await readCmsOverrides();
  const list = Object.keys(ROBOTS).map((key) => {
    const cfg = getRobotConfigFromOverrides(key, overrides);
    return {
      key,
      title: cfg.title,
      intro: cfg.intro,
      source: cfg.source,
      updatedAt: cfg.updatedAt
    };
  });
  res.json({ robots: list });
});

//////////////////////////////////////////////////////////
// THINK (SÉRTHETETLEN BESZÉD + ORCHESTRATION)
//////////////////////////////////////////////////////////

app.post("/think", async (req, res) => {
  try {
    const { text, robot = "outbound_sales", history = [] } = req.body || {};
    if (!text) return res.status(400).json({ error: "Missing text" });

    const cfg = await getRobotConfig(robot);
    if (!cfg) return res.status(400).json({ error: "Unknown robot" });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1",
      messages: [
        { role: "system", content: buildRobotSystemPrompt(cfg) },
        ...(Array.isArray(history) ? history.slice(-10) : []),
        { role: "user", content: text }
      ],
      temperature: 0.4
    });

    const aiText = completion.choices[0].message.content.trim();

    logConversation(robot, text, aiText);
    await postProcess(robot, text, aiText);

    res.json({ text: aiText });
  } catch (err) {
    console.error("THINK ERROR:", err);
    res.status(500).json({ error: "Thinking failed" });
  }
});

//////////////////////////////////////////////////////////
// SPEAK (ÉRINTETLEN HANGMINŐSÉG)
//////////////////////////////////////////////////////////

app.post("/speak", async (req, res) => {
  try {
    const { text, voiceId, model_id } = req.body;
    if (!text || !voiceId) return res.status(400).send("Missing data");
    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(500).send("Missing ELEVENLABS_API_KEY");
    }

    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: model_id || "eleven_flash_v2_5"
      })
    });

    if (!r.ok) {
      const upstreamError = await r.text().catch(() => "");
      console.error("SPEAK UPSTREAM ERROR:", r.status, upstreamError);
      return res.status(502).send(`ElevenLabs error (${r.status})`);
    }

    const contentType = (r.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("audio")) {
      const unexpected = await r.text().catch(() => "");
      console.error("SPEAK INVALID CONTENT-TYPE:", contentType, unexpected);
      return res.status(502).send("ElevenLabs did not return audio");
    }

    const audioBuffer = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (err) {
    console.error("SPEAK ERROR:", err);
    res.status(500).send("TTS error");
  }
});

//////////////////////////////////////////////////////////
// LOCAL CONVERSATION LOG
//////////////////////////////////////////////////////////

function logConversation(robot, userText, aiText) {
  appendJsonItem(CONV_FILE, {
    id: Date.now(),
    robot,
    userText,
    aiText,
    createdAt: new Date().toISOString()
  });
}

//////////////////////////////////////////////////////////
// ODOO LOGIN + HELPERS
//////////////////////////////////////////////////////////

function parseOdooErrorMessage(rawError) {
  if (!rawError) return "Ismeretlen Odoo hiba";

  const rawText = typeof rawError === "string" ? rawError : (rawError.message || String(rawError));
  try {
    const parsed = JSON.parse(rawText);
    if (parsed?.error?.data?.message) return parsed.error.data.message;
    if (parsed?.error?.message) return parsed.error.message;
    if (parsed?.message) return parsed.message;
  } catch {
    // ignore JSON parse error
  }

  return rawText;
}

async function odooLogin() {
  const r = await fetch(`${process.env.ODOO_URL}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "common",
        method: "login",
        args: [process.env.ODOO_DB, process.env.ODOO_USER, process.env.ODOO_API_KEY]
      },
      id: Date.now()
    })
  });

  const data = await r.json();

  if (data?.error) {
    throw new Error(`Odoo login hiba: ${parseOdooErrorMessage(JSON.stringify(data))}`);
  }

  const uid = data?.result;
  if (!uid) {
    throw new Error("Odoo login sikertelen: nincs UID. Ellenőrizd az ODOO_DB / ODOO_USER / ODOO_API_KEY értékeket.");
  }

  return Number(uid);
}

async function odooExecute(uid, model, method, args = [], kwargs = {}) {
  if (!uid) {
    throw new Error("Odoo művelet megszakítva: hiányzó UID (login sikertelen).");
  }

  const r = await fetch(`${process.env.ODOO_URL}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "object",
        method: "execute_kw",
        args: [process.env.ODOO_DB, uid, process.env.ODOO_API_KEY, model, method, args, kwargs]
      },
      id: Date.now()
    })
  });

  const data = await r.json();
  if (data.error) throw new Error(parseOdooErrorMessage(JSON.stringify(data)));
  return data.result;
}

//////////////////////////////////////////////////////////
// PHASE 1: STRUCTURED EXTRACTORS
//////////////////////////////////////////////////////////

function extractContact(text) {
  const email = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  const phone = text.match(/\+?\d[\d\s\-]{7,}/);
  return {
    email: email ? email[0] : null,
    phone: phone ? phone[0].replace(/\s+/g, " ").trim() : null
  };
}

function extractCompany(text) {
  const companyPattern = /(?:cég(?:em|ünk)?|vállalat(?:om|unk)?|company)\s*[:\-]?\s*([A-Za-zÀ-ž0-9 .&\-]{2,80})/i;
  const m = text.match(companyPattern);
  return m ? m[1].trim() : null;
}

function parseAppointmentDate(text) {
  const isoLike = text.match(/\b(20\d{2})[-.\/](\d{1,2})[-.\/](\d{1,2})(?:[ T](\d{1,2})[:.](\d{2}))?\b/);
  if (isoLike) {
    const y = Number(isoLike[1]);
    const mo = Number(isoLike[2]);
    const d = Number(isoLike[3]);
    const hh = Number(isoLike[4] || "10");
    const mm = Number(isoLike[5] || "00");
    const dt = new Date(Date.UTC(y, mo - 1, d, hh, mm, 0));
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  const huLike = text.match(/\b(\d{1,2})[.\-\/](\d{1,2})[.\-\/]?(20\d{2})?(?:\s*(?:at|kor)?\s*(\d{1,2})[:.](\d{2}))?\b/i);
  if (huLike) {
    const year = Number(huLike[3] || new Date().getUTCFullYear());
    const month = Number(huLike[2]);
    const day = Number(huLike[1]);
    const hh = Number(huLike[4] || "10");
    const mm = Number(huLike[5] || "00");
    const dt = new Date(Date.UTC(year, month - 1, day, hh, mm, 0));
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  return null;
}

function extractSurveyAnswers(text) {
  const answers = [];
  const regex = /(?:\b([1-5])\b\s*(?:\/\s*5)?|([1-5])\s*(?:pont|score))/gi;
  let m;
  while ((m = regex.exec(text)) !== null) {
    answers.push(Number(m[1] || m[2]));
  }
  return answers;
}

function extractStructuredConversation(text, robot) {
  const contact = extractContact(text);
  const company = extractCompany(text);
  const appointmentDate = parseAppointmentDate(text);

  return {
    robot,
    email: contact.email,
    phone: contact.phone,
    company,
    appointmentIsoUtc: appointmentDate ? appointmentDate.toISOString() : null,
    surveyScores: robot === "customer_satisfaction" ? extractSurveyAnswers(text) : [],
    rawText: text
  };
}

//////////////////////////////////////////////////////////
// ORCHESTRATION LAYER
//////////////////////////////////////////////////////////

async function postProcess(robot, text, aiText) {
  const structured = extractStructuredConversation(text, robot);

  appendJsonItem(STRUCTURED_FILE, {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    ...structured
  });

  try {
    const uid = await odooLogin();

    if (robot === "outbound_sales") {
      if (structured.email || structured.phone || structured.company) {
        await odooExecute(uid, "crm.lead", "create", [[{
          name: structured.company || "AI Sales Lead",
          email_from: structured.email,
          phone: structured.phone,
          description: text
        }]]);
      }

      if (structured.appointmentIsoUtc) {
        const start = new Date(structured.appointmentIsoUtc);
        const stop = new Date(start.getTime() + 60 * 60 * 1000);

        const calendarId = await odooExecute(uid, "calendar.event", "create", [[{
          name: "AI Sales Meeting",
          description: text,
          start: start.toISOString().slice(0, 19).replace("T", " "),
          stop: stop.toISOString().slice(0, 19).replace("T", " ")
        }]]);

        appendJsonItem(APPOINTMENTS_FILE, {
          id: Date.now(),
          robot,
          source: "outbound_sales",
          text,
          aiText,
          startUtc: start.toISOString(),
          stopUtc: stop.toISOString(),
          odooCalendarEventId: calendarId,
          createdAt: new Date().toISOString()
        });
      }
    }

    if (robot === "email_sales") {
      const parsedStart = structured.appointmentIsoUtc ? new Date(structured.appointmentIsoUtc) : new Date(Date.now() + 24 * 60 * 60 * 1000);
      const parsedStop = new Date(parsedStart.getTime() + 60 * 60 * 1000);

      const bookingId = await odooExecute(uid, "calendar.event", "create", [[{
        name: "AI Booking",
        description: text,
        start: parsedStart.toISOString().slice(0, 19).replace("T", " "),
        stop: parsedStop.toISOString().slice(0, 19).replace("T", " ")
      }]]);

      appendJsonItem(APPOINTMENTS_FILE, {
        id: Date.now(),
        robot,
        source: "email_sales",
        text,
        aiText,
        startUtc: parsedStart.toISOString(),
        stopUtc: parsedStop.toISOString(),
        odooCalendarEventId: bookingId,
        createdAt: new Date().toISOString()
      });
    }

    if (robot === "customer_satisfaction") {
      const surveyId = await odooExecute(uid, "survey.user_input", "create", [[{ state: "done" }]]);

      appendJsonItem(SURVEY_FILE, {
        id: Date.now(),
        robot,
        odooSurveyInputId: surveyId,
        answers: structured.surveyScores,
        rawText: text,
        aiText,
        createdAt: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error("POST PROCESS ERROR:", err);
  }
}

//////////////////////////////////////////////////////////
// ADMIN + CRM API
//////////////////////////////////////////////////////////

app.get("/admin/conversations", (req, res) => {
  res.json(readJsonArray(CONV_FILE).slice(-300).reverse());
});

app.get("/admin/structured", (req, res) => {
  res.json(readJsonArray(STRUCTURED_FILE).slice(-300).reverse());
});

app.get("/crm/list", async (req, res) => {
  try {
    const uid = await odooLogin();
    const leads = await odooExecute(uid, "crm.lead", "search_read", [[]], {
      fields: ["id", "name", "email_from", "phone", "stage_id", "create_date"],
      limit: 50,
      order: "create_date desc"
    });
    res.json(leads);
  } catch (err) {
    console.error("CRM LIST ERROR:", err);
    res.status(500).json({ error: "CRM list failed" });
  }
});

app.get("/api/crm/leads", async (req, res) => {
  try {
    const uid = await odooLogin();
    const leads = await odooExecute(uid, "crm.lead", "search_read", [[]], {
      fields: ["id", "name", "email_from", "phone", "stage_id", "create_date", "expected_revenue", "probability"],
      limit: 200,
      order: "create_date desc"
    });
    res.json(leads);
  } catch (err) {
    console.error("CRM LEADS ERROR:", err);
    res.status(500).json({ error: "CRM leads failed" });
  }
});

app.get("/api/crm/stages", async (req, res) => {
  try {
    const uid = await odooLogin();
    const stages = await odooExecute(uid, "crm.stage", "search_read", [[]], {
      fields: ["id", "name", "sequence"],
      order: "sequence asc"
    });
    res.json(stages);
  } catch (err) {
    console.error("CRM STAGES ERROR:", err);
    res.status(500).json({ error: "CRM stages failed" });
  }
});

app.post("/api/crm/update-stage", async (req, res) => {
  try {
    const { leadId, stageId } = req.body || {};
    if (!leadId || !stageId) return res.status(400).json({ error: "Missing leadId or stageId" });

    const uid = await odooLogin();
    await odooExecute(uid, "crm.lead", "write", [[Number(leadId)], { stage_id: Number(stageId) }]);
    res.json({ ok: true });
  } catch (err) {
    console.error("CRM UPDATE STAGE ERROR:", err);
    res.status(500).json({ error: "Update stage failed" });
  }
});

app.post("/api/crm/add-note", async (req, res) => {
  try {
    const { leadId, message } = req.body || {};
    if (!leadId || !message) return res.status(400).json({ error: "Missing leadId or message" });

    const uid = await odooLogin();
    await odooExecute(uid, "mail.message", "create", [[{
      model: "crm.lead",
      res_id: Number(leadId),
      body: String(message),
      message_type: "comment",
      subtype_id: 1
    }]]);

    res.json({ ok: true });
  } catch (err) {
    console.error("CRM ADD NOTE ERROR:", err);
    res.status(500).json({ error: "Add note failed" });
  }
});

app.get("/api/crm/recent", async (req, res) => {
  try {
    const uid = await odooLogin();
    const leads = await odooExecute(uid, "crm.lead", "search_read", [[]], {
      fields: ["id", "name", "stage_id", "create_date"],
      limit: 10,
      order: "create_date desc"
    });
    res.json(leads);
  } catch (err) {
    console.error("CRM RECENT ERROR:", err);
    res.status(500).json({ error: "Recent leads failed" });
  }
});

app.get("/api/crm/pipeline", async (req, res) => {
  try {
    const uid = await odooLogin();

    const [stages, leads] = await Promise.all([
      odooExecute(uid, "crm.stage", "search_read", [[]], { fields: ["id", "name", "sequence"], order: "sequence asc" }),
      odooExecute(uid, "crm.lead", "search_read", [[]], {
        fields: ["id", "stage_id", "expected_revenue", "probability"],
        limit: 1000
      })
    ]);

    const byStage = new Map();
    stages.forEach((s) => {
      byStage.set(s.id, {
        stageId: s.id,
        stageName: s.name,
        count: 0,
        sumExpectedRevenue: 0,
        sumWeightedRevenue: 0
      });
    });

    leads.forEach((l) => {
      const sid = Array.isArray(l.stage_id) ? l.stage_id[0] : null;
      if (!sid || !byStage.has(sid)) return;

      const expected = Number(l.expected_revenue || 0);
      const probability = Number(l.probability || 0) / 100;
      const bucket = byStage.get(sid);

      bucket.count += 1;
      bucket.sumExpectedRevenue += expected;
      bucket.sumWeightedRevenue += expected * probability;
    });

    const pipeline = [...byStage.values()];
    const totals = pipeline.reduce(
      (acc, s) => {
        acc.leads += s.count;
        acc.expected += s.sumExpectedRevenue;
        acc.weighted += s.sumWeightedRevenue;
        return acc;
      },
      { leads: 0, expected: 0, weighted: 0 }
    );

    res.json({ rev: REV, generatedAt: new Date().toISOString(), totals, pipeline });
  } catch (err) {
    console.error("CRM PIPELINE ERROR:", err);
    res.status(500).json({ error: "Pipeline failed" });
  }
});

//////////////////////////////////////////////////////////
// CMS API (ROBOT INSTRUKCIÓ + ODOO SZINKRON)
//////////////////////////////////////////////////////////

app.get("/api/cms/robots", async (req, res) => {
  const overrides = await readCmsOverrides();
  const robots = Object.keys(ROBOTS).map((key) => getRobotConfigFromOverrides(key, overrides));
  const syncLog = await readCmsSyncLog(20);
  const storageInfo = await getCmsStorageInfo();
  res.json({ rev: REV, storage: storageInfo, robots, syncLog });
});

app.get("/api/cms/robots/:key", async (req, res) => {
  const overrides = await readCmsOverrides();
  const cfg = getRobotConfigFromOverrides(req.params.key, overrides);
  if (!cfg) return res.status(404).json({ error: "Unknown robot" });
  res.json(cfg);
});

app.put("/api/cms/robots/:key", async (req, res) => {
  try {
    const robotKey = req.params.key;
    const base = ROBOTS[robotKey];
    if (!base) return res.status(404).json({ error: "Unknown robot" });

    const {
      title = "",
      intro = "",
      systemPrompt = "",
      styleGuide = "",
      script = "",
      knowledgeBase = "",
      syncToOdoo = true
    } = req.body || {};

    const overrides = await readCmsOverrides();
    const updatedAt = new Date().toISOString();

    overrides[robotKey] = {
      title: String(title || base.title).trim(),
      intro: String(intro || base.intro).trim(),
      systemPrompt: String(systemPrompt || base.systemPrompt).trim(),
      styleGuide: String(styleGuide || "").trim(),
      script: String(script || "").trim(),
      knowledgeBase: String(knowledgeBase || "").trim(),
      updatedAt
    };

    await writeCmsOverrides(overrides);

    let odooSync = { attempted: false, ok: false, leadId: null, error: null };

    if (syncToOdoo) {
      odooSync.attempted = true;
      try {
        const uid = await odooLogin();
        const cfg = getRobotConfigFromOverrides(robotKey, overrides);
        const leadId = await odooExecute(uid, "crm.lead", "create", [[{
          name: `CMS update: ${cfg.title}`,
          type: "opportunity",
          description: [
            `Robot key: ${robotKey}`,
            `Updated at: ${updatedAt}`,
            `Intro: ${cfg.intro}`,
            "",
            "System prompt:",
            cfg.systemPrompt,
            "",
            "Style guide:",
            cfg.styleGuide || "(üres)",
            "",
            "Script:",
            cfg.script || "(üres)",
            "",
            "Knowledge base:",
            cfg.knowledgeBase || "(üres)"
          ].join("\n")
        }]]);

        odooSync.ok = true;
        odooSync.leadId = leadId;
      } catch (err) {
        odooSync.error = parseOdooErrorMessage(err);
      }
    }

    const syncEvent = {
      id: Date.now(),
      robotKey,
      updatedAt,
      odooSync
    };

    await appendCmsSyncLog(syncEvent);

    res.json({
      ok: true,
      robot: getRobotConfigFromOverrides(robotKey, overrides),
      odooSync
    });
  } catch (err) {
    console.error("CMS UPDATE ERROR:", err);
    res.status(500).json({ error: "CMS update failed" });
  }
});

//////////////////////////////////////////////////////////
// START SERVER
//////////////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log(`AIVIO backend fut a ${PORT} porton | ${REV}`);
});
