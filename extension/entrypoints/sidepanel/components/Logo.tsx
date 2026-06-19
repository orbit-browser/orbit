export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="orbitGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FB8C3A" />
          <stop offset="100%" stopColor="#F2540A" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill="url(#orbitGrad)" />
      <ellipse
        cx="16"
        cy="16"
        rx="13"
        ry="6"
        fill="none"
        stroke="white"
        strokeWidth="1.6"
        opacity="0.9"
        transform="rotate(-30 16 16)"
      />
      <circle cx="16" cy="16" r="3.2" fill="white" />
    </svg>
  );
}
