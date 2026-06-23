import { Hono } from "hono";
import { buyRoutes } from "./routes/buy.js";
import { confirmRoutes } from "./routes/confirm.js";
import { queryRoutes } from "./routes/query.js";
import { errorHandler } from "./error-handler.js";

export function createApp(): Hono {
  const app = new Hono();

  app.route("/api", buyRoutes);
  app.route("/api", confirmRoutes);
  app.route("/api", queryRoutes);

  app.onError(errorHandler);

  return app;
}
