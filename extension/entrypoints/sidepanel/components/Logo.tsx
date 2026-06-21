export function Logo({ size = 24 }: { size?: number }) {
  return (
    <img
      src="/orbit_icon.png"
      width={size}
      height={size}
      alt="Orbit"
      aria-hidden="true"
      style={{ objectFit: 'contain' }}
    />
  );
}
