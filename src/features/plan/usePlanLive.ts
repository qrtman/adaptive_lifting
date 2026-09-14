import { useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getUiPref, UI_KEYS } from '../../storage/uiPrefs';

const BACKEND_URL = (import.meta as ImportMeta & { env: { VITE_BACKEND_URL?: string } }).env.VITE_BACKEND_URL
  || 'http://localhost:8000';

function parsePayload(event: MessageEvent): { workout_id?: string; actor_user_id?: string } {
  try {
    return JSON.parse(String(event.data || '{}')) as { workout_id?: string; actor_user_id?: string };
  } catch {
    return {};
  }
}

export function usePlanLive(
  athleteId: string | null | undefined,
  sessionId: string | null | undefined,
  onSynced: (workoutId: string) => void,
) {
  const { user } = useAuth();
  const selfId = String(user?.id || getUiPref(UI_KEYS.userId) || '');
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;
  const selfIdRef = useRef(selfId);
  selfIdRef.current = selfId;

  useEffect(() => {
    const sources: EventSource[] = [];
    let debounce: number | null = null;
    const listen = (url: string, fallbackId: string) => {
      const source = new EventSource(url, { withCredentials: true });
      const onEvt = (event: MessageEvent) => {
        if (!event.data) return;
        const payload = parsePayload(event);
        if (selfIdRef.current && payload.actor_user_id && payload.actor_user_id === selfIdRef.current) {
          return;
        }
        const workoutId = payload.workout_id || fallbackId;
        if (!workoutId) return;
        if (debounce) window.clearTimeout(debounce);
        debounce = window.setTimeout(() => onSyncedRef.current(workoutId), 200);
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
      if (debounce) window.clearTimeout(debounce);
      sources.forEach((source) => source.close());
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [athleteId, sessionId]);
}
