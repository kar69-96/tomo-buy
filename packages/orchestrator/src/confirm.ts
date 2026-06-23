import {
  type Order,
  type Receipt,
  BloonError,
  ErrorCodes,
  getOrder,
  updateOrder,
} from "@bloon/core";
import { runCheckout } from "@bloon/checkout";
import { selectEngine, runHTTPCheckout, invalidateProfile } from "@bloon/checkout-http";
import { buildReceipt } from "./receipts.js";

/**
 * Extract the bare domain from a URL, stripping "www." prefix.
 */
function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export interface ConfirmInput {
  order_id: string;
}

export interface ConfirmResult {
  order: Order;
  receipt: Receipt;
}

export async function confirm(input: ConfirmInput): Promise<ConfirmResult> {
  const { order_id } = input;

  // 1. Look up order
  const order = getOrder(order_id);
  if (!order) {
    throw new BloonError(
      ErrorCodes.ORDER_NOT_FOUND,
      `Order not found: ${order_id}`,
    );
  }

  // 2. Already completed — return existing receipt
  if (order.status === "completed" && order.receipt) {
    return { order, receipt: order.receipt };
  }

  // 3. Must be awaiting confirmation
  if (order.status !== "awaiting_confirmation") {
    throw new BloonError(
      ErrorCodes.ORDER_INVALID_STATUS,
      `Order ${order_id} cannot be confirmed (status: "${order.status}")`,
    );
  }

  // 4. Expiry check
  if (new Date(order.expires_at) < new Date()) {
    await updateOrder(order_id, { status: "expired" });
    throw new BloonError(
      ErrorCodes.ORDER_EXPIRED,
      `Order ${order_id} has expired`,
    );
  }

  // 5. Update to processing
  const confirmedAt = new Date().toISOString();
  await updateOrder(order_id, { status: "processing", confirmed_at: confirmedAt });

  try {
    // 6. Run browser checkout
    if (!order.shipping) {
      throw new BloonError(
        ErrorCodes.SHIPPING_REQUIRED,
        "Shipping info missing on order for browser checkout",
      );
    }

    const domain = getDomain(order.product.url);
    const engine = selectEngine(domain);
    let checkoutResult;

    if (engine === "http") {
      const httpResult = await runHTTPCheckout({
        order,
        shipping: order.shipping,
        selections: order.selections,
      });

      if (httpResult.success) {
        // Map HTTPCheckoutResult to match expected shape
        checkoutResult = {
          success: true as const,
          orderNumber: httpResult.orderNumber,
          finalTotal: httpResult.finalTotal,
          sessionId: httpResult.sessionId,
          replayUrl: httpResult.replayUrl,
          durationMs: httpResult.durationMs,
        };
      } else {
        // HTTP engine failed — invalidate cache and fall back to Stagehand
        invalidateProfile(domain);
        checkoutResult = await runCheckout({
          order,
          shipping: order.shipping,
          selections: order.selections,
        });
      }
    } else {
      checkoutResult = await runCheckout({
        order,
        shipping: order.shipping,
        selections: order.selections,
      });
    }

    if (!checkoutResult.success) {
      const isDecline = checkoutResult.errorMessage &&
        (/payment_declined|card_invalid/.test(checkoutResult.errorMessage));
      const code = isDecline ? ErrorCodes.CHECKOUT_DECLINED : ErrorCodes.CHECKOUT_FAILED;
      throw new BloonError(
        code,
        checkoutResult.errorMessage ?? `Checkout did not confirm (session: ${checkoutResult.sessionId})`,
      );
    }

    // 7. Build receipt
    const receipt = buildReceipt({
      order,
      checkoutResult,
    });

    await updateOrder(order_id, {
      status: "completed",
      receipt,
      completed_at: new Date().toISOString(),
    });

    return { order: { ...order, status: "completed", receipt }, receipt };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Execution failed";

    await updateOrder(order_id, {
      status: "failed",
      error: {
        code: ErrorCodes.CHECKOUT_FAILED,
        message: errorMessage,
      },
    });

    if (error instanceof BloonError) throw error;
    throw new BloonError(ErrorCodes.CHECKOUT_FAILED, errorMessage);
  }
}
