import { serve } from "@hono/node-server";
import { getPort } from "@bloon/core";
import { createApp } from "./server.js";

const app = createApp();
const port = getPort();

serve({ fetch: app.fetch, port }, () => {
  console.log(`Bloon listening on http://localhost:${port}`);
});
