/** Keep in sync with design/tokens.md and src/index.css @theme. */
export const BP_WEEK_STRIP = 720;
export const BP_INSPECTOR_OVERLAY = 960;
export const INSPECTOR_SNAP_A = 360;
export const INSPECTOR_SNAP_B = 560;
export const CHIPS_VISIBLE = 3;

export type CalendarLayout = 'month' | 'week-strip';

export function calendarLayout(width: number): CalendarLayout {
  return width < BP_WEEK_STRIP ? 'week-strip' : 'month';
}

export function inspectorOverlays(width: number): boolean {
  return width < BP_INSPECTOR_OVERLAY;
}

export function snapInspectorWidth(width: number): number {
  return Math.abs(width - INSPECTOR_SNAP_B) < Math.abs(width - INSPECTOR_SNAP_A)
    ? INSPECTOR_SNAP_B
    : INSPECTOR_SNAP_A;
}
