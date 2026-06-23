// ---- Confirmation page detection via text signal matching ----

const POSITIVE_SIGNALS: readonly string[] = [
  "thank you",
  "order confirmed",
  "order number",
  "confirmation number",
  "order placed",
  "purchase complete",
  "successfully placed",
  "your order has been",
  "we received your order",
  "confirmation email",
  "order summary",
  "estimated delivery",
];

const NEGATIVE_SIGNALS: readonly string[] = [
  "card number",
  "credit card",
  "pay now",
  "place order",
  "complete purchase",
  "add to cart",
  "checkout",
  "payment method",
  "billing address",
  "shipping address",
  "enter your",
  "sign in",
  "create account",
  // Error/decline signals — prevent false-positive confirmations
  "payment declined",
  "card was declined",
  "card has been declined",
  "transaction failed",
  "transaction declined",
  "payment failed",
  "order could not be placed",
  "order could not be completed",
  "unable to process your payment",
  "insufficient funds",
  "out of stock",
  "sold out",
  "card has expired",
  "invalid card number",
];

export interface ConfirmationResult {
  isConfirmed: boolean;
  confidence: number;
  reason: string;
}

export function verifyConfirmationPage(pageText: string): ConfirmationResult {
  const lower = pageText.toLowerCase();

  let positiveCount = 0;
  const positiveMatches: string[] = [];
  for (const signal of POSITIVE_SIGNALS) {
    if (lower.includes(signal)) {
      positiveCount++;
      positiveMatches.push(signal);
    }
  }

  let negativeCount = 0;
  const negativeMatches: string[] = [];
  for (const signal of NEGATIVE_SIGNALS) {
    if (lower.includes(signal)) {
      negativeCount++;
      negativeMatches.push(signal);
    }
  }

  // Positive must strictly outnumber negative for confirmation
  const isConfirmed = positiveCount > 0 && positiveCount > negativeCount;
  const confidence = Math.min(1, positiveCount / 3);
  const reason = isConfirmed
    ? `Matched ${positiveCount} positive signal(s): ${positiveMatches.join(", ")}`
    : positiveCount === 0
      ? "No positive signals found"
      : `Negative signals (${negativeCount}) >= positive signals (${positiveCount})`;

  return { isConfirmed, confidence, reason };
}
