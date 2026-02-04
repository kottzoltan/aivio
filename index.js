const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

/* =========================
   ROOT → UI
========================= */
app.get("/", (req, res) => {
  res.redirect("/ui");
});

/* =========================
   AI – OpenAI válasz
========================= */
app.post("/ai", async (req, res) => {
  try {
    const userMessage =
      req.body.message ||
      "Köszönj úgy, mint egy udvarias magyar telefonos ügyfélszolgálati asszisztens.";

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: `Te egy profi, magyar nyelvű telefonos ügyfélszolgálati asszisztens vagy.
Nyugodt, barátságos, természetes hangnemben beszélsz.
Soha nem mondod, hogy mesterséges intelligencia vagy.

Felhasználó: ${userMessage}`
      })
    });

    const data = await response.json();

    const reply =
      data.output_text ||
      "Szia! Üdvözlöm, miben segíthetek?";

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI hiba történt." });
  }
});

/* =========================
   SPEAK – ElevenLabs TTS
========================= */
app.post("/speak", async (req, res) => {
  try {
    const text =
      req.body.text ||
      "Szia! Én az AIVIO vagyok. Miben segíthetek?";

    const elevenResponse = await fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/xQ7QVYmweeFQQ6autam7",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVENLABS_API_KEY
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.65,
            similarity_boost: 0.75
          }
        })
      }
    );

    const audioBuffer = await elevenResponse.arrayBuffer();

    res.set("Content-Type", "audio/mpeg");
    res.send(Buffer.from(audioBuffer));
  } catch (err) {
    console.error(err);
    res.status(500).send("Hiba történt a hang generálásakor.");
  }
});

/* =========================
   UI – Webes demo
========================= */
app.get("/ui", (req, res) => {
  res.send(`
<!doctype html>
<html lang="hu">
<head>
  <meta charset="utf-8">
  <title>AIVIO demo</title>
</head>
<body style="font-family:sans-serif">
  <h1>AIVIO – webes demo</h1>

  <button id="talk" style="font-size:20px;padding:12px">
    🎤 Beszélj AIVIO-val
  </button>

  <script>
    document.getElementById("talk").addEventListener("click", async () => {
      // 1️⃣ AI válasz
      const aiResponse = await fetch("/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      const aiData = await aiResponse.json();

      // 2️⃣ Beszéd generálás
      const speakResponse = await fetch("/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: aiData.reply })
      });

      // 3️⃣ Lejátszás
      const audioBlob = await speakResponse.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.play();
    });
  </script>
</body>
</html>
  `);
});

/* =========================
   START
========================= */
app.listen(PORT, () => {
  console.log("AIVIO fut a porton:", PORT);
});
