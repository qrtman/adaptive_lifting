import { describe, expect, it, vi } from 'vitest';
import { MATH_VERSION } from './mathEngine';
import { warnIfMathVersionMismatch } from './mathVersion';

describe('math version mismatch', () => {
  it('returns false when versions match', () => {
    expect(warnIfMathVersionMismatch(MATH_VERSION, 'test')).toBe(false);
  });

  it('warns in development and dispatches a stale event', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dispatch = vi.fn();
    vi.stubGlobal('window', { dispatchEvent: dispatch });
    expect(warnIfMathVersionMismatch('other-v1', 'sync')).toBe(true);
    expect(dispatch).toHaveBeenCalled();
    const event = dispatch.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('math-version-stale');
    expect(event.detail.server).toBe('other-v1');
    warn.mockRestore();
    vi.unstubAllGlobals();
  });
});
