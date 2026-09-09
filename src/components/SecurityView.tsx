import React, { useState, useEffect } from 'react';
import { apiFetch, backendOrigin } from '../services/backendUrl';
import {
  Laptop, KeyRound, History, AlertTriangle,
  ChevronDown, ChevronUp, RefreshCw, FileJson, CheckCircle2
} from 'lucide-react';

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
  const backendConfigured = Boolean(backendOrigin());

  const fetchSecurityData = async (silent = false) => {
    if (!backendOrigin()) {
      setDevices([]);
      setSessions([]);
      setAuditEvents([]);
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    setErrorMsg(null);
    try {
      const resDev = await apiFetch('/api/security/devices');
      if (!resDev.ok) throw new Error('Failed to load devices.');
      setDevices(await resDev.json());

      const resSess = await apiFetch('/api/security/sessions');
      if (!resSess.ok) throw new Error('Failed to load sessions.');
      setSessions(await resSess.json());

      const resAudit = await apiFetch('/api/security/audit-events');
      if (!resAudit.ok) throw new Error('Failed to load audit events.');
      setAuditEvents(await resAudit.json());
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || 'Failed to load security data.');
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeDevice = async (id: string) => {
    if (!window.confirm('Revoke this device? Unsynced offline data on that device may be blocked.')) {
      return;
    }
    setRevokingId(id);
    try {
      const res = await apiFetch(`/api/security/devices/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Server rejected device revocation.');
      showSuccess('Device revoked.');
      fetchSecurityData(true);
    } catch (e: any) {
      alert(`Revocation failed: ${e.message}`);
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeSession = async (id: string) => {
    if (!window.confirm('Terminate this browser login? Later requests from that session will be rejected.')) {
      return;
    }
    setRevokingId(id);
    try {
      const res = await apiFetch(`/api/security/sessions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Server rejected session revocation.');
      showSuccess('Session terminated.');
      fetchSecurityData(true);
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
      return new Date(isoString).toLocaleString();
    } catch {
      return isoString;
    }
  };

  return (
    <div className="h-full w-full bg-[#000000] text-white overflow-y-auto pb-32 font-sans flex flex-col p-6">
      <div className="mb-8 mt-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Security</h1>
          <p className="text-zinc-400 text-sm mt-2">Devices, sessions, and audit events for this account.</p>
        </div>
        <button
          onClick={() => fetchSecurityData()}
          disabled={loading || !backendConfigured}
          className="h-10 w-10 border border-white/10 bg-[#131313] hover:bg-[#161616] flex items-center justify-center cursor-pointer disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin text-mac-blue' : 'text-[#AEAEB2]'} />
        </button>
      </div>

      {successAlert && (
        <div className="mb-4 border border-[#34C759]/30 bg-[#34C759]/10 p-3 flex items-center gap-3">
          <CheckCircle2 size={16} className="text-[#34C759] shrink-0" />
          <span className="text-sm text-[#34C759]">{successAlert}</span>
        </div>
      )}

      {errorMsg && (
        <div className="mb-4 border border-[#FF453A]/40 bg-[#FF453A]/10 p-3 flex items-start gap-3">
          <AlertTriangle size={16} className="text-[#FF453A] shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-[#FF453A]">{errorMsg}</p>
            <button onClick={() => fetchSecurityData()} className="text-xs text-[#FF453A] underline mt-1 cursor-pointer">
              Retry
            </button>
          </div>
        </div>
      )}

      {!backendConfigured ? (
        <div className="border border-white/10 bg-[#131313] p-4">
          <p className="text-sm text-[#AEAEB2]">No backend is configured.</p>
          <p className="text-xs text-[#636366] mt-1">Device and session revocation require VITE_BACKEND_URL.</p>
        </div>
      ) : loading && devices.length === 0 && sessions.length === 0 ? (
        <div className="flex justify-center p-8">
          <span className="h-6 w-6 border-2 border-mac-blue border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="border border-white/10 bg-[#131313] p-4">
              <h2 className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-4 flex items-center gap-2">
                <Laptop size={14} />
                Devices
              </h2>
              {devices.length === 0 ? (
                <p className="text-sm text-[#AEAEB2]">No devices recorded for this account.</p>
              ) : (
                <div className="space-y-1">
                  {devices.map((d) => (
                    <div key={d.id} className="border-b border-white/10 px-2 py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="text-sm text-white truncate">{d.device_label}</h3>
                        <p className="text-[10px] font-mono text-[#AEAEB2] mt-0.5">
                          {d.id} · Last seen {formatTimestamp(d.last_seen_at)}
                        </p>
                        <p className="text-[10px] mt-1 uppercase tracking-wider text-[#636366]">
                          {d.revoked_at ? 'Revoked' : 'Active'}
                        </p>
                      </div>
                      {!d.revoked_at && (
                        <button
                          onClick={() => handleRevokeDevice(d.id)}
                          disabled={revokingId !== null}
                          className="px-3 py-1.5 text-xs text-[#FF453A] border border-[#FF453A]/30 cursor-pointer disabled:opacity-50"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border border-white/10 bg-[#131313] p-4">
              <h2 className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-4 flex items-center gap-2">
                <KeyRound size={14} />
                Sessions
              </h2>
              {sessions.length === 0 ? (
                <p className="text-sm text-[#AEAEB2]">No browser sessions recorded for this account.</p>
              ) : (
                <div className="space-y-1">
                  {sessions.map((s) => (
                    <div key={s.id} className="border-b border-white/10 px-2 py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="text-sm font-mono text-white truncate" title={s.id}>
                          {s.id.slice(0, 12)}…
                        </h3>
                        <p className="text-[10px] font-mono text-[#AEAEB2] mt-0.5">
                          Expires {formatTimestamp(s.expires_at)}
                        </p>
                        <p className="text-[10px] mt-1 uppercase tracking-wider text-[#636366]">
                          {s.revoked_at ? 'Terminated' : 'Active'}
                        </p>
                      </div>
                      {!s.revoked_at && (
                        <button
                          onClick={() => handleRevokeSession(s.id)}
                          disabled={revokingId !== null}
                          className="px-3 py-1.5 text-xs text-[#FF453A] border border-[#FF453A]/30 cursor-pointer disabled:opacity-50"
                        >
                          Terminate
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="border border-white/10 bg-[#131313] p-4">
            <h2 className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-4 flex items-center gap-2">
              <History size={14} />
              Audit events
            </h2>
            {auditEvents.length === 0 ? (
              <p className="text-sm text-[#AEAEB2]">No audit events yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-[#636366] uppercase tracking-wider h-10">
                      <th className="py-2 px-2 font-medium">Time</th>
                      <th className="py-2 px-2 font-medium">Actor</th>
                      <th className="py-2 px-2 font-medium">Event</th>
                      <th className="py-2 px-2 font-medium">Resource</th>
                      <th className="py-2 px-2 font-medium text-right">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditEvents.map((evt) => {
                      const isExpanded = expandedEventId === evt.id;
                      let metadata = evt.metadata_json;
                      try {
                        metadata = JSON.stringify(JSON.parse(evt.metadata_json), null, 2);
                      } catch {
                        metadata = evt.metadata_json;
                      }
                      return (
                        <React.Fragment key={evt.id}>
                          <tr className="border-b border-white/10 h-12">
                            <td className="py-3 px-2 font-mono text-[11px] text-[#AEAEB2]">
                              {formatTimestamp(evt.created_at)}
                            </td>
                            <td className="py-3 px-2 text-white">{evt.actor_email}</td>
                            <td className="py-3 px-2 font-mono">{evt.event_type}</td>
                            <td className="py-3 px-2 text-[#AEAEB2]">
                              <code>{evt.resource_type}</code> ({evt.resource_id.slice(0, 8)})
                            </td>
                            <td className="py-3 px-2 text-right">
                              <button
                                onClick={() => setExpandedEventId(isExpanded ? null : evt.id)}
                                className="px-2 py-1 border border-white/10 text-[#AEAEB2] cursor-pointer inline-flex items-center gap-1 text-[10px]"
                              >
                                <FileJson size={11} />
                                {isExpanded ? 'Hide' : 'Expand'}
                                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={5} className="py-3 px-2 bg-[#0A0A0A]">
                                <pre className="whitespace-pre-wrap font-mono text-[11px] text-[#AEAEB2]">{metadata}</pre>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
