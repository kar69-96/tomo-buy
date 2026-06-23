# User Flow — Bloon v1

## Personas

1. **Agent Owner** — Configures credit card credentials and shipping info, tells agent to buy things.
2. **AI Agent** — Any LLM agent or script that can make HTTP requests.

---

## Flow 1: Product Discovery (Recommended First Step)

```
Agent:
  POST /api/query { "url": "https://allbirds.com/products/mens-tree-runners" }

Server runs 4-tier discovery: Firecrawl --> Exa.ai --> scrape --> Browserbase

Returns:
  product: { name: "Men's Tree Runners", price: "98.00", brand: "Allbirds" }
  options: [{ name: "Color", values: ["Charcoal", "Navy"] }, { name: "Size", values: ["8", "9", "10"] }]
  required_fields: [shipping.name, shipping.email, ..., selections]
  discovery_method: "firecrawl"

Agent now knows what fields to include in the buy request.
```

---

## Flow 2: Purchase via URL (with query first)

```
Agent:
  POST /api/buy {
    "url": "https://allbirds.com/products/mens-tree-runners",
    "shipping": { "name": "Karthik", "street": "123 Main St", ... },
    "selections": { "Color": "Charcoal", "Size": "10" }
  }

Returns: order_id, product (Men's Tree Runners, $98.00), payment ($99.96, 2% fee)

Agent decides to proceed:
  POST /api/confirm { "order_id": "bloon_ord_9x2k4m" }

Server: launches 12-step browser checkout, fills forms with credit card via CDP, submits order

Returns: receipt { order_number: "112-456...", estimated_delivery: "Feb 21" }
```

---

## Flow 3: Purchase via URL (shipping NOT provided)

```
Agent:
  POST /api/buy {
    "url": "https://target.com/p/bluetooth-speaker/..."
  }

Returns:
  { "error": { "code": "SHIPPING_REQUIRED", "message": "..." } }

Agent asks human for address, then re-calls POST /api/buy with shipping included.
```

---

## Key UX Principles

1. **No auth (v1).** Any agent makes HTTP requests. API key auth planned for v1.5.
2. **Query first, then buy.** query discovers product info and tells the agent exactly what fields to include.
3. **Agent always asks before spending.** buy returns a quote. confirm executes. Two steps.
4. **Shipping collected when needed.** Physical products without an address get SHIPPING_REQUIRED.
5. **Domain caching for speed.** Repeat purchases from the same merchant skip cookie banners.
6. **Credit card via CDP.** Card credentials are filled via Playwright CDP, never exposed to the LLM.
