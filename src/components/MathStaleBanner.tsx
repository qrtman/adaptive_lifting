export function MathStaleBanner({
  server,
  client,
  onDismiss,
}: {
  server: string;
  client: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      data-testid="math-stale-banner"
      className="border border-border bg-card px-3 py-2 text-caption text-fg"
    >
      <p className="text-fg-strong">Stale math</p>
      <p className="text-fg-muted">
        Server {server} does not match this app ({client}). Preview numbers may be wrong until you update.
      </p>
      <button
        type="button"
        className="mt-1 text-mini text-accent"
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}
