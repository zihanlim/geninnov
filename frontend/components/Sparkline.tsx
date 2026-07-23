interface SparklineProps {
  points: number[]; // 0..1 normalized values, oldest first
  color?: string;
  height?: number;
}

export default function Sparkline({ points, color = "#e11048", height = 36 }: SparklineProps) {
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
