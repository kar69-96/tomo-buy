import {
  type Order,
  type Receipt,
  type CardInfo,
  type ExecutionBrief,
  TomoError,
  ErrorCodes,
  getOrder,
  updateOrder,
  getFundingMode,
  getAgentcardBufferPct,
  getAgentcardMaxAmount,
} from "@tomo/core";
import { runCheckout, issueAndRevealCard } from "@tomo/checkout";
import type { LoginPlan } from "@tomo/checkout";
import { selectEngine, runHTTPCheckout, invalidateProfile } from "@tomo/checkout-http";
import { buildReceipt } from "./receipts.js";

/** Compute the dollar amount to fund a single-use card with, from the order. */
function fundingAmountDollars(order: Order): number {
  const price = parseFloat(order.payment.price || order.product.price || "0");
  const base = Number.isFinite(price) && price > 0 ? price : 0;
  const withBuffer = base * (1 + getAgentcardBufferPct());
  const capped = Math.min(withBuffer, getAgentcardMaxAmount());
  return Math.ceil(capped * 100) / 100;
}

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
  /** Optional resolved login strategy to get past a login gate during checkout. */
  loginPlan?: LoginPlan;
  /**
   * No-spend oversight run: drive the real browser through login/cart/shipping to
   * the payment page, then STOP before placing the order. No Agentcard is issued
   * and no card is typed, so the run is structurally incapable of spending.
   */
  stopBeforePlaceOrder?: boolean;
  /**
   * High-detail execution brief from the planner. Carries the objective, grounded
   * parameters and ordered execution steps that guide the checkout LLM loop through
   * multi-step task flows the scripted product handlers don't model. No secrets.
   */
  brief?: ExecutionBrief;
}

export interface ConfirmResult {
  order: Order;
  /** Present on a completed purchase. Absent when parked (stopBeforePlaceOrder). */
  receipt?: Receipt;
  /** Present when the run parked at the payment page without spending. */
  parked?: { at: "payment"; observed_total?: string; session_id: string };
}

export async function confirm(input: ConfirmInput): Promise<ConfirmResult> {
  const { order_id, loginPlan } = input;

  // 1. Look up order
  const order = getOrder(order_id);
  if (!order) {
    throw new TomoError(
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
    throw new TomoError(
      ErrorCodes.ORDER_INVALID_STATUS,
      `Order ${order_id} cannot be confirmed (status: "${order.status}")`,
    );
  }

  // 4. Expiry check
  if (new Date(order.expires_at) < new Date()) {
    await updateOrder(order_id, { status: "expired" });
    throw new TomoError(
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
      throw new TomoError(
        ErrorCodes.SHIPPING_REQUIRED,
        "Shipping info missing on order for browser checkout",
      );
    }

    const domain = getDomain(order.product.url);

    // 6a. Fund the purchase: issue a single-use Agentcard sized to the order
    //     total (item price + buffer for tax/shipping, capped). Only the opaque
    //     card id is logged — the PAN/CVV/expiry go straight to CDP injection.
    //     A no-spend oversight run (stopBeforePlaceOrder) NEVER issues a card —
    //     this is the load-bearing guarantee that the run cannot spend money.
    let card: CardInfo | undefined;
    if (!input.stopBeforePlaceOrder && getFundingMode() === "agentcard") {
      const amount = fundingAmountDollars(order);
      const issued = await issueAndRevealCard(amount);
      card = issued.card;
      console.log(`[funding] issued single-use Agentcard ${issued.id} for $${amount.toFixed(2)}`);
    }

    // The Agentcard path REQUIRES the browser checkout (card injected via CDP).
    // The HTTP engine uses static credentials, so it's only used when explicitly
    // opted into AND funding is static (debugging).
    const useHttp =
      !input.stopBeforePlaceOrder &&
      process.env.CHECKOUT_ENGINE === "http" &&
      getFundingMode() === "static" &&
      selectEngine(domain) === "http";

    let checkoutResult;
    if (useHttp) {
      const httpResult = await runHTTPCheckout({
        order,
        shipping: order.shipping,
        selections: order.selections,
      });

      if (httpResult.success) {
        checkoutResult = {
          success: true as const,
          orderNumber: httpResult.orderNumber,
          finalTotal: httpResult.finalTotal,
          sessionId: httpResult.sessionId,
          replayUrl: httpResult.replayUrl,
          durationMs: httpResult.durationMs,
        };
      } else {
        // HTTP engine failed — invalidate cache and fall back to the browser path
        invalidateProfile(domain);
        checkoutResult = await runCheckout({
          order,
          shipping: order.shipping,
          selections: order.selections,
          card,
          loginPlan,
          dryRun: input.stopBeforePlaceOrder,
          brief: input.brief,
        });
      }
    } else {
      checkoutResult = await runCheckout({
        order,
        shipping: order.shipping,
        selections: order.selections,
        card,
        loginPlan,
        dryRun: input.stopBeforePlaceOrder,
        brief: input.brief,
      });
    }

    if (!checkoutResult.success) {
      const isDecline = checkoutResult.errorMessage &&
        (/payment_declined|card_invalid/.test(checkoutResult.errorMessage));
      const code = isDecline ? ErrorCodes.CHECKOUT_DECLINED : ErrorCodes.CHECKOUT_FAILED;
      throw new TomoError(
        code,
        checkoutResult.errorMessage ?? `Checkout did not confirm (session: ${checkoutResult.sessionId})`,
      );
    }

    // 6c. No-spend oversight run: parked at the payment page. No card was issued
    //     and no order placed. Revert the order to awaiting_confirmation (so it
    //     can still be confirmed for real later) and return the observed total.
    if (input.stopBeforePlaceOrder) {
      await updateOrder(order_id, { status: "awaiting_confirmation" });
      return {
        order,
        parked: {
          at: "payment",
          observed_total: checkoutResult.finalTotal,
          session_id: checkoutResult.sessionId,
        },
      };
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

    if (error instanceof TomoError) throw error;
    throw new TomoError(ErrorCodes.CHECKOUT_FAILED, errorMessage);
  }
}
