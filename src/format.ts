export function formatMoney(amount: number): string {
  if (amount === 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) return "0%";
  return `${((numerator / denominator) * 100).toFixed(0)}%`;
}

/** A plain ASCII bar of `width` characters scaled to `value / max`. */
export function asciiBar(value: number, max: number, width = 30): string {
  if (max <= 0) return "";
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return "#".repeat(filled) + "-".repeat(width - filled);
}
