import { useEffect, type ReactNode } from 'react';
import { motion } from 'motion/react';

export function NestedCard({
  children,
  className = '',
  elevated = false,
  testId,
}: {
  children: ReactNode;
  className?: string;
  elevated?: boolean;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      data-elevated={elevated ? 'true' : undefined}
      className={`cal-nested-card ${className}`}
    >
      {children}
    </div>
  );
}

export function CenteredDialog({
  title,
  subtitle,
  onClose,
  onSubmit,
  children,
  footer,
  testId,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSubmit?: () => void;
  children: ReactNode;
  footer: ReactNode;
  testId?: string;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="centered-dialog-title"
        data-testid={testId}
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
        className="relative z-10 w-full max-w-lg max-h-[85dvh] overflow-y-auto bg-[var(--cal-surface-elevated)] border border-[var(--cal-hairline)] rounded-[var(--cal-radius-lg)] p-[var(--cal-space-md)] cal-card-outer cal-elevate-in"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 id="centered-dialog-title" className="text-sm font-medium text-[var(--cal-ink)]">
              {title}
            </h2>
            {subtitle ? <p className="text-xs text-[var(--cal-muted)] mt-1">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            data-testid="dialog-close"
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-[var(--cal-radius-md)] text-[var(--cal-muted)] hover:text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)]"
          >
            ×
          </button>
        </div>
        {onSubmit ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            {children}
            <div className="mt-4 flex items-center justify-end gap-2">
              {footer}
            </div>
          </form>
        ) : (
          <>
            {children}
            <div className="mt-4 flex items-center justify-end gap-2">
              {footer}
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
