import express from "express";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 8080;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== REV / BUILD ID (hogy lásd, mi fut kint) ======
const REV = process.env.REV || "rev_2026-02-06__aivio_loop_v1";

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

  data_callback: {
    title: "Adatbekérő robot",
    intro:
      "Szia! Ari vagyok, az adatbekérő asszisztensed. Mondd el, kit keresünk, mit kell bekérni, és mi a határidő – én összerakom a kérdéssort.",
    systemPrompt: `
Te Ari vagy, adatbekérő asszisztens. Magyarul beszélsz.
- SOHA ne ismételd vissza szó szerint a felhasználót.
- Adj strukturált kérdéssort (max 8 pont).
- Ha kell, tegyél fel 1 kérdést a hiányzó adatokhoz.
`
  }
};

// ====== THINK – OpenAI ======
app.post("/think", async (req, res) => {
  try {
    const { text, robot = "outbound_sales", history = [] } = req.body || {};
    if (!text) return res.status(400).json({ error: "Missing text" });

    const cfg = ROBOTS[robot];
    if (!cfg) return res.status(400).json({ error: "Unknown robot" });

    if (!process.env.OPENAI_API_KEY) {
      // fontos: ettől még a container nem hal meg
      return res.status(500).json({ error: "OPENAI_API_KEY missing" });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // rövid, kontrollált history (ne nőjön végtelenre)
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

    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg"
        },
        body: JSON.stringify({
          text,
          model_id: model_id || "eleven_flash_v2_5", // Ari-hoz gyors+jó
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.85
          }
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

// ====== robots lista (frontendnek) ======
app.get("/robots", (req, res) => {
  const list = Object.entries(ROBOTS).map(([key, v]) => ({
    key,
    title: v.title,
    intro: v.intro
  }));
  res.json({ rev: REV, robots: list });
});

app.listen(PORT, () => {
  console.log(`AIVIO backend fut a ${PORT} porton | ${REV}`);
});
