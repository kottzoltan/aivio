import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

// ─────────────────────────────
// PATH FIX (Cloud Run kompatibilis)
// ─────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────
// STATIKUS TARTALOM
// ─────────────────────────────
app.use("/ui", express.static(path.join(__dirname, "public/ui")));
app.use("/img", express.static(path.join(__dirname, "public/img")));

app.get("/", (req, res) => {
  res.redirect("/ui/");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ─────────────────────────────
// /ai – SZÖVEGES AI VÁLASZ
// ─────────────────────────────
app.post("/ai", async (req, res) => {
  try {
    const { text, agent } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Hiányzó szöveg" });
    }

    const prompt = `
Te egy barátságos, természetesen beszélő magyar AI asszisztens vagy.
Ne légy túl hosszú, beszédre optimalizált válaszokat adj.

Felhasználó:
"${text}"
`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Magyar nyelvű AI asszisztens." },
          { role: "user", content: prompt }
        ],
        temperature: 0.6
      })
    });

    const data = await r.json();
    const answer = data.choices?.[0]?.message?.content || "Sajnos nem tudok válaszolni.";

    res.json({ answer });

  } catch (err) {
    console.error("AI ERROR:", err);
    res.status(500).json({ error: "AI hiba történt" });
  }
});

// ─────────────────────────────
// /speak – ELEVENLABS TTS
// KIVÁLASZTOTT HANGGAL
// voice_id: xQ7QVYmweeFQQ6autam7
// ─────────────────────────────
app.post("/speak", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).send("Hiányzó szöveg");
    }

    const elevenlabsUrl =
      "https://api.elevenlabs.io/v1/text-to-speech/xQ7QVYmweeFQQ6autam7";

    const r = await fetch(elevenlabsUrl, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8
        }
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error("ElevenLabs error:", errText);
      return res.status(500).send("TTS hiba");
    }

    res.setHeader("Content-Type", "audio/mpeg");
    r.body.pipe(res);

  } catch (err) {
    console.error("SPEAK ERROR:", err);
    res.status(500).send("Hang generálási hiba");
  }
});

// ─────────────────────────────
// CLOUD RUN PORT
// ─────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`AIVIO backend fut a ${PORT} porton`);
});
