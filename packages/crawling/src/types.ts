export interface FirecrawlExtract {
  name?: string;
  price?: string;
  original_price?: string;
  currency?: string;
  description?: string;
  brand?: string;
  image_url?: string;
  options?: Array<{
    name: string;
    values: string[];
    prices?: Record<string, string>;
  }>;
  variant_urls?: string[];
}

export interface FirecrawlConfig {
  baseUrl: string;
  apiKey: string;
}
