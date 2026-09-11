import { useEffect, type ReactNode } from 'react';

export function CenteredDialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
  testId,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
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
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="centered-dialog-title"
        data-testid={testId}
        className="relative z-10 w-full max-w-lg max-h-[85dvh] overflow-y-auto bg-[#131313] border border-white/10 rounded-lg p-4"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 id="centered-dialog-title" className="text-sm text-white">
              {title}
            </h2>
            {subtitle ? <p className="text-xs text-[#AEAEB2] mt-1">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            data-testid="dialog-close"
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center text-[#AEAEB2] hover:text-white"
          >
            ×
          </button>
        </div>
        {children}
        <div className="mt-4 flex items-center justify-end gap-2">
          {footer}
        </div>
      </div>
    </div>
  );
}
