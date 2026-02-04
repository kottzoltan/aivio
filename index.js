const express = require("express");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

/* ========= ROOT ========= */
app.get("/", (req, res) => {
  res.redirect("/ui");
});

/* ========= AI SZÖVEG ========= */
app.post("/ai", async (req, res) => {
  try {
    const userMessage =
      req.body.message ||
      "Kérlek, köszönj úgy, mint egy udvarias telefonos ügyfélszolgálatos.";

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: `Te egy profi, magyar nyelvű telefonos ügyfélszolgálati asszisztens vagy.
Nyugodt, barátságos, határozott hangnemben beszélsz.
Rövid, természetes mondatokban válaszolsz.
Soha nem mondod, hogy mesterséges intelligencia vagy.

Felhasználó: ${userMessage}`,
      }),
    });

    const data = await response.json();
    const reply = data.output_text || "Szia! Üdvözlöm, miben segíthetek?";

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI hiba történt." });
  }
});

/* ========= ELEVENLABS BESZÉD ========= */
app.post("/speak", async (req, res) => {
  try {
    const text =
      req.body.text || "Szia! Én az AIVIO vagyok. Miben segíthetek?";

    const elevenResponse = await fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/xQ7QVYmweeFQQ6autam7",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.65,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    const audioBuffer = await elevenResponse.arrayBuffer();
    res.set("Content-Type", "audio/mpeg");
    res.send(Buffer.from(audioBuffer));
  } catch (err) {
    console.error(err);
    res.status(500).send("Hiba a hang generálásakor.");
  }
});

/* ========= UI ========= */
app.get("/ui", (req, res) => {
  res.send(`
<!doctype html>
<html lang="hu">
<head>
  <meta charset="utf-8" />
  <title>AIVIO demo</title>
</head>
<body style="font-family:sans-serif">
  <h1>AIVIO – webes demo</h1>

  <button id="talk" style="font-size:20px;padding:12px">
    🎤 Beszélj AIVIO-val
  </button>

  <script>
    document.getElementById("talk").onclick = async () => {
      const aiResponse = await fetch("/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Kérlek, köszönj úgy, mint egy udvarias telefonos asszisztens."
        })
      });

      const aiData = await aiResponse.json();

      const speakResponse = await fetch("/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: aiData.reply })
      });

      const audioBlob = await speakResponse.blob();
      const audio = new Audio(URL.createObjectURL(audioBlob));
      audio.play();
    };
  </script>
</body>
</html>
`);
});

/* ========= INDÍTÁS ========= */
app.listen(PORT, () => {
  console.log("AIVIO fut a porton:", PORT);
});
