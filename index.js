import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// __dirname ES module kompatibilis
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =======================
// STATIKUS UI
// =======================
app.use("/ui", express.static(path.join(__dirname, "public/ui")));
app.use("/img", express.static(path.join(__dirname, "public/img")));

app.get("/", (req, res) => {
  res.redirect("/ui");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// =======================
// 🤖 AI – OpenAI (STABIL)
// =======================
app.post("/ai", async (req, res) => {
  try {
    const { text, agent } = req.body;

    const systemPrompt = `
Te egy magyar nyelvű AI asszisztens vagy az AIVIO demóban.
Stílusod: barátságos, üzleties, rövid válaszok.
Szerepkör: ${agent || "általános AI asszisztens"}.
Mindig magyarul válaszolj.
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
          { role: "system", content: systemPrompt },
          { role: "user", content: text }
        ],
        temperature: 0.4
      })
    });

    const data = await r.json();

    if (data.error) {
      console.error("OpenAI error:", data.error);
      return res.json({ answer: "Elnézést, most technikai hiba történt." });
    }

    const answer =
      data.choices?.[0]?.message?.content ??
      "Elnézést, nem tudok most válaszolni.";

    res.json({ answer });
  } catch (err) {
    console.error("AI error:", err);
    res.status(500).json({ error: "AI error" });
  }
});

// =======================
// 🔊 TTS – ElevenLabs (ÚJ HANG ID)
// =======================
app.post("/speak", async (req, res) => {
  try {
    const { text } = req.body;

    const r = await fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/xQ7QVYmweeFQQ6autam7",
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
            stability: 0.45,
            similarity_boost: 0.75
          }
        })
      }
    );

    const audioBuffer = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (err) {
    console.error("TTS error:", err);
    res.status(500).json({ error: "TTS error" });
  }
});

// =======================
// 🚀 CLOUD RUN
// =======================
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`AIVIO demo running on port ${PORT}`);
});
