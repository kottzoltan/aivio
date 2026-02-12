import express from "express";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import { WebSocketServer } from "ws";

import { createCallSession, getCallSession, closeCallSession, sweepOldCalls } from "./telephony/calls.js";

const app = express();
const PORT = process.env.PORT || 8080;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== REV / BUILD ID (hogy lásd, mi fut kint) ======
const REV = process.env.REV || "rev_2026-02-07__aivio_ws_phone_scaffold_v1";

// ====== middleware ======
app.use(express.json({ limit: "2mb" }));

// ====== statikus frontend ======
app.use(express.static(path.join(__dirname, "public")));

// root → public/index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// health (rev + env státusz)
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    rev: REV,
    openai: !!process.env.OPENAI_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    time: new Date().toISOString()
  });
});

// ====== mini-CMS: robot profilok ======
const ROBOTS = {
  outbound_sales: {
    title: "Kimenő telefonos sales",
    intro:
      "Szia! Ari vagyok, a kimenő sales asszisztensed. Mondd el: kinek telefonálunk, mi az ajánlat, és mi a cél: időpont, demo, vagy azonnali lezárás?",
    systemPrompt: `
Te Ari vagy, egy tapasztalt kimenő telefonos sales asszisztens. Magyarul beszélsz.

FŐ CÉL:
- Időpont egyeztetés / demo / kulturált lezárás.

STÍLUS:
- természetes, emberi, határozott, udvarias, rövid válaszok.

SZABÁLYOK (nagyon fontos):
- SOHA ne ismételd vissza szó szerint a felhasználó mondatát.
- Ha a bemenet értelmetlen (pl. "123", "aaa", zaj), kérj pontosítást 1 kérdéssel.
- Mindig adj érdemi választ + 1 következő kérdést.
- Ha „hülyeséget” kér a felhasználó (irreális / káros / off-topic), mondd el röviden miért nem, és tereld vissza sales irányba.
- Ne említs modelleket, API-kat, rendszereket.
`
  },

  email_sales: {
    title: "Email sales",
    intro:
      "Szia! Ari vagyok, az email sales asszisztensed. Mondd el a célcsoportot, a terméket és a hangnemet, és megírok egy ütős emailt tárggyal és CTA-val.",
    systemPrompt: `
Te Ari vagy, email sales szakértő. Magyarul beszélsz.
- SOHA ne ismételd vissza szó szerint a felhasználót.
- Adj egy kész emailt: tárgy + törzs + CTA.
- Tegyél fel 1 kérdést a pontosításhoz, ha kell.
`
  },

  support_inbound: {
    title: "Bejövő ügyfélszolgálat",
    intro:
      "Szia! Ari vagyok, az ügyfélszolgálati asszisztensed. Mondd el röviden a problémát, és lépésről lépésre végigvezetlek a megoldáson.",
    systemPrompt: `
Te Ari vagy, ügyfélszolgálati asszisztens. Magyarul beszélsz.
- SOHA ne ismételd vissza szó szerint a felhasználót.
- Röviden kérdezz vissza, majd adj lépésről lépésre megoldást.
- Ha kevés az infó, tegyél fel 1 tisztázó kérdést.
`
  },

  customer_satisfaction: {
  title: "Ügyfél elégedettségmérés",
  intro:
    "Szia! Adél vagyok, az ügyfél elégedettségmérő asszisztensed. A legutóbbi szolgáltatásunkkal kapcsolatos tapasztalatairól szeretnék néhány rövid kérdést feltenni.",
  systemPrompt: `
Te Adél vagy, ügyfél elégedettségmérő asszisztens. Magyarul beszélsz.

A beszélgetés célja egy rövid elégedettségi felmérés.

Kérdések sorrendben:

1. Mennyire volt elégedett a szolgáltatás gyorsaságával? (1-5 skála)
2. Mennyire volt elégedett a kollégák hozzáállásával? (1-5 skála)
3. Ajánlana-e minket másoknak? (igen / nem)
4. Szeretne bármit megosztani velünk a tapasztalatával kapcsolatban?

Szabályok:
- Egy kérdést tegyél fel egyszerre.
- Várd meg a választ.
- Skálás kérdésnél kérj konkrét számot.
- A végén köszönd meg udvariasan.
- SOHA ne ismételd szó szerint a felhasználó mondatát.
`
},


// ====== THINK – OpenAI ======
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

    const trimmed = Array.isArray(history) ? history.slice(-10) : [];

    const messages = [
      { role: "system", content: cfg.systemPrompt },
      ...trimmed,
      { role: "user", content: text }
    ];

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1",
      messages,
      temperature: 0.4
    });

    const answer = completion?.choices?.[0]?.message?.content?.trim() || "";
    res.json({ text: answer });
  } catch (err) {
    console.error("THINK ERROR:", err);
    res.status(500).json({ error: "Thinking failed" });
  }
});

