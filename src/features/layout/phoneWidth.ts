import { useEffect, useState } from 'react';

/** Phone layout breakpoint (`.cursor/scopes/phone/PLAN.md`): below 768px the app uses its phone shell. */
export const PHONE_WIDTH_QUERY = '(max-width: 767px)';

export function isPhoneWidth(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(PHONE_WIDTH_QUERY).matches;
}

/** Live phone-width flag: follows rotation and window resizes. */
export function usePhoneWidth(): boolean {
  const [phone, setPhone] = useState(isPhoneWidth);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(PHONE_WIDTH_QUERY);
    const onChange = () => setPhone(query.matches);
    onChange();
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return phone;
}
