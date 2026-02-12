import express from "express";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 8080;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REV = "rev_2026-02-12__clean_stable_web_only";

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// =====================================================
// HEALTH
// =====================================================

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    rev: REV,
    openai: !!process.env.OPENAI_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    time: new Date().toISOString()
  });
});

// =====================================================
// ROBOTS
// =====================================================

const ROBOTS = {
  outbound_sales: {
    title: "AI Sales Megoldás Értékesítő",
    intro:
      "Szia! Ari vagyok, AI sales megoldás szakértő. Egy olyan intelligens rendszert mutatok, amely automatizálja a sales, ügyfélszolgálati és ügyfél-elégedettségi folyamatait.",
    systemPrompt: `
Te Ari vagy, AI megoldás értékesítési specialista.

Cél:
- Bemutatni egy AI rendszert, amely:
  - automatikus sales hívásokat kezel
  - ügyfélszolgálati chatet működtet
  - ügyfél elégedettségi mérést végez
  - Odoo CRM-be menti a leadeket

Struktúra:

1. Nagyon röviden mutasd be az AI rendszert.
2. Kérdezd meg, érdekelné-e egy személyre szabott bemutató.
3. Ha igen:
   - kérj nevet
   - kérj emailt
   - kérj telefonszámot
   - javasolj időpontot (2 opció)
4. Ha időpont elfogadva → jelezd, hogy rögzíted a CRM-ben.

Mindig egy kérdést tegyél fel egyszerre.
Legyél professzionális, de modern.
`
  },

  email_sales: {
    title: "Időpont foglalás",
    intro:
      "Szia! Segítek teniszpályát foglalni. Melyik napra és hány órára szeretnél pályát?",
    systemPrompt: `
Te egy teniszpálya időpontfoglaló asszisztens vagy.
Feladat:
1. Kérdezd meg:
   - dátum
   - kezdési időpont
   - hány órára
   - név
   - telefonszám
2. Ellenőrizd vissza az adatokat.
3. Mondd, hogy rögzíted a foglalást.
4. Légy tömör és udvarias.

Mindig egy kérdést tegyél fel egyszerre.
Ne ismételd szó szerint a felhasználót.
`
  },

  support_inbound: {
    title: "Bejövő ügyfélszolgálat",
    intro:
      "Szia! Ari vagyok, az ügyfélszolgálati asszisztensed. Mondd el a problémát.",
    systemPrompt: `
Te Ari vagy, ügyfélszolgálati asszisztens.
Adj lépésről lépésre megoldást.
Ne ismételd szó szerint a felhasználót.
`
  },

  customer_satisfaction: {
    title: "Ügyfél elégedettségmérés",
    intro:
      "Szia! Ari vagyok, az ügyfél elégedettségmérő asszisztensed. Szeretnék néhány rövid kérdést feltenni a legutóbbi szolgáltatásunkkal kapcsolatban.",
    systemPrompt: `
Te Adél vagy, ügyfél elégedettségmérő asszisztens.

Kérdések sorrendben:
1. Mennyire volt elégedett a szolgáltatás gyorsaságával? (1-5)
2. Mennyire volt elégedett a kollégák hozzáállásával? (1-5)
3. Ajánlana-e minket másoknak? (igen/nem)
4. Van-e javaslata?

Egy kérdést tegyél fel egyszerre.
Várd meg a választ.
A végén köszönd meg udvariasan.
`
  }
};

// robots lista a frontendnek
app.get("/robots", (req, res) => {
  const list = Object.entries(ROBOTS).map(([key, v]) => ({
    key,
    title: v.title,
    intro: v.intro
  }));
  res.json({ rev: REV, robots: list });
});

// =====================================================
// THINK (OpenAI)
// =====================================================

app.post("/think", async (req, res) => {
  try {
    const { text, robot = "outbound_sales", history = [] } = req.body || {};
    if (!text) return res.status(400).json({ error: "Missing text" });

    const cfg = ROBOTS[robot];
    if (!cfg) return res.status(400).json({ error: "Unknown robot" });

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY missing" });
    }

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

    const answer =
      completion?.choices?.[0]?.message?.content?.trim() || "";

    res.json({ text: answer });

  } catch (err) {
    console.error("THINK ERROR:", err);
    res.status(500).json({ error: "Thinking failed" });
  }
});

// =====================================================
// SPEAK (ElevenLabs)
// =====================================================

app.post("/speak", async (req, res) => {
  try {
    const { text, voiceId, model_id } = req.body || {};
    if (!text) return res.status(400).send("Missing text");
    if (!voiceId) return res.status(400).send("Missing voiceId");

    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(500).send("ELEVENLABS_API_KEY missing");
    }

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

    if (!r.ok) {
      const t = await r.text();
      console.error("ElevenLabs error:", t);
      return res.status(500).send("TTS failed");
    }

    const audioBuffer = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);

  } catch (err) {
    console.error("SPEAK ERROR:", err);
    res.status(500).send("TTS error");
  }
});

// =====================================================
// START SERVER (Cloud Run kompatibilis)
// =====================================================
// =====================================================
// SIMPLE CRM (demo)
// =====================================================

import fs from "fs";

const DATA_DIR = path.join(__dirname, "data");
const CRM_FILE = path.join(DATA_DIR, "crm.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

if (!fs.existsSync(CRM_FILE)) {
  fs.writeFileSync(CRM_FILE, JSON.stringify([]));
}

// mentés
app.post("/crm/save", (req, res) => {
  try {
    const entry = {
      id: Date.now(),
      robot: req.body.robot,
      name: req.body.name || "Ismeretlen",
      phone: req.body.phone || "",
      email: req.body.email || "",
      note: req.body.note || "",
      createdAt: new Date().toISOString()
    };

    const data = JSON.parse(fs.readFileSync(CRM_FILE));
    data.push(entry);
    fs.writeFileSync(CRM_FILE, JSON.stringify(data, null, 2));

    res.json({ ok: true });
  } catch (err) {
    console.error("CRM ERROR:", err);
    res.status(500).json({ error: "CRM save failed" });
  }
});

// lista
app.get("/crm/list", (req, res) => {
  const data = JSON.parse(fs.readFileSync(CRM_FILE));
  res.json(data);
});

app.listen(PORT, () => {
  console.log(`AIVIO backend fut a ${PORT} porton | ${REV}`);
});
app.get("/api/crm/leads", async (req, res) => {
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
              fields: ["name", "email_from", "phone", "stage_id"],
              limit: 50,
              order: "create_date desc"
            }
          ]
        },
        id: Date.now()
      })
    });

    const data = await r.json();
    res.json(data.result);

  } catch (err) {
    console.error("CRM LIST ERROR:", err);
    res.status(500).json({ error: "CRM list error" });
  }
});
