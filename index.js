import express from "express";
import multer from "multer";
import FormData from "form-data";

const app = express();
const PORT = process.env.PORT || 8080;

// ---- middleware
app.use(express.json({ limit: "2mb" }));

// ---- audio upload (Whisperhez)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

// ---- health / root
app.get("/", (req, res) => {
  res.send("AIVIO backend fut");
});

/**
 * ============================
 * CHAT (stub – később AI logika)
 * ============================
 */
app.post("/chat", (req, res) => {
  const { text, agentId } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Missing text" });
  }

  res.json({
    text: `(${agentId || "Ari"}) Ezt mondtad: ${text}`
  });
});

/**
 * ============================
 * SPEAK – ElevenLabs TTS
 * ============================
 */
app.post("/speak", async (req, res) => {
  try {
    const { text, voiceId } = req.body;

    if (!text || !voiceId) {
      return res.status(400).send("Missing text or voiceId");
    }

    if (!process.env.ELEVENLABS_API_KEY) {
      console.error("Missing ELEVENLABS_API_KEY");
      return res.status(500).send("Missing ElevenLabs API key");
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

/**
 * ============================
 * LISTEN – OpenAI Whisper STT
 * ============================
 */
app.post("/listen", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio received" });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error("Missing OPENAI_API_KEY");
      return res.status(500).json({ error: "Missing OpenAI API key" });
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
      console.error("Whisper error:", data);
      return res.status(500).json({ error: "Whisper failed" });
    }

    res.json({ text: data.text });

  } catch (err) {
    console.error("LISTEN ERROR:", err);
    res.status(500).json({ error: "STT error" });
  }
});

/**
 * ============================
 * START SERVER
 * ============================
 */
app.listen(PORT, () => {
  console.log(`AIVIO backend fut a ${PORT} porton`);
});
