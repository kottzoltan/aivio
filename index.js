const express = require("express");
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 8080;

// Ellenőrző végpont
app.get("/", (req, res) => {
  res.send("AIVIO él és fut 🚀");
});

// Valódi ChatGPT végpont
app.post("/ai", async (req, res) => {
  try {
    const userMessage =
      req.body.message || "Kérlek, köszönj magyarul egy bejövő telefonhívás elején.";

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: `Te egy udvarias, magyar nyelvű telefonos AI asszisztens vagy. Röviden válaszolj.\n\nFelhasználó: ${userMessage}`
      })
    });

    const data = await response.json();

    // A válasz szövegének kinyerése
    const reply =
      data.output_text ||
      "Szia! Üdvözlöm, miben segíthetek?";

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI hiba történt." });
  }
});

app.listen(PORT, () => {
  console.log(`AIVIO listening on port ${PORT}`);
});
// ElevenLabs – beszéd generálás
app.post("/speak", async (req, res) => {
  try {
    const text =
      req.body.text || "Szia! Üdvözlöm, miben segíthetek?";

    const elevenResponse = await fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVENLABS_API_KEY
        },
        body: JSON.stringify({
          text: text,
          model_id: "eleven_multilingual_v2",
          voice_id: "xQ7QVYmweeFQQ6autam7",
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.8
          }
        })
      }
    );

    const audioBuffer = await elevenResponse.arrayBuffer();

    res.set({
      "Content-Type": "audio/mpeg"
    });

    res.send(Buffer.from(audioBuffer));
  } catch (err) {
    console.error(err);
    res.status(500).send("Hiba történt a hang generálásakor.");
  }
});
