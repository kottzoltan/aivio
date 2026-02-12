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

const REV = process.env.REV || "rev_2026-02-12__customer_satisfaction_fixed";

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
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    time: new Date().toISOString()
  });
});

// =====================================================
// 🤖 ROBOTS
// =====================================================

const ROBOTS = {

  outbound_sales: {
    title: "Kimenő telefonos sales",
    intro:
      "Szia! Ari vagyok, a kimenő sales asszisztensed. Mondd el: kinek telefonálunk, mi az ajánlat, és mi a cél?",
    systemPrompt: `
Te Ari vagy, tapasztalt kimenő telefonos sales asszisztens.
Rövid, határozott, udvarias válaszokat adj.
Mindig tegyél fel 1 következő kérdést.
Soha ne ismételd szó szerint a felhasználót.
`
  },

  email_sales: {
    title: "Email sales",
    intro:
      "Szia! Ari vagyok, az email sales asszisztensed. Mondd el a célcsoportot és a terméket.",
    systemPrompt: `
Te Ari vagy, email sales szakértő.
Adj kész emailt tárggyal és CTA-val.
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
      "Szia! Adél vagyok, az ügyfél elégedettségmérő asszisztensed. Szeretnék néhány rövid kérdést feltenni a legutóbbi szolgáltatásunkkal kapcsolatban.",
    systemPrompt: `
Te Adél vagy, ügyfél elégedettségmérő asszisztens.

Kérdések sorrendben:
1. Mennyire volt elégedett a szolgáltatás gyorsaságával? (1-5)
2. Mennyire volt elégedett a kollégák hozzáállásával? (1-5)
3. Ajánlana-e minket másoknak? (igen/nem)
4. Szeretne bármit megosztani velünk?

Egy kérdést tegyél fel egyszerre.
Várd meg a választ.
A végén köszönd meg.
Ne ismételd szó szerint a felhasználót.
`
  }

}; // 🔥 EZ HIÁNYZOTT NÁLAD

// =====================================================
// 🧠 THINK
// =====================================================

app.post("/think", async (req, res) => {
  try {
    const { text, robot = "outbound_sales", history = [] } = req.body || {};
    if (!text) return res.status(400).json({ error: "Missing text" });

    const cfg = ROBOTS[robot];
    if (!cfg) return res.status(400).json({ error: "Unknown robot" });

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
