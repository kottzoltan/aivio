const express = require("express");
const fetch = require("node-fetch");

// Node 18+ esetén van global fetch.
// Ha nálad nincs, akkor vagy állíts Node 18-ra, vagy add hozzá a node-fetch-et (lásd lejjebb).
let fetchFn = global.fetch;
if (!fetchFn) {
  // node-fetch v2 kell (require kompatibilis)
  fetchFn = require("node-fetch");
}

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// --- kis segéd: biztonságos log ---
function logError(prefix, obj) {
  try {
    console.error(prefix, typeof obj === "string" ? obj : JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error(prefix, obj);
  }
}

// --- root ---
app.get("/", (req, res) => res.redirect("/ui"));

// --- AI endpoint ---
app.post("/ai", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Hiányzik az OPENAI_API_KEY (Cloud Run env/secret)." });
    }

    const userMessage =
      req.body?.message ||
      "Kérlek, köszönj magyarul egy bejövő telefonhívás elején.";

    const prompt = `Te egy profi, magyar nyelvű telefonos ügyfélszolgálati asszisztens vagy.
Nyugodt, barátságos, határozott hangnemben beszélsz.
Mindig rövid, természetes mondatokban válaszolsz.
Soha nem mondod, hogy mesterséges intelligencia vagy.

Felhasználó: ${userMessage}`;

    const resp = await fetchFn("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        // Ha szeretnéd, ezt átírhatod pl. "gpt-5-mini"-re (lásd magyarázat lent).
        model: "gpt-4.1-mini",
        input: prompt,
      }),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      logError("OPENAI ERROR:", { status: resp.status, data });
      return res.status(502).json({
        error: "OpenAI hiba a /ai hívásban",
        status: resp.status,
        details: data,
      });
    }

    const reply = data.output_text || "Szia! Üdvözlöm, miben segíthetek?";
    res.json({ reply });
  } catch (err) {
    logError("AI EXCEPTION:", String(err?.stack || err));
    res.status(500).json({ error: "AI szerverhiba történt." });
  }
});

// --- ElevenLabs TTS endpoint ---
app.post("/speak", async (req, res) => {
  try {
    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(500).json({ error: "Hiányzik az ELEVENLABS_API_KEY (Cloud Run env/secret)." });
    }

    const text =
      req.body?.text ||
      "Szia! Ez az AIVIO új, magyar hangteszt verziója.";

    const VOICE_ID = "xQ7QVYmweeFQQ6autam7"; // ide jön a magyaros voice ID-d
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;

    const elevenResp = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.65,
          similarity_boost: 0.75,
        },
      }),
    });

    const contentType = elevenResp.headers.get("content-type") || "";

    // Ha nem oké, olvassuk ki a hibát (általában JSON szöveg)
    if (!elevenResp.ok) {
      const errText = await elevenResp.text().catch(() => "");
      logError("ELEVENLABS ERROR:", { status: elevenResp.status, contentType, errText });
      return res.status(502).json({
        error: "ElevenLabs hiba a /speak hívásban",
        status: elevenResp.status,
        details: errText,
      });
    }

    // Biztonság: ha nem audio jött vissza, ne küldjük audio/mpeg-ként
    if (!contentType.includes("audio")) {
      const weird = await elevenResp.text().catch(() => "");
      logError("ELEVENLABS NOT AUDIO:", { contentType, weird });
      return res.status(502).json({
        error: "ElevenLabs nem audiót adott vissza",
        details: weird,
      });
    }

    const audioBuffer = await elevenResp.arrayBuffer();
    res.set("Content-Type", "audio/mpeg");
    res.send(Buffer.from(audioBuffer));
  } catch (err) {
    logError("SPEAK EXCEPTION:", String(err?.stack || err));
    res.status(500).json({ error: "TTS szerverhiba történt." });
  }
});

// --- UI ---
app.get("/ui", (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="hu">
<head>
  <meta charset="utf-8" />
  <title>AIVIO demo</title>
</head>
<body style="font-family: sans-serif">
  <h1>AIVIO – webes demo</h1>

  <button id="talk" style="font-size:20px;padding:10px">🎤 Beszélj AIVIO-val</button>

  <p id="status" style="margin-top:16px;color:#444"></p>

  <script>
    const statusEl = document.getElementById("status");
    const btn = document.getElementById("talk");

    btn.onclick = async () => {
      try {
        statusEl.textContent = "Gondolkodom…";

        // 1) AI szöveg
        const aiResponse = await fetch("/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "Kérlek, köszönj úgy, mint egy udvarias telefonos asszisztens." })
        });

        const aiData = await aiResponse.json().catch(() => ({}));
        if (!aiResponse.ok) {
          statusEl.textContent = "AI hiba: " + (aiData.error || aiResponse.status);
          console.error("AI error:", aiData);
          return;
        }

        statusEl.textContent = "Megszólalok… (" + aiData.reply + ")";

        // 2) TTS
        const speakResponse = await fetch("/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: aiData.reply })
        });

        // ha JSON hiba jött vissza, azt kiírjuk
        const ct = speakResponse.headers.get("content-type") || "";
        if (!speakResponse.ok || ct.includes("application/json")) {
          const err = await speakResponse.json().catch(() => ({}));
          statusEl.textContent = "TTS hiba: " + (err.error || speakResponse.status);
          console.error("TTS error:", err);
          return;
        }

        const audioBlob = await speakResponse.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        await audio.play();
      } catch (e) {
        statusEl.textContent = "Böngésző hiba (lásd Console).";
        console.error(e);
      }
    };
  </script>
</body>
</html>`);
});

// --- listen LEGALUL A VÉGÉN ---
app.listen(PORT, () => {
  console.log(`AIVIO listening on port ${PORT}`);
});
