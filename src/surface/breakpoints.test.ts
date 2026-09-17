import { describe, expect, it } from 'vitest';
import { BP_WEEK_STRIP, calendarLayout, inspectorOverlays, snapInspectorWidth } from './breakpoints';

describe('surface breakpoints', () => {
  it('switches to week-strip below 720', () => {
    expect(calendarLayout(BP_WEEK_STRIP)).toBe('month');
    expect(calendarLayout(BP_WEEK_STRIP - 1)).toBe('week-strip');
  });

  it('overlays the inspector below 960', () => {
    expect(inspectorOverlays(959)).toBe(true);
    expect(inspectorOverlays(960)).toBe(false);
  });

  it('snaps inspector width to 360 or 560', () => {
    expect(snapInspectorWidth(400)).toBe(360);
    expect(snapInspectorWidth(500)).toBe(560);
  });
});