// ====== SPEAK – ElevenLabs ======
app.post("/speak", async (req, res) => {
  try {
    const { text, voiceId, model_id } = req.body || {};
    if (!text) return res.status(400).send("Missing text");
    if (!voiceId) return res.status(400).send("Missing voiceId");

    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(500).send("ELEVENLABS_API_KEY missing");
    }

    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: model_id || "eleven_flash_v2_5",
        voice_settings: { stability: 0.45, similarity_boost: 0.85 }
      })
    });

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

// ====== robots lista (frontendnek) ======
app.get("/robots", (req, res) => {
  const list = Object.entries(ROBOTS).map(([key, v]) => ({
    key,
    title: v.title,
    intro: v.intro
  }));
  res.json({ rev: REV, robots: list });
});


// =====================================================
// 📞 TELEFONOS CSATORNA – scaffolding
// =====================================================

// 1) Call session start (Asterisk / bridge ezt fogja hívni)
app.post("/call/start", (req, res) => {
  const { callId } = req.body || {};
  if (!callId) return res.status(400).json({ error: "Missing callId" });

  // default: minden bejövő hívás -> support_inbound
  const s = createCallSession(callId, "support_inbound");

  console.log("📞 CALL START:", callId, "robot:", s.robot);
  res.json({ ok: true, rev: REV, callId, robot: s.robot });
});

// 2) Call session end
app.post("/call/end", (req, res) => {
  const { callId } = req.body || {};
  if (!callId) return res.status(400).json({ error: "Missing callId" });

  closeCallSession(callId);
  console.log("📞 CALL END:", callId);
  res.json({ ok: true });
});

// 3) Debug: list active calls
app.get("/call/active", (req, res) => {
  // csak demo/debug, ne legyen élesben nyitva netre auth nélkül
  const active = [];
  // lazy sweep
  sweepOldCalls(30 * 60 * 1000);

  // CALLS Map a module-ban van, itt getCallSession nélkül nem látjuk,
  // ezért: egyszerűen visszaadunk üres listát, ha nem akarod kiexportálni.
  // (ha kéred, adok egy rendes listázót is)
  res.json({ ok: true, note: "Enable listing if needed", active });
});


// =====================================================
// 🎧 WebSocket – audio bejövő csatorna
// path: /ws/audio
//
// Protokoll (most demo):
// - első üzenet: JSON { type:"hello", callId:"..." }
// - utána audio frame-ek jöhetnek binárisan (később: PCM 16k/16bit mono)
// =====================================================

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/audio" });

wss.on("connection", (ws) => {
  let callId = null;

  ws.on("message", async (data, isBinary) => {
    try {
      if (!isBinary) {
        const msg = JSON.parse(data.toString("utf8"));

        if (msg.type === "hello") {
          callId = String(msg.callId || "");
          if (!callId) {
            ws.send(JSON.stringify({ type: "error", message: "Missing callId in hello" }));
            ws.close();
            return;
          }

          const s = getCallSession(callId) || createCallSession(callId, "support_inbound");
          ws.send(JSON.stringify({ type: "hello_ack", callId: s.callId, robot: s.robot, rev: REV }));
          console.log("🎧 WS hello:", callId, "robot:", s.robot);
          return;
        }

        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", t: Date.now() }));
          return;
        }

        ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
        return;
      }

      // Binary audio frame (még nem dolgozzuk fel, csak logoljuk)
      if (!callId) {
        ws.send(JSON.stringify({ type: "error", message: "Send hello first" }));
        return;
      }

      // Itt fog majd menni:
      // - PCM chunk -> realtime STT -> /think -> TTS -> vissza bridge-nek
      // Most csak méretet logolunk, hogy lásd él a pipeline.
      console.log("🎧 WS audio chunk:", callId, "bytes:", data.length);

    } catch (err) {
      console.error("WS message error:", err);
      try {
        ws.send(JSON.stringify({ type: "error", message: "Bad message" }));
      } catch {}
    }
  });

  ws.on("close", () => {
    if (callId) console.log("🎧 WS closed:", callId);
  });
});

server.listen(PORT, () => {
  console.log(`AIVIO backend fut a ${PORT} porton | ${REV}`);
});
// ==============================
// SURVEY CMS (backend config)
// ==============================

let SURVEY_CONFIG = {
  title: "Ügyfél elégedettség felmérés",
  questions: [
    {
      id: 1,
      text: "Mennyire volt elégedett a szolgáltatás gyorsaságával?",
      type: "scale",
      scale: 5
    },
    {
      id: 2,
      text: "Mennyire volt segítőkész a kollégánk?",
      type: "scale",
      scale: 5
    },
    {
      id: 3,
      text: "Ajánlaná cégünket másoknak?",
      type: "scale",
      scale: 10
    },
    {
      id: 4,
      text: "Van bármilyen javaslata?",
      type: "text"
    }
  ]
};
