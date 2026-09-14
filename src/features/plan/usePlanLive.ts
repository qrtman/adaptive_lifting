import { useEffect, useRef } from 'react';

const BACKEND_URL = (import.meta as ImportMeta & { env: { VITE_BACKEND_URL?: string } }).env.VITE_BACKEND_URL
  || 'http://localhost:8000';

function workoutIdFromEvent(event: MessageEvent, fallback: string): string {
  try {
    const payload = JSON.parse(String(event.data || '{}')) as { workout_id?: string };
    if (payload.workout_id) return payload.workout_id;
  } catch {
    /* heartbeat / empty */
  }
  return fallback;
}

export function usePlanLive(
  athleteId: string | null | undefined,
  sessionId: string | null | undefined,
  onSynced: (workoutId: string) => void,
) {
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  useEffect(() => {
    const sources: EventSource[] = [];
    const listen = (url: string, fallbackId: string) => {
      const source = new EventSource(url, { withCredentials: true });
      const onEvt = (event: MessageEvent) => {
        if (!event.data) return;
        const workoutId = workoutIdFromEvent(event, fallbackId);
        if (workoutId) onSyncedRef.current(workoutId);
      };
      source.addEventListener('WORKOUT_SYNCED', onEvt as EventListener);
      source.onmessage = onEvt;
      sources.push(source);
    };

    if (athleteId) {
      listen(`${BACKEND_URL}/api/athletes/${athleteId}/live`, sessionId || '');
    } else if (sessionId) {
      listen(`${BACKEND_URL}/api/workouts/${sessionId}/live`, sessionId);
    }

    const onVis = () => {
      if (document.visibilityState === 'visible' && (athleteId || sessionId)) {
        onSyncedRef.current(sessionId || '');
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      sources.forEach((source) => source.close());
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [athleteId, sessionId]);
}
