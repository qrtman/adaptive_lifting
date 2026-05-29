import React, { useState, useEffect } from 'react';
import { 
  Shield, Laptop, KeyRound, History, XCircle, AlertTriangle, 
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

  const fetchSecurityData = async (silent = false) => {
    if (!silent) setLoading(true);
    setErrorMsg(null);
    try {
      // 1. Fetch devices
      const resDev = await fetch('http://localhost:8000/api/security/devices', { credentials: 'include' });
      if (!resDev.ok) throw new Error("Failed to load client devices");
      const devData = await resDev.json();
      setDevices(devData);

      // 2. Fetch sessions
      const resSess = await fetch('http://localhost:8000/api/security/sessions', { credentials: 'include' });
      if (!resSess.ok) throw new Error("Failed to load active login sessions");
      const sessData = await resSess.json();
      setSessions(sessData);

      // 3. Fetch audit events
      const resAudit = await fetch('http://localhost:8000/api/security/audit-events', { credentials: 'include' });
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
      const res = await fetch(`http://localhost:8000/api/security/devices/${id}`, {
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
      const res = await fetch(`http://localhost:8000/api/security/sessions/${id}`, {
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
    <div className="flex-1 w-full bg-black text-white p-6 overflow-y-auto font-sans pb-32">
      {/* Header section */}
      <div className="mb-8 mt-2 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
            <Shield size={28} className="text-mac-blue" />
            Security & Audit Control
          </h1>
          <p className="text-zinc-400 text-sm mt-1">
            Manage logged-in devices, active browser sessions, and inspect system audit events.
          </p>
        </div>
        <button 
          onClick={() => fetchSecurityData()}
          disabled={loading}
          className="h-10 w-10 rounded-xl bg-zinc-900 border border-white/10 hover:bg-zinc-800 transition-colors flex items-center justify-center cursor-pointer disabled:opacity-50"
          title="Refresh Audit Logs"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin text-mac-blue' : 'text-zinc-300'} />
        </button>
      </div>

      {successAlert && (
        <div className="mb-6 bg-mac-green/10 border border-mac-green/20 p-4 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300">
          <CheckCircle2 size={18} className="text-mac-green shrink-0" />
          <span className="text-sm font-semibold text-mac-green">{successAlert}</span>
        </div>
      )}

      {errorMsg && (
        <div className="mb-6 bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-200 font-medium">{errorMsg}</p>
            <button onClick={() => fetchSecurityData()} className="text-xs text-red-400 font-bold underline mt-1 cursor-pointer">
              Retry Load
            </button>
          </div>
        </div>
      )}

      {loading && devices.length === 0 ? (
        <div className="flex flex-col justify-center items-center py-20 text-gray-500 gap-3">
          <RefreshCw size={24} className="animate-spin text-mac-blue" />
          <p className="text-xs font-semibold tracking-wider uppercase">Loading security vault...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Secured Overview Info Banner */}
          <div className="bg-[#131313] p-5 rounded-2xl border border-white/10">
            <p className="text-xs text-zinc-400 leading-relaxed">
              🔐 <b>Active Encryption Shield:</b> All active sessions are bound via <b>secure, HTTP-Only session cookies</b>. Remotely terminating a browser token or device invalidates the backend signature key immediately, rejecting subsequent synchronization mutations or read queries.
            </p>
          </div>

          {/* Quadrant: Devices and Sessions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Devices Card */}
            <div className="bg-zinc-950/50 border border-zinc-900 rounded-3xl p-6 shadow-2xl backdrop-blur-xl">
              <h2 className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-4 flex items-center gap-2">
                <Laptop size={14} className="text-mac-blue" />
                Linked Devices & Terminals
              </h2>

              <div className="space-y-3">
                {devices.map(d => (
                  <div key={d.id} className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 flex items-center justify-between gap-4">
                    <div>
                      <h3 className="font-bold text-sm text-white">{d.device_label}</h3>
                      <p className="text-[10px] text-zinc-500 mt-1 font-mono">
                        ID: {d.id} | Last Seen: {formatTimestamp(d.last_seen_at)}
                      </p>
                      {d.revoked_at ? (
                        <span className="mt-2 inline-block px-2 py-0.5 bg-red-500/10 text-red-500 border border-red-500/20 rounded-full text-[9px] uppercase font-bold tracking-wider">
                          Revoked
                        </span>
                      ) : (
                        <span className="mt-2 inline-block px-2 py-0.5 bg-mac-green/10 text-mac-green border border-mac-green/20 rounded-full text-[9px] uppercase font-bold tracking-wider">
                          Active
                        </span>
                      )}
                    </div>

                    {!d.revoked_at && (
                      <button
                        onClick={() => handleRevokeDevice(d.id)}
                        disabled={revokingId !== null}
                        className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 text-xs font-bold rounded-lg border border-red-500/10 hover:border-red-500/20 transition-all cursor-pointer disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Browser Sessions Card */}
            <div className="bg-zinc-950/50 border border-zinc-900 rounded-3xl p-6 shadow-2xl backdrop-blur-xl">
              <h2 className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-4 flex items-center gap-2">
                <KeyRound size={14} className="text-mac-blue" />
                Active Browser Logins
              </h2>

              <div className="space-y-3">
                {sessions.map(s => (
                  <div key={s.id} className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-bold text-sm text-white truncate font-mono text-xs" title={s.id}>
                        Session Token: {s.id.slice(0, 12)}...
                      </h3>
                      <p className="text-[10px] text-zinc-500 mt-1 font-mono">
                        Expires: {formatTimestamp(s.expires_at)}
                      </p>
                      {s.revoked_at ? (
                        <span className="mt-2 inline-block px-2 py-0.5 bg-red-500/10 text-red-500 border border-red-500/20 rounded-full text-[9px] uppercase font-bold tracking-wider">
                          Terminated
                        </span>
                      ) : (
                        <span className="mt-2 inline-block px-2 py-0.5 bg-mac-green/10 text-mac-green border border-mac-green/20 rounded-full text-[9px] uppercase font-bold tracking-wider">
                          Active Session
                        </span>
                      )}
                    </div>

                    {!s.revoked_at && (
                      <button
                        onClick={() => handleRevokeSession(s.id)}
                        disabled={revokingId !== null}
                        className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 text-xs font-bold rounded-lg border border-red-500/10 hover:border-red-500/20 transition-all cursor-pointer disabled:opacity-50"
                      >
                        Terminate
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* Audit Logs Trail Card */}
          <div className="bg-zinc-950/50 border border-zinc-900 rounded-3xl p-6 shadow-2xl backdrop-blur-xl">
            <h2 className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-4 flex items-center gap-2">
              <History size={14} className="text-mac-blue" />
              Chronological Audit Trail Logs
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-white/5 text-zinc-500 uppercase tracking-widest font-black h-10">
                    <th className="py-2 px-3">Timestamp</th>
                    <th className="py-2 px-3">Actor Profile</th>
                    <th className="py-2 px-3">Event Action</th>
                    <th className="py-2 px-3">Resource Target</th>
                    <th className="py-2 px-3 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {auditEvents.map(evt => {
                    const isExpanded = expandedEventId === evt.id;
                    return (
                      <React.Fragment key={evt.id}>
                        <tr className="hover:bg-white/2 bg-transparent transition-colors h-12">
                          <td className="py-3 px-3 font-mono text-[11px] text-zinc-400">
                            {formatTimestamp(evt.created_at)}
                          </td>
                          <td className="py-3 px-3 font-bold text-white">
                            {evt.actor_email}
                          </td>
                          <td className="py-3 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-extrabold border ${
                              evt.event_type.includes('FAIL') || evt.event_type.includes('CONFLICT')
                                ? 'bg-red-500/10 border-red-500/20 text-red-400'
                                : evt.event_type.includes('INIT') || evt.event_type.includes('SYNC')
                                ? 'bg-mac-blue/10 border-mac-blue/20 text-mac-blue'
                                : 'bg-zinc-800 border-zinc-700 text-zinc-300'
                            }`}>
                              {evt.event_type}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-zinc-400">
                            <code>{evt.resource_type}</code> ({evt.resource_id.slice(0, 8)})
                          </td>
                          <td className="py-3 px-3 text-right">
                            <button
                              onClick={() => setExpandedEventId(isExpanded ? null : evt.id)}
                              className="px-2 py-1 bg-zinc-900 border border-white/5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-all cursor-pointer inline-flex items-center gap-1 font-bold text-[10px]"
                            >
                              <FileJson size={11} />
                              {isExpanded ? 'Hide' : 'Expand'}
                              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={5} className="py-4 px-6 bg-black/40 border-b border-white/5">
                              <div className="bg-[#050505] border border-white/10 rounded-xl p-4 font-mono text-[11px] text-zinc-300 leading-relaxed overflow-x-auto relative">
                                <span className="absolute top-3 right-3 text-[9px] uppercase tracking-widest font-black text-zinc-600 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-900">
                                  Raw Event Metadata
                                </span>
                                <pre className="whitespace-pre-wrap">{JSON.stringify(JSON.parse(evt.metadata_json), null, 2)}</pre>
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
          </div>

        </div>
      )}
    </div>
  );
};
