import express from "express";

const app = express();
const PORT = process.env.PORT || 8080;

// ---- VERZIÓ (ezt látod majd a böngészőben) ----
const FRONTEND_REV = "REV_2026-02-06_23-35_STABLE";

// ---- LOGOLÁS ----
console.log("AIVIO STARTING...");
console.log("Frontend rev:", FRONTEND_REV);
console.log("PORT:", PORT);
console.log("OPENAI_API_KEY present:", !!process.env.OPENAI_API_KEY);

// ---- FRONTEND (INLINE HTML) ----
const html = `
<!doctype html>
<html lang="hu">
<head>
  <meta charset="utf-8" />
  <title>AIVIO – stabil mód</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0b1220;
      color: #e5e7eb;
      padding: 40px;
    }
    .box {
      max-width: 800px;
      margin: auto;
      background: #111827;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 20px 60px rgba(0,0,0,.4);
    }
    h1 { margin-top: 0 }
    .ok { color: #22c55e }
    .warn { color: #facc15 }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      background: #020617;
      padding: 12px;
      border-radius: 8px;
      margin-top: 12px;
    }
  </style>
</head>
<body>
  <div class="box">
    <h1>🚀 AIVIO – STABIL DEPLOY</h1>
    <p class="ok">✔ Cloud Run konténer elindult</p>

    <h3>Frontend verzió</h3>
    <div class="mono">${FRONTEND_REV}</div>

    <h3>Állapot</h3>
    <ul>
      <li>Backend: <b>RUNNING</b></li>
      <li>Port: <b>${PORT}</b></li>
      <li>OpenAI kulcs:
        <b>${process.env.OPENAI_API_KEY ? "BEÁLLÍTVA" : "NINCS MÉG"}</b>
      </li>
    </ul>

    <p class="warn">
      Ez egy tudatosan leegyszerűsített verzió.<br/>
      Innen lépésről lépésre építjük vissza a „szép” UI-t és az AI-t.
    </p>
  </div>
</body>
</html>
`;

// ---- ROUTES ----
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    rev: FRONTEND_REV,
    time: new Date().toISOString()
  });
});

// ---- START ----
app.listen(PORT, () => {
  console.log(`AIVIO listening on ${PORT}`);
});
