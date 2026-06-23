import { serve } from "@hono/node-server";
import { getPort } from "@tomo/core";
import { createApp } from "./server.js";

const app = createApp();
const port = getPort();

serve({ fetch: app.fetch, port }, () => {
  console.log(`Tomo listening on http://localhost:${port}`);
});
