import express from "express";

const app = express();
app.use("/ui", express.static("public/ui"));
app.use("/img", express.static("public/img"));
app.use(express.json());


const PORT = process.env.PORT || 8080;

/* ---------- ROOT ---------- */
app.get("/", (req, res) => {
  res.redirect("/ui");
});

/* ---------- AI TEXT ---------- */
app.post("/ai", async (req, res) => {
  try {
    const userMessage =
      req.body.message ||
      "Kérlek, köszönj udvariasan egy bejövő telefonhívás elején.";

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Te egy profi, magyar nyelvű telefonos ügyfélszolgálati asszisztens vagy. Rövid, természetes mondatokban beszélsz. Soha nem mondod, hogy AI vagy."
          },
          { role: "user", content: userMessage }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("OpenAI error:", err);
      return res.status(500).json({ error: "OpenAI hiba" });
    }

    const data = await response.json();
    const reply = data.choices[0].message.content;

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI hiba" });
  }
});

/* ---------- SPEECH ---------- */
app.post("/speak", async (req, res) => {
  try {
    const text = req.body.text || "Szia! Itt az AIVIO.";

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
            stability: 0.6,
            similarity_boost: 0.75
          }
        })
      }
    );

    const buffer = Buffer.from(await elevenResponse.arrayBuffer());

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).send("Hanghiba");
  }
});

/* ---------- UI ---------- */
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
  <button id="talk" style="font-size:20px;padding:10px">🎤 Beszélj AIVIO-val</button>

<script>
document.getElementById("talk").onclick = async () => {
  const ai = await fetch("/ai", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ message: "Köszönj udvariasan!" })
  });
  const aiData = await ai.json();

  const voice = await fetch("/speak", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ text: aiData.reply })
  });

  const blob = await voice.blob();
  const audio = new Audio(URL.createObjectURL(blob));
  audio.play();
};
</script>
</body>
</html>
`);
});

/* ---------- START ---------- */
app.listen(PORT, () => {
  console.log("AIVIO listening on", PORT);
});
