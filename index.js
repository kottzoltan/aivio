import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🔹 statikus UI
app.use("/ui", express.static(path.join(__dirname, "public/ui")));
app.use("/img", express.static(path.join(__dirname, "public/img")));

// 🔹 OpenAI text endpoint
app.post("/ai", async (req, res) => {
  try {
    const { prompt } = req.body;

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: prompt
      })
    });

    const data = await r.json();
    res.json({ text: data.output_text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI error" });
  }
});

// 🔹 ElevenLabs TTS
app.post("/speak", async (req, res) => {
  try {
    const { text } = req.body;

    const r = await fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL",
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8
          }
        })
      }
    );

    const buffer = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "TTS error" });
  }
});

// 🔹 ROOT redirect (nagyon fontos Cloud Run-nál)
app.get("/", (req, res) => {
  res.redirect("/ui");
});

// 🔥 EZ A KRITIKUS SOR
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`AIVIO demo running on port ${PORT}`);
});
