/**
 * SpendSparkline — minimal SVG sparkline for daily LLM token totals.
 *
 * No chart library; saves ~50KB+ on the bundle. Renders a normalized
 * line + filled area + axis-end labels. Server component (consumed
 * by SpendSection); receives the daily series + which metric to plot.
 */

type Point = {
  day: string;
  promptTokens: number;
  completionTokens: number;
  costUsdMicro: number;
  callCount: number;
};

type Props = {
  series: Point[];
  metric: "tokens" | "cost" | "calls";
  /** Inline width control; defaults to 100% so the parent grid wins. */
  height?: number;
};

const W = 600; // virtual viewBox width — scales via preserveAspectRatio
const H = 80;
const PAD_X = 8;
const PAD_Y = 6;

function valueAt(point: Point, metric: Props["metric"]): number {
  if (metric === "tokens") {
    return point.promptTokens + point.completionTokens;
  }
  if (metric === "cost") return point.costUsdMicro;
  return point.callCount;
}

function formatLabel(metric: Props["metric"], value: number): string {
  if (metric === "cost") {
    if (value === 0) return "$0";
    const usd = value / 1_000_000;
    return usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`;
  }
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function SpendSparkline({ series, metric, height = 80 }: Props) {
  if (series.length === 0) return null;

  const values = series.map((p) => valueAt(p, metric));
  const max = Math.max(...values, 1);
  const min = 0; // anchor area to zero

  const stepX = (W - PAD_X * 2) / Math.max(1, series.length - 1);

  // Build a polyline path + area path.
  let path = "";
  let area = `M${PAD_X},${H - PAD_Y}`;
  for (let i = 0; i < series.length; i++) {
    const x = PAD_X + i * stepX;
    const norm = (values[i]! - min) / (max - min);
    const y = H - PAD_Y - norm * (H - PAD_Y * 2);
    path += i === 0 ? `M${x},${y}` : ` L${x},${y}`;
    area += ` L${x},${y}`;
  }
  area += ` L${PAD_X + (series.length - 1) * stepX},${H - PAD_Y} Z`;

  const lastValue = values[values.length - 1] ?? 0;
  const peakValue = max;
  const peakIdx = values.indexOf(peakValue);
  const peakDay = series[peakIdx]?.day ?? "";

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${metric} trend over ${series.length} days`}
      >
        <path
          d={area}
          fill="color-mix(in srgb, var(--lb-accent) 12%, transparent)"
        />
        <path
          d={path}
          fill="none"
          stroke="var(--lb-accent)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "var(--lb-fs-xs)",
          color: "var(--lb-muted-fg)",
        }}
      >
        <span>
          {series[0]?.day} → {series[series.length - 1]?.day}
        </span>
        <span>
          peak {formatLabel(metric, peakValue)}
          {peakDay && ` (${peakDay.slice(5)})`}
        </span>
        <span>
          today {formatLabel(metric, lastValue)}
        </span>
      </div>
    </div>
  );
}
