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

const REV = "rev_2026-02-12__robots_plus_crm_dashboard";

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

//////////////////////////////////////////////////////////
// HEALTH
//////////////////////////////////////////////////////////

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    rev: REV,
    openai: !!process.env.OPENAI_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    odoo: !!process.env.ODOO_URL,
    time: new Date().toISOString()
  });
});

//////////////////////////////////////////////////////////
// ROBOTS (VÁLTOZATLAN)
//////////////////////////////////////////////////////////

const ROBOTS = {
  outbound_sales: {
    title: "AI Sales Megoldás Értékesítő",
    intro:
      "Szia! Ari vagyok, AI sales megoldás szakértő. Egy olyan intelligens rendszert mutatok, amely automatizálja a sales, ügyfélszolgálati és ügyfél-elégedettségi folyamatait.",
    systemPrompt: `
Te Ari vagy, AI megoldás értékesítési specialista.

1. Rövid bemutatás
2. Érdeklődés felmérés
3. Ha igen:
   - név
   - email
   - telefon
   - időpont (2 opció)
4. Jelezd, hogy CRM-be rögzíted.
`
  },
  email_sales: {
    title: "Időpont foglalás",
    intro:
      "Szia! Segítek teniszpályát foglalni.",
    systemPrompt: `
Teniszpálya foglalás:
- dátum
- kezdési idő
- hány órára
- név
- telefonszám
Egy kérdés egyszerre.
`
  },
  support_inbound: {
    title: "Bejövő ügyfélszolgálat",
    intro:
      "Szia! Ari vagyok, az ügyfélszolgálati asszisztensed.",
    systemPrompt: `
Adj lépésről lépésre megoldást.
`
  },
  customer_satisfaction: {
    title: "Ügyfél elégedettségmérés",
    intro:
      "Szia! Néhány rövid kérdést tennék fel.",
    systemPrompt: `
1-5 skálás kérdések.
Egy kérdés egyszerre.
A végén köszönd meg.
`
  }
};

app.get("/robots", (req, res) => {
  const list = Object.entries(ROBOTS).map(([key, v]) => ({
    key,
    title: v.title,
    intro: v.intro
  }));
  res.json({ rev: REV, robots: list });
});

//////////////////////////////////////////////////////////
// THINK
//////////////////////////////////////////////////////////

app.post("/think", async (req, res) => {
  try {
    const { text, robot = "outbound_sales", history = [] } = req.body || {};
    if (!text) return res.status(400).json({ error: "Missing text" });

    const cfg = ROBOTS[robot];
    if (!cfg) return res.status(400).json({ error: "Unknown robot" });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1",
      messages: [
        { role: "system", content: cfg.systemPrompt },
        ...(Array.isArray(history) ? history.slice(-10) : []),
        { role: "user", content: text }
      ],
      temperature: 0.4
    });

    res.json({
      text: completion.choices[0].message.content.trim()
    });

  } catch (err) {
    console.error("THINK ERROR:", err);
    res.status(500).json({ error: "Thinking failed" });
  }
});

//////////////////////////////////////////////////////////
// SPEAK
//////////////////////////////////////////////////////////

app.post("/speak", async (req, res) => {
  try {
    const { text, voiceId, model_id } = req.body || {};
    if (!text || !voiceId) return res.status(400).send("Missing data");

    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
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
      }
    );

    const audioBuffer = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);

  } catch (err) {
    console.error("SPEAK ERROR:", err);
    res.status(500).send("TTS error");
  }
});

//////////////////////////////////////////////////////////
// SIMPLE LOCAL CRM (MARAD)
//////////////////////////////////////////////////////////

const DATA_DIR = path.join(__dirname, "data");
const CRM_FILE = path.join(DATA_DIR, "crm.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(CRM_FILE)) fs.writeFileSync(CRM_FILE, JSON.stringify([]));

app.post("/crm/save", (req, res) => {
  const entry = {
    id: Date.now(),
    ...req.body,
    createdAt: new Date().toISOString()
  };
  const data = JSON.parse(fs.readFileSync(CRM_FILE));
  data.push(entry);
  fs.writeFileSync(CRM_FILE, JSON.stringify(data, null, 2));
  res.json({ ok: true });
});

app.get("/crm/list", (req, res) => {
  const data = JSON.parse(fs.readFileSync(CRM_FILE));
  res.json(data);
});

//////////////////////////////////////////////////////////
// ODOO LOGIN
//////////////////////////////////////////////////////////

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
        args: [
          process.env.ODOO_DB,
          process.env.ODOO_USER,
          process.env.ODOO_API_KEY
        ]
      },
      id: Date.now()
    })
  });
  const data = await r.json();
  return data.result;
}

//////////////////////////////////////////////////////////
// ODOO LEAD CREATE
//////////////////////////////////////////////////////////

app.post("/api/crm/create-lead", async (req, res) => {
  try {
    const uid = await odooLogin();
    const { name, email, phone, note, expected_revenue = 0 } = req.body;

    const r = await fetch(`${process.env.ODOO_URL}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: {
          service: "object",
          method: "execute_kw",
          args: [
            process.env.ODOO_DB,
            uid,
            process.env.ODOO_API_KEY,
            "crm.lead",
            "create",
            [{
              name,
              email_from: email,
              phone,
              description: note,
              expected_revenue
            }]
          ]
        },
        id: Date.now()
      })
    });

    const data = await r.json();
    res.json({ success: true, leadId: data.result });

  } catch (err) {
    console.error("ODOO CREATE ERROR:", err);
    res.status(500).json({ error: "Create lead failed" });
  }
});

//////////////////////////////////////////////////////////
// ODOO PIPELINE
//////////////////////////////////////////////////////////

app.get("/api/crm/pipeline", async (req, res) => {
  try {
    const uid = await odooLogin();

    const r = await fetch(`${process.env.ODOO_URL}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: {
          service: "object",
          method: "execute_kw",
          args: [
            process.env.ODOO_DB,
            uid,
            process.env.ODOO_API_KEY,
            "crm.lead",
            "search_read",
            [[]],
            {
              fields: ["stage_id", "expected_revenue", "probability"],
              limit: 1000
            }
          ]
        },
        id: Date.now()
      })
    });

    const data = await r.json();
    const leads = data.result || [];

    const byStage = {};

    leads.forEach(l => {
      const stage = l.stage_id?.[1] || "Ismeretlen";
      if (!byStage[stage]) {
        byStage[stage] = { count: 0, expected: 0, weighted: 0 };
      }

      const expected = Number(l.expected_revenue || 0);
      const prob = Number(l.probability || 0);

      byStage[stage].count++;
      byStage[stage].expected += expected;
      byStage[stage].weighted += expected * (prob / 100);
    });

    const pipeline = Object.entries(byStage).map(([stage, val]) => ({
      stage,
      ...val
    }));

    const totals = pipeline.reduce((a, s) => ({
      leads: a.leads + s.count,
      expected: a.expected + s.expected,
      weighted: a.weighted + s.weighted
    }), { leads: 0, expected: 0, weighted: 0 });

    res.json({ pipeline, totals });

  } catch (err) {
    console.error("PIPELINE ERROR:", err);
    res.status(500).json({ error: "Pipeline error" });
  }
});

//////////////////////////////////////////////////////////
// START SERVER
//////////////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log(`AIVIO backend fut a ${PORT} porton | ${REV}`);
});
