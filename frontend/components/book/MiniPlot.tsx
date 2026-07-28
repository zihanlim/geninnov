type Segment = {
  label: string;
  value: number;
  color: string;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function SegmentedBar({
  segments,
  total,
  label,
  className = "",
}: {
  segments: Segment[];
  total?: number;
  label: string;
  className?: string;
}) {
  const measuredTotal = segments.reduce(
    (sum, segment) => sum + Math.max(0, segment.value),
    0
  );
  const denominator = Math.max(total ?? measuredTotal, measuredTotal, 1);

  return (
    <div
      role="img"
      aria-label={label}
      className={`flex h-2 overflow-hidden rounded-full bg-bg-elevated ${className}`}
    >
      {segments.map((segment) =>
        segment.value > 0 ? (
          <span
            key={segment.label}
            title={`${segment.label}: ${segment.value}`}
            style={{
              width: `${(segment.value / denominator) * 100}%`,
              background: segment.color,
            }}
          />
        ) : null
      )}
    </div>
  );
}

export function ProgressBar({
  value,
  maximum = 1,
  color,
  label,
  className = "",
}: {
  value: number;
  maximum?: number;
  color: string;
  label: string;
  className?: string;
}) {
  const width = maximum > 0 ? clamp(value / maximum, 0, 1) * 100 : 0;

  return (
    <div
      role="img"
      aria-label={label}
      className={`h-1.5 overflow-hidden rounded-full bg-bg-elevated ${className}`}
    >
      <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
    </div>
  );
}

export function DivergingBar({
  value,
  maximum,
  color,
  label,
  className = "",
}: {
  value: number;
  maximum: number;
  color: string;
  label: string;
  className?: string;
}) {
  const width = maximum > 0 ? clamp(Math.abs(value) / maximum, 0, 1) * 50 : 0;
  const left = value < 0 ? 50 - width : 50;

  return (
    <div
      role="img"
      aria-label={label}
      className={`relative h-1.5 rounded-full bg-bg-elevated ${className}`}
    >
      <span className="absolute inset-y-[-2px] left-1/2 w-px bg-border-strong" />
      <span
        className="absolute inset-y-0 rounded-full"
        style={{ left: `${left}%`, width: `${width}%`, background: color }}
      />
    </div>
  );
}
