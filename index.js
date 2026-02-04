const express = require("express");
const app = express();

const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  res.send("AIVIO él és fut 🚀");
});

app.listen(PORT, () => {
  console.log(`AIVIO listening on port ${PORT}`);
});
