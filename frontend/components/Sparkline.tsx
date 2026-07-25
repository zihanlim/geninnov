interface SparklineProps {
  points: number[]; // 0..1 normalized values, oldest first
  color?: string;
  height?: number;
}

// The default read "#e11048" — the PRE-AA accent, two palette moves stale
// (#e11048 → #d40e43 → #c50c3e), so every sparkline that did not pass an explicit
// colour drew in a crimson nothing else on the page used. `stroke` resolves var()
// like any other paint, so read the token instead of copying it. This is the exact
// drift ConvictionCard's comment warned about, in a second file.
export default function Sparkline({ points, color = "var(--accent)", height = 36 }: SparklineProps) {
  if (!points.length) return null;
  const width = 100;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = width / Math.max(points.length - 1, 1);
  const poly = points
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      className="block w-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ height }}
    >
      <polyline fill="none" stroke={color} strokeWidth={1.5} points={poly} />
    </svg>
  );
}
