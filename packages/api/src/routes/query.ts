import { Hono } from "hono";
import { TomoError, ErrorCodes } from "@tomo/core";
import { query, searchQuery } from "@tomo/orchestrator";
import { formatQueryResponse, formatSearchQueryResponse } from "../formatters.js";

export const queryRoutes = new Hono();

queryRoutes.post("/query", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  const hasUrl = typeof body.url === "string" && body.url.trim() !== "";
  const hasQuery = typeof body.query === "string" && body.query.trim() !== "";

  if (hasUrl && hasQuery) {
    throw new TomoError(
      ErrorCodes.MISSING_FIELD,
      "Provide either 'url' or 'query', not both",
    );
  }

  if (!hasUrl && !hasQuery) {
    throw new TomoError(
      ErrorCodes.MISSING_FIELD,
      "Either 'url' or 'query' is required",
    );
  }

  if (hasQuery) {
    const result = await searchQuery({ query: body.query.trim() });
    return c.json(formatSearchQueryResponse(result));
  }

  const result = await query({ url: body.url.trim() });
  return c.json(formatQueryResponse(result));
});
