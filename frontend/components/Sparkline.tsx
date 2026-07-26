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
      {/* vector-effect pairs with preserveAspectRatio="none" above. That
          attribute stretches a 100-unit viewBox to whatever width the card is,
          which scales the STROKE with it — so the same 1.5px line renders
          thicker on a wide card than a narrow one, and thickness reads as
          emphasis the data does not carry. non-scaling-stroke keeps the width
          in screen pixels while the geometry stretches.

          aria-hidden because this is decoration: every value it plots is also
          rendered as a figure in the card around it, so announcing an unlabelled
          polyline adds noise to a screen reader without adding a fact. */}
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        points={poly}
        aria-hidden="true"
      />
    </svg>
  );
}
