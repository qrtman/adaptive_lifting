import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = dialogRef.current?.querySelector<HTMLElement>('[autofocus], [role="combobox"]')
      ?? dialogRef.current?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    target?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable: HTMLElement[] = Array.from(dialogRef.current.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) as NodeListOf<HTMLElement>).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
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
        ref={dialogRef}
        onKeyDown={handleDialogKeyDown}
        initial={false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
        className="relative z-10 flex max-h-[calc(100dvh-1rem)] w-full max-w-lg flex-col overflow-hidden bg-[var(--cal-surface-elevated)] border border-[var(--cal-hairline)] rounded-[var(--cal-radius-lg)] p-3 sm:max-h-[85dvh] sm:p-[var(--cal-space-md)] cal-card-outer"
      >
        <div className="mb-3 flex shrink-0 items-start justify-between gap-3">
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
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
            <div className="mt-4 flex shrink-0 items-center justify-end gap-2 border-t border-[var(--cal-hairline)] pt-3">
              {footer}
            </div>
          </form>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
            <div className="mt-4 flex shrink-0 items-center justify-end gap-2 border-t border-[var(--cal-hairline)] pt-3">
              {footer}
            </div>
          </>
        )}
      </motion.div>
    </div>
    ),
    document.body,
  );
}
