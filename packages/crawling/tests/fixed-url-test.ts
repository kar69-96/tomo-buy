import { discoverViaFirecrawlWithDiagnostics } from "../src/discover.js";

process.env.FIRECRAWL_API_KEY ??= "fc-selfhosted";
process.env.FIRECRAWL_BASE_URL ??= "http://localhost:3000";

const urls = [
  { url: "https://www.gymshark.com/products/gymshark-running-elite-race-vest-sleeveless-tops-black-ss25", label: "Gymshark" },
  { url: "https://www.chubbiesshorts.com/products/the-shadowstorms-5-5-originals", label: "Chubbies" },
  { url: "https://www.mvmt.com/new-arrivals-4/napa-red/28000548.html", label: "MVMT" },
  { url: "https://www.zara.com/us/en/rustic-cotton-t-shirt-p04424306.html?v1=504236252", label: "Zara" },
  { url: "https://www.adidas.com/us/samba-jane-shoes/JR1402.html", label: "Adidas" },
  { url: "https://www.nordstrom.com/s/air-force-1-07-basketball-sneaker-men/4680267", label: "Nordstrom" },
  { url: "https://www.gap.com/browse/product.do?pid=706174002", label: "Gap" },
  { url: "https://www.primalkitchen.com/products/classic-unsweetened-organic-bbq-sauce", label: "Primal Kitchen" },
  { url: "https://bookshop.org/p/books/atomic-habits-an-easy-proven-way-to-build-good-habits-break-bad-ones-james-clear/072529306f5772fe", label: "Bookshop" },
  { url: "https://www.iherb.com/pr/nature-s-way-alive-men-s-ultra-multivitamin-60-tablets/37794", label: "iHerb" },
];

async function runOne(entry: { url: string; label: string }) {
  const start = Date.now();
  try {
    const { result, diagnostics } = await discoverViaFirecrawlWithDiagnostics(entry.url);
    const ms = ((Date.now() - start) / 1000).toFixed(1);
    if (!result || result.error) {
      console.log(`FAIL  ${ms}s  ${entry.label.padEnd(16)} code=${diagnostics.failureCode} stage=${diagnostics.failureStage} detail=${diagnostics.failureDetail?.slice(0, 80)}`);
    } else {
      console.log(`OK    ${ms}s  ${entry.label.padEnd(16)} "${result.name.slice(0, 45)}" $${result.price} method=${result.method}`);
    }
  } catch (e: unknown) {
    console.log(`ERR   ${((Date.now() - start) / 1000).toFixed(1)}s  ${entry.label}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main() {
  const queue = [...urls];
  async function worker() {
    while (queue.length) {
      const entry = queue.shift()!;
      await runOne(entry);
    }
  }
  await Promise.all([worker(), worker()]);
  console.log("\nDone.");
}
main();
