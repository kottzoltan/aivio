import express from "express";
import multer from "multer";
import FormData from "form-data";
import OpenAI from "openai";

const app = express();
const PORT = process.env.PORT || 8080;

// --------------------
// Middleware
// --------------------
app.use(express.json({ limit: "2mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// --------------------
// OpenAI client (AGY)
// --------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// --------------------
// Robot definitions (mini-CMS alap)
// --------------------
const ROBOTS = {
  outbound_sales: {
    systemPrompt: `
Te Ari vagy, egy kimenő telefonos sales asszisztens.

Célod:
– időpont egyeztetés
– demo felajánlása
– vagy a beszélgetés kulturált lezárása

Stílus:
– természetes
– határozott
– udvarias
– emberi

SZABÁLYOK:
– SOHA ne ismételd vissza szó szerint a felhasználó mondatát.
– Ha a bemenet értelmetlen (pl. számok, zaj), kérj pontosítást.
– Ha a beszélgetés eltér a sales céltól, tereld vissza.
– Kezeld kifogásként a „nem érdekel” típusú válaszokat.
– Mindig tegyél fel egy következő kérdést.
`
  }
};

// --------------------
// Root / health
// --------------------
app.get("/", (req, res) => {
  res.send("AIVIO backend fut");
});

// --------------------
// LISTEN – Whisper STT
// --------------------
app.post("/listen", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio received" });
    }

    const form = new FormData();
    form.append("file", req.file.buffer, {
      filename: "speech.webm",
      contentType: "audio/webm"
    });
    form.append("model", "whisper-1");
    form.append("language", "hu");

    const r = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          ...form.getHeaders()
        },
        body: form
      }
    );

    const data = await r.json();

    if (!data.text) {
      return res.status(500).json({ error: "Whisper failed" });
    }

    res.json({ text: data.text });

  } catch (err) {
    console.error("LISTEN ERROR:", err);
    res.status(500).json({ error: "STT error" });
  }
});

// --------------------
// THINK – GPT-4.1 (DÖNTÉS)
// --------------------
app.post("/think", async (req, res) => {
  try {
    const { text, robot = "outbound_sales" } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Missing text" });
    }

    const robotConfig = ROBOTS[robot];
    if (!robotConfig) {
      return res.status(400).json({ error: "Unknown robot" });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: robotConfig.systemPrompt },
        { role: "user", content: text }
      ],
      temperature: 0.4
    });

    const answer = completion.choices[0].message.content;
    res.json({ text: answer });

  } catch (err) {
    console.error("THINK ERROR:", err);
    res.status(500).json({ error: "Thinking failed" });
  }
});

// --------------------
// SPEAK – ElevenLabs TTS
// --------------------
app.post("/speak", async (req, res) => {
  try {
    const { text, voiceId } = req.body;

    if (!text || !voiceId) {
      return res.status(400).send("Missing text or voiceId");
    }

    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json"
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

// --------------------
// Start server
// --------------------
app.listen(PORT,"0.0.0.0", () => {
  console.log(`AIVIO backend fut a ${PORT} porton`);
});
