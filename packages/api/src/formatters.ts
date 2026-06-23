import type { Order, Receipt, QueryResponse, SearchQueryResponse } from "@bloon/core";

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

export function formatQueryResponse(result: QueryResponse) {
  return {
    product: {
      ...result.product,
      source: getHostname(result.product.url),
    },
    options: result.options,
    required_fields: result.required_fields,
    discovery_method: result.discovery_method,
  };
}

export function formatSearchQueryResponse(result: SearchQueryResponse) {
  return {
    type: result.type,
    query: result.query,
    products: result.products.map((p) => ({
      product: {
        ...p.product,
        source: getHostname(p.product.url),
      },
      options: p.options,
      required_fields: p.required_fields,
      discovery_method: p.discovery_method,
      relevance_score: p.relevance_score,
    })),
    search_metadata: result.search_metadata,
  };
}

export function formatBuyResponse(order: Order) {
  const expiresIn = Math.max(
    0,
    Math.floor((new Date(order.expires_at).getTime() - Date.now()) / 1000),
  );

  return {
    order_id: order.order_id,
    product: {
      name: order.product.name,
      url: order.product.url,
      source: getHostname(order.product.url),
    },
    payment: {
      item_price: order.payment.price,
      fee: order.payment.fee,
      fee_rate: order.payment.fee_rate,
      total: order.payment.total,
      discovery_method: order.product.source,
    },
    status: order.status,
    expires_in: expiresIn,
  };
}

export function formatConfirmResponse(order: Order, receipt: Receipt) {
  return {
    order_id: order.order_id,
    status: "completed" as const,
    receipt,
  };
}

export function formatConfirmFailedResponse(order: Order) {
  return {
    order_id: order.order_id,
    status: "failed" as const,
    error: order.error,
  };
}
