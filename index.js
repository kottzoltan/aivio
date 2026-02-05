import express from "express";

const app = express();

app.get("/", (req, res) => {
  res.send("AIVIO Cloud Run OK");
});

const PORT = process.env.PORT || 8080;

console.log("Starting server...");
console.log("PORT =", PORT);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Listening on ${PORT}`);
});
