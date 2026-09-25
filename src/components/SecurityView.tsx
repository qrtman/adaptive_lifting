import React, { useState, useEffect } from 'react';
import { 
  Shield, Laptop, KeyRound, History, AlertTriangle, 
  ChevronDown, ChevronUp, RefreshCw, FileJson, CheckCircle2
} from 'lucide-react';
import { CoachLinkPanel } from './CoachLinkPanel';
import { AthleteProfilePanel } from './AthleteProfilePanel';
import { API_BASE_URL } from '../services/apiBase';

interface ClientDevice {
  id: string;
  device_label: string;
  last_seen_at: string;
  revoked_at: string | null;
}

interface UserSession {
  id: string;
  expires_at: string;
  revoked_at: string | null;
}

interface AuditEvent {
  id: string;
  actor_email: string;
  event_type: string;
  resource_type: string;
  resource_id: string;
  created_at: string;
  metadata_json: string;
}

export const SecurityView: React.FC = () => {
  const [devices, setDevices] = useState<ClientDevice[]>([]);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [successAlert, setSuccessAlert] = useState<string | null>(null);

  const fetchSecurityData = async (silent = false) => {
    if (!silent) setLoading(true);
    setErrorMsg(null);
    try {
      // 1. Fetch devices
      const resDev = await fetch(`${API_BASE_URL}/api/security/devices`, { credentials: 'include' });
      if (!resDev.ok) throw new Error("Failed to load client devices");
      const devData = await resDev.json();
      setDevices(devData);

      // 2. Fetch sessions
      const resSess = await fetch(`${API_BASE_URL}/api/security/sessions`, { credentials: 'include' });
      if (!resSess.ok) throw new Error("Failed to load active login sessions");
      const sessData = await resSess.json();
      setSessions(sessData);

      // 3. Fetch audit events
      const resAudit = await fetch(`${API_BASE_URL}/api/security/audit-events`, { credentials: 'include' });
      if (resAudit.status === 401) {
        // Session invalid, redirect
        window.dispatchEvent(new CustomEvent('auth-session-revoked'));
        return;
      }
      if (!resAudit.ok) throw new Error("Failed to load chronological audit trail");
      const auditData = await resAudit.json();
      setAuditEvents(auditData);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || "Failed to load secure database statistics.");
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeDevice = async (id: string) => {
    if (!window.confirm("Are you sure you want to revoke this device? Unsynced offline data on that device may be blocked.")) {
      return;
    }
    setRevokingId(id);
    try {
      const res = await fetch(`${API_BASE_URL}/api/security/devices/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        showSuccess("Device access successfully revoked.");
        fetchSecurityData(true);
      } else {
        throw new Error("Server rejected device revocation request");
      }
    } catch (e: any) {
      alert(`Revocation failed: ${e.message}`);
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeSession = async (id: string) => {
    if (!window.confirm("Are you sure you want to terminate this browser login? This session will instantly become invalid.")) {
      return;
    }
    setRevokingId(id);
    try {
      const res = await fetch(`${API_BASE_URL}/api/security/sessions/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (res.ok) {
        showSuccess("Browser session terminated.");
        fetchSecurityData(true);
      } else {
        throw new Error("Server rejected session revocation request");
      }
    } catch (e: any) {
      alert(`Revocation failed: ${e.message}`);
    } finally {
      setRevokingId(null);
    }
  };

  const showSuccess = (msg: string) => {
    setSuccessAlert(msg);
    setTimeout(() => setSuccessAlert(null), 4000);
  };

  useEffect(() => {
    fetchSecurityData();
  }, []);

  const formatTimestamp = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString();
    } catch {
      return isoString;
    }
  };

  return (
    <div className="flex-1 w-full bg-[var(--cal-canvas)] text-[var(--cal-ink)] p-[var(--cal-space-md)] overflow-y-auto pb-32">
      <div className="mb-6 mt-2 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-3">
            <Shield size={22} className="text-[var(--cal-accent)]" />
            Security
          </h1>
          <p className="text-[var(--cal-muted)] text-sm mt-1">
            Coach link, devices, browser sessions, and audit events.
          </p>
        </div>
        <button
          onClick={() => fetchSecurityData()}
          disabled={loading}
          className="h-10 w-10 rounded-[var(--cal-radius-md)] bg-[var(--cal-surface-soft)] border border-[var(--cal-hairline)] hover:bg-[var(--cal-surface-card)] flex items-center justify-center cursor-pointer disabled:opacity-50"
          title="Refresh Audit Logs"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin text-[var(--cal-accent)]' : 'text-[var(--cal-muted)]'} />
        </button>
      </div>

      <CoachLinkPanel />
      <AthleteProfilePanel />

      {successAlert && (
        <div className="mb-4 bg-[color-mix(in_srgb,var(--cal-success)_10%,transparent)] border border-[color-mix(in_srgb,var(--cal-success)_20%,transparent)] p-3 rounded-[var(--cal-radius-lg)] flex items-center gap-3">
          <CheckCircle2 size={18} className="text-[var(--cal-success)] shrink-0" />
          <span className="text-sm font-medium text-[var(--cal-success)]">{successAlert}</span>
        </div>
      )}

      {errorMsg && (
        <div className="mb-4 bg-[color-mix(in_srgb,var(--cal-error)_10%,transparent)] border border-[color-mix(in_srgb,var(--cal-error)_20%,transparent)] p-3 rounded-[var(--cal-radius-lg)] flex items-start gap-3">
          <AlertTriangle size={18} className="text-[var(--cal-error)] shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-[var(--cal-error)] font-medium">{errorMsg}</p>
            <button onClick={() => fetchSecurityData()} className="text-xs text-[var(--cal-error)] underline mt-1 cursor-pointer">
              Retry Load
            </button>
          </div>
        </div>
      )}

      {loading && devices.length === 0 ? (
        <div className="flex flex-col justify-center items-center py-20 text-[var(--cal-muted)] gap-3">
          <RefreshCw size={24} className="animate-spin text-[var(--cal-accent)]" />
          <p className="text-xs font-medium tracking-wider uppercase">Loading security…</p>
        </div>
      ) : (
        <div className="flex flex-col gap-[var(--cal-space-sm)]">
          <div className="cal-nested-card">
            <p className="text-xs text-[var(--cal-muted)] leading-relaxed">
              Sessions use HTTP-only cookies. Revoking a device or browser token invalidates later sync mutations.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-[var(--cal-space-sm)]">
            <section className="cal-nested-card flex flex-col gap-[var(--cal-space-xs)]">
              <h2 className="text-[10px] uppercase font-medium text-[var(--cal-muted)] tracking-wider flex items-center gap-2">
                <Laptop size={14} className="text-[var(--cal-accent)]" />
                Devices
              </h2>

              <div className="flex flex-col gap-[var(--cal-space-xs)]">
                {devices.map(d => (
                  <div key={d.id} className="cal-nested-card p-[var(--cal-space-xs)] flex items-center justify-between gap-4">
                    <div>
                      <h3 className="font-medium text-sm text-[var(--cal-ink)]">{d.device_label}</h3>
                      <p className="text-[10px] text-[var(--cal-muted)] mt-1 tnum">
                        ID: {d.id} | Last Seen: {formatTimestamp(d.last_seen_at)}
                      </p>
                      {d.revoked_at ? (
                        <span className="mt-2 inline-block px-2 py-0.5 bg-[color-mix(in_srgb,var(--cal-error)_10%,transparent)] text-[var(--cal-error)] border border-[color-mix(in_srgb,var(--cal-error)_20%,transparent)] rounded-[var(--cal-radius-pill)] text-[9px] uppercase tracking-wider">
                          Revoked
                        </span>
                      ) : (
                        <span className="mt-2 inline-block px-2 py-0.5 bg-[color-mix(in_srgb,var(--cal-success)_10%,transparent)] text-[var(--cal-success)] border border-[color-mix(in_srgb,var(--cal-success)_20%,transparent)] rounded-[var(--cal-radius-pill)] text-[9px] uppercase tracking-wider">
                          Active
                        </span>
                      )}
                    </div>

                    {!d.revoked_at && (
                      <button
                        onClick={() => handleRevokeDevice(d.id)}
                        disabled={revokingId !== null}
                        className="px-3 py-1.5 bg-[color-mix(in_srgb,var(--cal-error)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--cal-error)_20%,transparent)] text-[var(--cal-error)] text-xs font-medium rounded-[var(--cal-radius-md)] border border-[color-mix(in_srgb,var(--cal-error)_10%,transparent)] cursor-pointer disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="cal-nested-card flex flex-col gap-[var(--cal-space-xs)]">
              <h2 className="text-[10px] uppercase font-medium text-[var(--cal-muted)] tracking-wider flex items-center gap-2">
                <KeyRound size={14} className="text-[var(--cal-accent)]" />
                Browser sessions
              </h2>

              <div className="flex flex-col gap-[var(--cal-space-xs)]">
                {sessions.map(s => (
                  <div key={s.id} className="cal-nested-card p-[var(--cal-space-xs)] flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-medium text-xs text-[var(--cal-ink)] truncate tnum" title={s.id}>
                        Session Token: {s.id.slice(0, 12)}...
                      </h3>
                      <p className="text-[10px] text-[var(--cal-muted)] mt-1 tnum">
                        Expires: {formatTimestamp(s.expires_at)}
                      </p>
                      {s.revoked_at ? (
                        <span className="mt-2 inline-block px-2 py-0.5 bg-[color-mix(in_srgb,var(--cal-error)_10%,transparent)] text-[var(--cal-error)] border border-[color-mix(in_srgb,var(--cal-error)_20%,transparent)] rounded-[var(--cal-radius-pill)] text-[9px] uppercase tracking-wider">
                          Terminated
                        </span>
                      ) : (
                        <span className="mt-2 inline-block px-2 py-0.5 bg-[color-mix(in_srgb,var(--cal-success)_10%,transparent)] text-[var(--cal-success)] border border-[color-mix(in_srgb,var(--cal-success)_20%,transparent)] rounded-[var(--cal-radius-pill)] text-[9px] uppercase tracking-wider">
                          Active Session
                        </span>
                      )}
                    </div>

                    {!s.revoked_at && (
                      <button
                        onClick={() => handleRevokeSession(s.id)}
                        disabled={revokingId !== null}
                        className="px-3 py-1.5 bg-[color-mix(in_srgb,var(--cal-error)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--cal-error)_20%,transparent)] text-[var(--cal-error)] text-xs font-medium rounded-[var(--cal-radius-md)] border border-[color-mix(in_srgb,var(--cal-error)_10%,transparent)] cursor-pointer disabled:opacity-50"
                      >
                        Terminate
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="cal-nested-card">
            <h2 className="text-[10px] uppercase font-medium text-[var(--cal-muted)] tracking-wider mb-3 flex items-center gap-2">
              <History size={14} className="text-[var(--cal-accent)]" />
              Audit trail
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--cal-hairline)] text-[var(--cal-muted)] uppercase tracking-wider font-medium h-10">
                    <th className="py-2 px-3">Timestamp</th>
                    <th className="py-2 px-3">Actor Profile</th>
                    <th className="py-2 px-3">Event Action</th>
                    <th className="py-2 px-3">Resource Target</th>
                    <th className="py-2 px-3 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--cal-hairline-soft)]">
                  {auditEvents.map(evt => {
                    const isExpanded = expandedEventId === evt.id;
                    return (
                      <React.Fragment key={evt.id}>
                        <tr className="hover:bg-[var(--cal-surface-soft)] bg-transparent h-12">
                          <td className="py-3 px-3 tnum text-[11px] text-[var(--cal-muted)]">
                            {formatTimestamp(evt.created_at)}
                          </td>
                          <td className="py-3 px-3 font-medium text-[var(--cal-ink)]">
                            {evt.actor_email}
                          </td>
                          <td className="py-3 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider border ${
                              evt.event_type.includes('FAIL') || evt.event_type.includes('CONFLICT')
                                ? 'bg-[color-mix(in_srgb,var(--cal-error)_10%,transparent)] border-[color-mix(in_srgb,var(--cal-error)_20%,transparent)] text-[var(--cal-error)]'
                                : evt.event_type.includes('INIT') || evt.event_type.includes('SYNC')
                                ? 'bg-[color-mix(in_srgb,var(--cal-accent)_10%,transparent)] border-[color-mix(in_srgb,var(--cal-accent)_20%,transparent)] text-[var(--cal-accent)]'
                                : 'bg-[var(--cal-surface-soft)] border-[var(--cal-hairline)] text-[var(--cal-body)]'
                            }`}>
                              {evt.event_type}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-[var(--cal-muted)] tnum">
                            <code>{evt.resource_type}</code> ({evt.resource_id.slice(0, 8)})
                          </td>
                          <td className="py-3 px-3 text-right">
                            <button
                              onClick={() => setExpandedEventId(isExpanded ? null : evt.id)}
                              className="px-2 py-1 bg-[var(--cal-surface-soft)] border border-[var(--cal-hairline)] rounded-[var(--cal-radius-md)] hover:bg-[var(--cal-surface-card)] text-[var(--cal-muted)] hover:text-[var(--cal-ink)] cursor-pointer inline-flex items-center gap-1 text-[10px]"
                            >
                              <FileJson size={11} />
                              {isExpanded ? 'Hide' : 'Expand'}
                              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={5} className="py-3 px-4">
                              <div className="cal-nested-card p-[var(--cal-space-xs)] text-[11px] text-[var(--cal-body)] leading-relaxed overflow-x-auto relative">
                                <span className="absolute top-3 right-3 text-[9px] uppercase tracking-wider text-[var(--cal-muted-soft)] bg-[var(--cal-surface-elevated)] px-2 py-0.5 rounded-[var(--cal-radius-md)] border border-[var(--cal-hairline)]">
                                  Raw Event Metadata
                                </span>
                                <pre className="whitespace-pre-wrap tnum">{JSON.stringify(JSON.parse(evt.metadata_json), null, 2)}</pre>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
