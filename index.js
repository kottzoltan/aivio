const express = require("express");
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 8080;

// Ellenőrző végpont
app.get("/", (req, res) => {
  res.redirect("/ui");
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
  req.body.text || "Szia! Ez az AIVIO új, magyar hangteszt verziója.";

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
app.get("/ui", (req, res) => {
  res.send(`
    <!doctype html>
    <html lang="hu">
    <head>
      <meta charset="utf-8" />
      <title>AIVIO demo</title>
    </head>
    <body style="font-family: sans-serif">
      <h1>AIVIO – webes demo</h1>

      <button id="talk" style="font-size:20px;padding:10px">
        🎤 Beszélj AIVIO-val
      </button>

      <script>
        document.getElementById("talk").onclick = async () => {
          const r = await fetch("/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
         const aiResponse = await fetch("/ai", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: "Kérlek, köszönj úgy, mint egy udvarias telefonos asszisztens."
  })
});

const aiData = await aiResponse.json();

const r = await fetch("/speak", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    text: aiData.reply
  })
});

          });

          const audioBlob = await r.blob();
          const audio = new Audio(URL.createObjectURL(audioBlob));
          audio.play();
        };
      </script>
    </body>
    </html>
  `);
});
