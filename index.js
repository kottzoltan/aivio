import express from "express";

// Node 18+ esetén VAN beépített fetch
// NEM kell node-fetch import

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: "2mb" }));

/**
 * Health check
 */
app.get("/", (req, res) => {
  res.send("AIVIO backend fut");
});

/**
 * CHAT endpoint (egyszerű stub – később bővíthető)
 */
app.post("/chat", async (req, res) => {
  const { text, agentId } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Missing text" });
  }

  // MOST csak visszamondjuk (hogy a flow éljen)
  res.json({
    text: `(${agentId || "Ari"}) Ezt mondtad: ${text}`
  });
});

/**
 * SPEAK endpoint – ElevenLabs Flash v2.5
 */
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

    const elevenResponse = await fetch(
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

    if (!elevenResponse.ok) {
      const errText = await elevenResponse.text();
      console.error("ElevenLabs error:", errText);
      return res.status(500).send("TTS failed");
    }

    // 🔑 KRITIKUS RÉSZ – NINCS pipe()
    const audioBuffer = Buffer.from(
      await elevenResponse.arrayBuffer()
    );

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.length);
    res.send(audioBuffer);

  } catch (err) {
    console.error("SPEAK ERROR:", err);
    res.status(500).send("TTS error");
  }
});

/**
 * START SERVER
 */
app.listen(PORT, () => {
  console.log(`AIVIO backend fut a ${PORT} porton`);
});
