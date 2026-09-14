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
      className="border border-white/10 bg-[#161616] px-3 py-2 text-xs text-[#E0E0E0]"
    >
      <p className="text-white">Stale math</p>
      <p className="text-[#AEAEB2]">
        Server {server} does not match this app ({client}). Preview numbers may be wrong until you update.
      </p>
      <button
        type="button"
        className="mt-1 text-[11px] text-[#007AFF]"
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}
