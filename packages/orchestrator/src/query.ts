import {
  type QueryResponse,
  type RichProductInfo,
  type RequiredField,
  type ProductOption,
  BloonError,
  ErrorCodes,
} from "@bloon/core";
import { classifyUrl, discoverWithStrategy } from "@bloon/crawling";

export interface QueryInput {
  url: string;
}

// ---- Standard shipping fields ----

export const STANDARD_SHIPPING_FIELDS: readonly RequiredField[] = [
  { field: "shipping.name", label: "Full name" },
  { field: "shipping.email", label: "Email address" },
  { field: "shipping.phone", label: "Phone number" },
  { field: "shipping.street", label: "Street address" },
  { field: "shipping.apartment", label: "Apartment / Floor / Suite" },
  { field: "shipping.city", label: "City" },
  { field: "shipping.state", label: "State / Province" },
  { field: "shipping.zip", label: "ZIP / Postal code" },
  { field: "shipping.country", label: "Country" },
];

// ---- Required fields builder (shared with search-query) ----

export function buildRequiredFields(options: readonly ProductOption[]): RequiredField[] {
  const fields = [...STANDARD_SHIPPING_FIELDS];
  if (options.length > 0) {
    const optionNames = options.map((o) => o.name).join(", ");
    fields.push({ field: "selections", label: `Product options (${optionNames})` });
  }
  return fields;
}

export async function query(input: QueryInput): Promise<QueryResponse> {
  const { url } = input;

  // 1. Validate URL
  try {
    new URL(url);
  } catch {
    throw new BloonError(ErrorCodes.INVALID_URL, `Invalid URL: ${url}`);
  }

  // 2. Discover product info (strategy-aware routing)
  const strategy = classifyUrl(url);
  let discovery;
  try {
    discovery = await discoverWithStrategy(url, strategy);
  } catch (e) {
    if (e instanceof BloonError) throw e;
    throw new BloonError(
      ErrorCodes.QUERY_FAILED,
      `Product discovery failed for ${url}: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }

  if (!discovery) {
    throw new BloonError(
      ErrorCodes.QUERY_FAILED,
      `Product discovery failed for ${url}: no structured data found`,
    );
  }

  // 3. Build required fields
  const requiredFields = buildRequiredFields(discovery.options);

  const product: RichProductInfo = {
    name: discovery.name,
    url,
    price: discovery.price,
    image_url: discovery.image_url,
    original_price: discovery.original_price,
    currency: discovery.currency,
    brand: discovery.brand,
  };

  return {
    product,
    options: discovery.options,
    required_fields: requiredFields,
    discovery_method: discovery.method,
  };
}
