const express = require("express");
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 8080;

// alap ellenőrző végpont (marad)
app.get("/", (req, res) => {
  res.send("AIVIO él és fut 🚀");
});

// AI teszt végpont
app.post("/ai", async (req, res) => {
  const userMessage = req.body.message || "Mondj egy kedves üdvözlést magyarul";

  // ide később ChatGPT jön, most csak szimuláljuk
  res.json({
    reply: `AI válasz (demo): ${userMessage}`
  });
});

app.listen(PORT, () => {
  console.log(`AIVIO listening on port ${PORT}`);
});
