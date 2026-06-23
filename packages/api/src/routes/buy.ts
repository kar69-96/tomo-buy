import { Hono } from "hono";
import { TomoError, ErrorCodes } from "@tomo/core";
import { buy } from "@tomo/orchestrator";
import { formatBuyResponse } from "../formatters.js";

export const buyRoutes = new Hono();

// POST /api/buy — get purchase quote
buyRoutes.post("/buy", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  if (!body.url || typeof body.url !== "string" || body.url.trim() === "") {
    throw new TomoError(ErrorCodes.MISSING_FIELD, "url is required");
  }

  const order = await buy({
    url: body.url.trim(),
    shipping: body.shipping,
    selections: body.selections,
  });

  return c.json(formatBuyResponse(order));
});
