const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 8080;

// JSON body kezelése
app.use(express.json());

// 🔹 STATIKUS FÁJLOK (UI + KÉPEK)
app.use("/ui", express.static("public/ui"));
app.use("/img", express.static("public/img"));

// 🔹 GYÖKÉR → UI
app.get("/", (req, res) => {
  res.redirect("/ui");
});

// 🔹 AI SZÖVEG GENERÁLÁS
app.post("/ai", async (req, res) => {
  try {
    const userMessage =
      req.body.message || "Köszönj udvariasan magyarul.";

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          input: `Te egy profi, magyar nyelvű telefonos ügyfélszolgálati asszisztens vagy.
Röviden, természetesen válaszolsz.
Soha nem mondod, hogy mesterséges intelligencia vagy.

Felhasználó: ${userMessage}`
        })
      }
    );

    const data = await response.json();

    const reply =
      data.output_text ||
      "Szia! Üdvözlöm, miben segíthetek?";

    res.json({ reply });
  } catch (err) {
    console.error("AI error:", err);
    res.status(500).json({ error: "AI hiba történt." });
  }
});

// 🔹 ELEVENLABS – BESZÉD
app.post("/speak", async (req, res) => {
  try {
    const text =
      req.body.text || "Szia! Ez az AIVIO hangteszt.";

    const elevenResponse = await fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/xQ7QVYmweeFQQ6autam7",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVENLABS_API_KEY
        },
        body: JSON.stringify({
          text: text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.65,
            similarity_boost: 0.75
          }
        })
      }
    );

    const audioBuffer = await elevenResponse.arrayBuffer();

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(Buffer.from(audioBuffer));
  } catch (err) {
    console.error("TTS error:", err);
    res.status(500).send("Hiba a hang generálásakor.");
  }
});

// 🔹 SZERVER INDÍTÁS
app.listen(PORT, () => {
  console.log(`AIVIO backend fut: http://localhost:${PORT}`);
});
