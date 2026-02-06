import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 8080;

// ESM boilerplate
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "2mb" }));

// 🔥 FRONTEND KISZOLGÁLÁSA ROOT-ON
app.get("/", (req, res) => {
  const htmlPath = path.join(__dirname, "index.html");

  if (!fs.existsSync(htmlPath)) {
    return res.status(500).send("index.html NOT FOUND in container");
  }

  res.sendFile(htmlPath);
});

// ---- CHAT (stub)
app.post("/chat", (req, res) => {
  const { text, agentId } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Missing text" });
  }

  res.json({
    text: `(${agentId || "Ari"}) Ezt mondtad: ${text}`
  });
});

// ---- SPEAK (ElevenLabs Flash v2.5)
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

// ---- START
app.listen(PORT, () => {
  console.log(`AIVIO backend fut a ${PORT} porton`);
});
