import { Hono } from "hono";
import { BloonError, ErrorCodes, getOrder } from "@bloon/core";
import { confirm } from "@bloon/orchestrator";
import {
  formatConfirmResponse,
  formatConfirmFailedResponse,
} from "../formatters.js";

export const confirmRoutes = new Hono();

// POST /api/confirm — execute purchase
confirmRoutes.post("/confirm", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  if (
    !body.order_id ||
    typeof body.order_id !== "string" ||
    body.order_id.trim() === ""
  ) {
    throw new BloonError(ErrorCodes.MISSING_FIELD, "order_id is required");
  }

  try {
    const result = await confirm({ order_id: body.order_id.trim() });
    return c.json(formatConfirmResponse(result.order, result.receipt));
  } catch (err) {
    // For CHECKOUT_FAILED, return 200 with failed order details per spec
    if (
      err instanceof BloonError &&
      err.code === ErrorCodes.CHECKOUT_FAILED
    ) {
      const order = getOrder(body.order_id.trim());
      if (order?.error) {
        return c.json(formatConfirmFailedResponse(order));
      }
    }
    throw err;
  }
});
