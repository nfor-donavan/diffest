import "dotenv/config";
import express from "express";
import cors from "cors";
import generateRouter from "./routes/generate.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/generate", generateRouter);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Diffest backend listening on port ${port}`);
});
