import { CenteredDialog } from './CenteredDialog';
import { SessionCreateForm } from '../surface/calendar/SessionCreateForm';
import { useSync } from '../contexts/SyncContext';
import type { WorkoutData } from '../types';

export function NewSessionDialog({
  date,
  athleteId,
  allowDateEdit = false,
  onClose,
  onCreated,
}: {
  date: string;
  athleteId?: string | null;
  allowDateEdit?: boolean;
  onClose: () => void;
  onCreated: (workout: WorkoutData & { microcycleId?: string }) => void | Promise<void>;
}) {
  const { isOnline } = useSync();
  return (
    <CenteredDialog
      title={`New session${allowDateEdit ? '' : ` · ${date}`}`}
      onClose={onClose}
      testId="new-session-dialog"
    >
      <SessionCreateForm
        date={date}
        athleteId={athleteId}
        allowDateEdit={allowDateEdit}
        online={isOnline}
        onClose={onClose}
        onCreated={onCreated}
      />
    </CenteredDialog>
  );
}
