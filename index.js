import express from "express";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import { WebSocketServer } from "ws";
import fetch from "node-fetch";

import {
  createCallSession,
  getCallSession,
  closeCallSession,
  sweepOldCalls
} from "./telephony/calls.js";

const app = express();
const PORT = process.env.PORT || 8080;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REV = "rev_2026-02-12__stable_build";

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    rev: REV,
    openai: !!process.env.OPENAI_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY
  });
});

// =====================================================
// ROBOTS
// =====================================================

const ROBOTS = {
  outbound_sales: {
    title: "Kimenő telefonos sales",
    intro: "Szia! Ari vagyok, a kimenő sales asszisztensed.",
    systemPrompt: `
Te Ari vagy, kimenő sales asszisztens.
Rövid, határozott, udvarias válaszokat adj.
Mindig tegyél fel 1 következő kérdést.
`
  },

  email_sales: {
    title: "Email sales",
    intro: "Szia! Ari vagyok, az email sales asszisztensed.",
    systemPrompt: `
Te Ari vagy, email sales szakértő.
Adj kész emailt tárggyal és CTA-val.
`
  },

  support_inbound: {
    title: "Bejövő ügyfélszolgálat",
    intro: "Szia! Ari vagyok, az ügyfélszolgálati asszisztensed.",
    systemPrompt: `
Te Ari vagy, ügyfélszolgálati asszisztens.
Adj lépésről lépésre megoldást.
`
  },

  customer_satisfaction: {
    title: "Ügyfél elégedettségmérés",
    intro:
      "Szia! Adél vagyok, az ügyfél elégedettségmérő asszisztensed. Szeretnék néhány rövid kérdést feltenni.",
    systemPrompt: `
Te Adél vagy, ügyfél elégedettségmérő asszisztens.

Kérdések sorrendben:
1. Mennyire volt elégedett a szolgáltatás gyorsaságával? (1-5)
2. Mennyire volt elégedett a kollégák hozzáállásával? (1-5)
3. Ajánlana-e minket másoknak? (igen/nem)
4. Van-e javaslata?

Egy kérdést tegyél fel egyszerre.
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

// =====================================================
// THINK
// =====================================================

app.post("/think", async (req, res) => {
  try {
    const { text, robot = "outbound_sales", history = [] } = req.body || {};
    if (!text) return res.status(400).json({ error: "Missing text" });

    const cfg = ROBOTS[robot];
    if (!cfg) return res.status(400).json({ error: "Unknown robot" });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: cfg.systemPrompt },
        ...history.slice(-10),
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

// =====================================================
// SPEAK
// =====================================================

app.post("/speak", async (req, res) => {
  try {
    const { text, voiceId } = req.body || {};
    if (!text || !voiceId) return res.status(400).send("Missing params");

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
          model_id: "eleven_flash_v2_5"
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
// TELEFON SCAFFOLD (érintetlen)
// =====================================================

app.post("/call/start", (req, res) => {
  const { callId } = req.body || {};
  if (!callId) return res.status(400).json({ error: "Missing callId" });

  const s = createCallSession(callId, "support_inbound");
  res.json({ ok: true, callId: s.callId });
});

app.post("/call/end", (req, res) => {
  const { callId } = req.body || {};
  if (!callId) return res.status(400).json({ error: "Missing callId" });

  closeCallSession(callId);
  res.json({ ok: true });
});

// =====================================================
// WS
// =====================================================

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/audio" });

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    console.log("WS message:", data.length);
  });
});

server.listen(PORT, () => {
  console.log(`AIVIO backend fut a ${PORT} porton | ${REV}`);
});
