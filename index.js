/**
 * index.js — AIVIO demo backend (Cloud Run)
 * - /ui   → public/ui statikus kiszolgálás
 * - /img  → public/img statikus képek
 * - /ai   → OpenAI (szöveges válasz, agent személyiséggel)
 * - /speak→ ElevenLabs TTS (voiceId: 7B7mSWflzRSaO1yGeJH6)  ✅
 *
 * FONTOS:
 * - Cloud Run-on a PORT környezeti változóhoz kell kötni a listen-t.
 * - A /speak endpoint most KÖTELEZŐEN ezt a voiceId-t használja.
 */

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json({ limit: "1mb" }));

// ─────────────────────────────
// PATH FIX (ESM)
// ─────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────
// ENV CHECK
// ─────────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

if (!OPENAI_API_KEY) console.warn("⚠️ OPENAI_API_KEY nincs beállítva.");
if (!ELEVENLABS_API_KEY) console.warn("⚠️ ELEVENLABS_API_KEY nincs beállítva.");

// ─────────────────────────────
// STATIC
// ─────────────────────────────
app.use("/ui", express.static(path.join(__dirname, "public/ui")));
app.use("/img", express.static(path.join(__dirname, "public/img")));

app.get("/", (req, res) => res.redirect("/ui/"));
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ─────────────────────────────
// AGENT PROMPTS
// ─────────────────────────────
const AGENTS = {
  adel: {
    name: "Adél",
    role: "Kimenő telefonos sales",
    style:
      "Határozott, barátságos, proaktív. Rövid, beszédre optimalizált mondatok. Kérdezzen vissza.",
  },
  ricsi: {
    name: "Ricsi",
    role: "Email sales",
    style:
      "Strukturált, precíz, okos. Röviden fogalmaz, lépéseket javasol, kérdez vissza.",
  },
  ari: {
    name: "Ari",
    role: "Bejövő ügyfélszolgálat",
    style:
      "Empatikus, nyugodt, segítőkész. Rövid válaszok, tisztázó kérdések.",
  },
  mihaly: {
    name: "Mihály",
    role: "Adatbekérő robot",
    style:
      "Tárgyilagos, lényegre törő. Egy kérdés egyszerre. Rövid válaszok. Adatokat pontosít.",
  },
  demo: {
    name: "AIVIO",
    role: "Általános demo asszisztens",
    style: "Barátságos, rövid, természetes magyar beszéd. Kérdezzen vissza.",
  },
};

function getAgent(agentKey) {
  const k = (agentKey || "demo").toLowerCase();
  return AGENTS[k] || AGENTS.demo;
}

// ─────────────────────────────
// /ai — OpenAI Responses API (szöveg)
// ─────────────────────────────
app.post("/ai", async (req, res) => {
  try {
    const { text, agent } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Hiányzó 'text' mező." });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY nincs beállítva." });
    }

    const a = getAgent(agent);

    const system = `Te ${a.name} vagy, a(z) "${a.role}" AI ügynök.
Stílus: ${a.style}
Nyelv: magyar.
Válasz mindig rövid, beszédre alkalmas. Ne használj hosszú felsorolásokat.
Ha hiányzik információ, tegyél fel 1 tisztázó kérdést.`;

    // Responses API hívás
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
        temperature: 0.6,
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error("OpenAI /ai hiba:", errText);
      return res.status(500).json({ error: "OpenAI hiba", details: errText });
    }

    const data = await r.json();

    // Responses API: többféle formátum lehet, ezért óvatosan szedjük ki a szöveget
    let answer = "";
    if (typeof data.output_text === "string") {
      answer = data.output_text;
    } else if (Array.isArray(data.output)) {
      // fallback: output tömbből összeszedjük a text részeket
      const parts = [];
      for (const item of data.output) {
        if (item?.content && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c?.type === "output_text" && typeof c?.text === "string") {
              parts.push(c.text);
            }
          }
        }
      }
      answer = parts.join("\n").trim();
    }

    if (!answer) answer = "Elnézést, nem tudok most válaszolni.";

    return res.json({ answer });
  } catch (err) {
    console.error("AI ERROR:", err);
    return res.status(500).json({ error: "AI hiba történt." });
  }
});

// ─────────────────────────────
// /speak — ElevenLabs TTS (FIX voiceId)
// voiceId: 7B7mSWflzRSaO1yGeJH6  ✅
// ─────────────────────────────
app.post("/speak", async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).send("Hiányzó 'text' mező.");
    }
    if (!ELEVENLABS_API_KEY) {
      return res.status(500).send("ELEVENLABS_API_KEY nincs beállítva.");
    }

    const VOICE_ID = "7B7mSWflzRSaO1yGeJH6";
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.85,
          style: 0.25,
          use_speaker_boost: true,
        },
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error("ElevenLabs /speak hiba:", errText);
      return res.status(500).send("TTS hiba");
    }

    res.setHeader("Content-Type", "audio/mpeg");
    // Node 18+ fetch stream pipe
    r.body.pipe(res);
  } catch (err) {
    console.error("SPEAK ERROR:", err);
    return res.status(500).send("Hang generálási hiba");
  }
});

// ─────────────────────────────
// Cloud Run PORT
// ─────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`AIVIO backend fut a ${PORT} porton`);
});
