import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

// ES module __dirname pótlás
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🔹 statikus UI
app.use("/ui", express.static(path.join(__dirname, "public/ui")));
app.use("/img", express.static(path.join(__dirname, "public/img")));

// 🔹 root → UI
app.get("/", (req, res) => {
  res.redirect("/ui");
});

// 🔹 debug health
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// 🔥 Cloud Run PORT
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`AIVIO running on port ${PORT}`);
});
