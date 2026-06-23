import type { Order, Receipt } from "@bloon/core";
import type { CheckoutResult } from "@bloon/checkout";

export interface ReceiptInput {
  order: Order;
  checkoutResult?: CheckoutResult;
}

export function buildReceipt(input: ReceiptInput): Receipt {
  const { order, checkoutResult } = input;

  const receipt: Receipt = {
    product: order.product.name,
    merchant: new URL(order.product.url).hostname,
    price: order.payment.price,
    fee: order.payment.fee,
    total_paid: order.payment.total,
    timestamp: new Date().toISOString(),
  };

  if (checkoutResult) {
    receipt.order_number = checkoutResult.orderNumber;
    receipt.browserbase_session_id = checkoutResult.sessionId;
  }

  return receipt;
}
