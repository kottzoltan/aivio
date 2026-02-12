import express from "express";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 8080;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REV = "rev_full_orchestrated_2026_02_12";

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

//////////////////////////////////////////////////////////
// HEALTH
//////////////////////////////////////////////////////////

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    rev: REV,
    openai: !!process.env.OPENAI_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
    odoo: !!process.env.ODOO_URL
  });
});

//////////////////////////////////////////////////////////
// ROBOTS (VÁLTOZATLAN LOGIKA)
//////////////////////////////////////////////////////////

const ROBOTS = {
  outbound_sales: {
    title: "AI Sales Megoldás",
    intro: "Szia! Ari vagyok, AI sales specialista.",
    systemPrompt: `
AI sales megoldást mutatsz be.
Kérj nevet, emailt, telefonszámot, javasolj időpontot.
`
  },
  email_sales: {
    title: "Időpontfoglalás",
    intro: "Segítek pályát foglalni.",
    systemPrompt: `
Dátum, időpont, név, telefonszám.
Egy kérdés egyszerre.
`
  },
  support_inbound: {
    title: "Ügyfélszolgálat",
    intro: "Segítek megoldani a problémát.",
    systemPrompt: `
Lépésről lépésre segíts.
`
  },
  customer_satisfaction: {
    title: "Elégedettségmérés",
    intro: "Néhány rövid kérdés.",
    systemPrompt: `
1-5 skálás kérdések.
`
  }
};

app.get("/robots", (req, res) => {
  const list = Object.entries(ROBOTS).map(([key, v]) => ({
    key,
    title: v.title,
    intro: v.intro
  }));
  res.json({ robots: list });
});

//////////////////////////////////////////////////////////
// THINK (SÉRTHETETLEN BESZÉD + ORCHESTRATION)
//////////////////////////////////////////////////////////

app.post("/think", async (req, res) => {
  try {
    const { text, robot = "outbound_sales", history = [] } = req.body || {};
    if (!text) return res.status(400).json({ error: "Missing text" });

    const cfg = ROBOTS[robot];
    if (!cfg) return res.status(400).json({ error: "Unknown robot" });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1",
      messages: [
        { role: "system", content: cfg.systemPrompt },
        ...(Array.isArray(history) ? history.slice(-10) : []),
        { role: "user", content: text }
      ],
      temperature: 0.4
    });

    const aiText = completion.choices[0].message.content.trim();

    logConversation(robot, text, aiText);
    await postProcess(robot, text);

    res.json({ text: aiText });

  } catch (err) {
    console.error("THINK ERROR:", err);
    res.status(500).json({ error: "Thinking failed" });
  }
});

//////////////////////////////////////////////////////////
// SPEAK (ÉRINTETLEN)
//////////////////////////////////////////////////////////

app.post("/speak", async (req, res) => {
  try {
    const { text, voiceId } = req.body;
    if (!text || !voiceId) return res.status(400).send("Missing data");

    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg"
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_flash_v2_5"
        })
      }
    );

    const audioBuffer = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);

  } catch (err) {
    console.error("SPEAK ERROR:", err);
    res.status(500).send("TTS error");
  }
});

//////////////////////////////////////////////////////////
// LOCAL CONVERSATION LOG
//////////////////////////////////////////////////////////

const DATA_DIR = path.join(__dirname, "data");
const CONV_FILE = path.join(DATA_DIR, "conversations.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(CONV_FILE)) fs.writeFileSync(CONV_FILE, JSON.stringify([]));

function logConversation(robot, userText, aiText) {
  const data = JSON.parse(fs.readFileSync(CONV_FILE));
  data.push({
    id: Date.now(),
    robot,
    userText,
    aiText,
    createdAt: new Date().toISOString()
  });
  fs.writeFileSync(CONV_FILE, JSON.stringify(data, null, 2));
}

//////////////////////////////////////////////////////////
// ODOO LOGIN
//////////////////////////////////////////////////////////

async function odooLogin() {
  const r = await fetch(`${process.env.ODOO_URL}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: {
        service: "common",
        method: "login",
        args: [
          process.env.ODOO_DB,
          process.env.ODOO_USER,
          process.env.ODOO_API_KEY
        ]
      },
      id: Date.now()
    })
  });
  const data = await r.json();
  return data.result;
}

//////////////////////////////////////////////////////////
// ORCHESTRATION LAYER
//////////////////////////////////////////////////////////

function extractContact(text) {
  const email = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  const phone = text.match(/\+?\d[\d\s\-]{7,}/);
  return {
    email: email ? email[0] : null,
    phone: phone ? phone[0] : null
  };
}

async function postProcess(robot, text) {
  try {
    const uid = await odooLogin();

    if (robot === "outbound_sales") {
      const contact = extractContact(text);
      if (contact.email || contact.phone) {

        await fetch(`${process.env.ODOO_URL}/jsonrpc`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "call",
            params: {
              service: "object",
              method: "execute_kw",
              args: [
                process.env.ODOO_DB,
                uid,
                process.env.ODOO_API_KEY,
                "crm.lead",
                "create",
                [{
                  name: "AI Sales Lead",
                  email_from: contact.email,
                  phone: contact.phone,
                  description: text
                }]
              ]
            },
            id: Date.now()
          })
        });

        await fetch(`${process.env.ODOO_URL}/jsonrpc`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "call",
            params: {
              service: "object",
              method: "execute_kw",
              args: [
                process.env.ODOO_DB,
                uid,
                process.env.ODOO_API_KEY,
                "calendar.event",
                "create",
                [{
                  name: "AI Sales Meeting",
                  description: text
                }]
              ]
            },
            id: Date.now()
          })
        });
      }
    }

    if (robot === "email_sales") {
      await fetch(`${process.env.ODOO_URL}/jsonrpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "call",
          params: {
            service: "object",
            method: "execute_kw",
            args: [
              process.env.ODOO_DB,
              uid,
              process.env.ODOO_API_KEY,
              "calendar.event",
              "create",
              [{
                name: "AI Booking",
                description: text
              }]
            ]
          },
          id: Date.now()
        })
      });
    }

    if (robot === "customer_satisfaction") {
      await fetch(`${process.env.ODOO_URL}/jsonrpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "call",
          params: {
            service: "object",
            method: "execute_kw",
            args: [
              process.env.ODOO_DB,
              uid,
              process.env.ODOO_API_KEY,
              "survey.user_input",
              "create",
              [{
                state: "done"
              }]
            ]
          },
          id: Date.now()
        })
      });
    }

  } catch (err) {
    console.error("POST PROCESS ERROR:", err);
  }
}

//////////////////////////////////////////////////////////
// START SERVER
//////////////////////////////////////////////////////////

app.listen(PORT, () => {
  console.log(`AIVIO backend fut a ${PORT} porton | ${REV}`);
});
