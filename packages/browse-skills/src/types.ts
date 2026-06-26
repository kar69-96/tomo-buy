export interface AmazonSearchProduct {
  readonly asin: string;
  readonly title: string;
  readonly price: string;
  readonly currency: string;
  readonly url: string;
  readonly rating?: number;
  readonly review_count?: number;
}

export interface AmazonSearchResponse {
  readonly query: string;
  readonly products: readonly AmazonSearchProduct[];
  readonly source: "browse_sh";
}

export interface AmazonStorefrontPrice {
  readonly storefront: string;
  readonly price: string;
  readonly currency: string;
  readonly url: string;
  readonly available: boolean;
}

export interface AmazonGlobalPricesResponse {
  readonly asin: string;
  readonly prices: readonly AmazonStorefrontPrice[];
  readonly source: "browse_sh";
}

export interface EbaySearchProduct {
  readonly item_id: string;
  readonly title: string;
  readonly price: string;
  readonly currency: string;
  readonly url: string;
  readonly condition?: string;
  readonly seller_rating?: number;
}

export interface EbaySearchResponse {
  readonly query: string;
  readonly products: readonly EbaySearchProduct[];
  readonly source: "browse_sh";
}

export interface BrowseSearchResult {
  readonly title: string;
  readonly price: string;
  readonly currency: string;
  readonly url: string;
  readonly source: "amazon" | "ebay";
  readonly asin?: string;
  readonly item_id?: string;
  readonly rating?: number;
}

export interface BrowseSearchResponse {
  readonly query: string;
  readonly results: readonly BrowseSearchResult[];
  readonly source_breakdown: {
    readonly amazon: number;
    readonly ebay: number;
  };
}

export interface BrowseComparePricesResponse {
  readonly query: string;
  readonly asin?: string;
  readonly comparisons: readonly AmazonStorefrontPrice[];
}
