// Single-tone player avatar — a muted circle with the first initial.
// Shared between Open Play and History so the look stays consistent.

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?';
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-muted font-semibold text-foreground"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {initial(name)}
    </span>
  );
}
