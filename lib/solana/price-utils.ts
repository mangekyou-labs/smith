const COINGECKO_API = "https://api.coingecko.com/api/v3";

// Cache: tokenId -> { price: number; updatedAt: number }
const priceCache: Record<
  string,
  { price: number; updatedAt: number }
> = {};
const CACHE_TTL_MS = 60_000;

// SPL USDC on devnet is a mock token — use a fixed price for display
const DEVNET_USDC_PRICE = 1.0;

export function formatTokenAmount(
  amount: number | string,
  decimals: number
): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (Number.isNaN(n)) return "—";
  const divisor = Math.pow(10, decimals);
  const whole = Math.floor(n / divisor);
  const fraction = n % divisor;
  const fractionStr = fraction.toString().padStart(decimals, "0").slice(0, decimals);
  // Trim trailing zeros
  const trimmedFraction = fractionStr.replace(/0+$/, "");
  return trimmedFraction
    ? `${whole.toLocaleString()}.${trimmedFraction}`
    : whole.toLocaleString();
}

export function formatUSD(
  amount: number | string,
  decimals: number,
  price: number
): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (Number.isNaN(n)) return "—";
  const divisor = Math.pow(10, decimals);
  const usdValue = (n / divisor) * price;
  return usdValue.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatUSDCompact(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toFixed(2)}`;
}

export async function getSPLPrice(
  tokenId: string = "usd-coin",
  cluster: string = "devnet"
): Promise<number> {
  if (cluster === "devnet") {
    return DEVNET_USDC_PRICE;
  }

  const now = Date.now();
  const cached = priceCache[tokenId];
  if (cached && now - cached.updatedAt < CACHE_TTL_MS) {
    return cached.price;
  }

  try {
    const url = `${COINGECKO_API}/simple/price?ids=${tokenId}&vs_currencies=usd`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Coingecko error: ${res.status}`);
    const data = (await res.json()) as Record<string, { usd: number }>;
    const price = data[tokenId]?.usd ?? 1.0;
    priceCache[tokenId] = { price, updatedAt: now };
    return price;
  } catch {
    // Fallback to cached or 1.0
    return cached?.price ?? 1.0;
  }
}

export function computePayout(
  betAmount: string, // bigint string
  yesPool: string,
  noPool: string,
  winningOutcome: 1 | 2 // YES=1, NO=2
): string {
  const bet = BigInt(betAmount);
  const yes = BigInt(yesPool);
  const no = BigInt(noPool);
  const total = yes + no;
  if (total === BigInt(0)) return bet.toString();
  if (winningOutcome === 1) {
    // YES wins: payout = bet * total / yes
    return ((bet * total) / yes).toString();
  } else {
    // NO wins: payout = bet * total / no
    return ((bet * total) / no).toString();
  }
}
