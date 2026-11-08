import { PRIVACY_URL, SUPPORT_MAILTO, TERMS_URL } from '../config/support';

const linkClass = 'underline-offset-2 hover:underline hover:text-[var(--cal-ink)]';

/** Small Privacy · Terms · Support links used on sign-in and Security. */
export function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="Legal and support" className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--cal-muted)] ${className}`}>
      <a className={linkClass} href={PRIVACY_URL}>Privacy</a>
      <span aria-hidden="true">·</span>
      <a className={linkClass} href={TERMS_URL}>Terms</a>
      <span aria-hidden="true">·</span>
      <a className={linkClass} href={SUPPORT_MAILTO}>Support</a>
    </nav>
  );
}
