import { BloonError } from "@bloon/core";
import type { ErrorHandler } from "hono";

const STATUS_MAP: Record<string, number> = {
  SHIPPING_REQUIRED: 400,
  MISSING_FIELD: 400,
  INVALID_URL: 400,
  URL_UNREACHABLE: 400,
  INVALID_SELECTION: 400,
  ORDER_NOT_FOUND: 404,
  ORDER_INVALID_STATUS: 409,
  ORDER_EXPIRED: 410,
  CHECKOUT_FAILED: 502,
  CHECKOUT_DECLINED: 502,
  PRICE_EXTRACTION_FAILED: 502,
  QUERY_FAILED: 502,
  SEARCH_NO_RESULTS: 404,
  SEARCH_UNAVAILABLE: 503,
  SEARCH_RATE_LIMITED: 429,
};

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof BloonError) {
    const status = STATUS_MAP[err.code] ?? 500;
    return c.json({ error: { code: err.code, message: err.message } }, status as 400);
  }

  console.error("Unhandled error:", err);

  return c.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    500,
  );
};
