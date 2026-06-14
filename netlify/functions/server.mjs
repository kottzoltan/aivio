import serverless from "serverless-http";
import { app } from "../../index.js";

export const handler = serverless(app, {
  binary: ["audio/*", "application/octet-stream"]
});
