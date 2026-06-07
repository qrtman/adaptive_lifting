import React, { useState } from 'react';
import { Shield, Smartphone, Table } from 'lucide-react';

interface Session {
  id: string;
  device: string;
  ip: string;
  location: string;
  lastActive: string;
  current: boolean;
}

interface AuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  details: string;
  status: 'SUCCESS' | 'CONFLICT' | 'DENIED';
}

export function SecurityView() {
  const [sessions, setSessions] = useState<Session[]>([
    { id: 'sess-1', device: 'Chrome on Windows 11 (PC)', ip: '192.168.1.142', location: 'Seoul, KR', lastActive: 'Active now', current: true },
    { id: 'sess-2', device: 'Telegram Mini App (iPhone 15)', ip: '210.123.45.67', location: 'Seoul, KR', lastActive: '12 minutes ago', current: false },
    { id: 'sess-3', device: 'Safari on iPadOS', ip: '192.168.1.201', location: 'Staging LAN', lastActive: '2 days ago', current: false },
  ]);

  const [events] = useState<AuditEvent[]>([
    { id: 'evt-1', timestamp: '2026-06-06 21:40:12', actor: 'Coach Mike', action: 'WORKOUT_LOCKED', details: 'Acquired write lock on workout w-1-1', status: 'SUCCESS' },
    { id: 'evt-2', timestamp: '2026-06-06 21:35:08', actor: 'Athlete Alex', action: 'SET_LOGGED', details: 'Logged Set 2: 180kg x 3 @ 8.5', status: 'SUCCESS' },
    { id: 'evt-3', timestamp: '2026-06-06 21:35:05', actor: 'Athlete Alex', action: 'SET_LOGGED', details: 'Conflict clashing set 2: 175kg x 3', status: 'CONFLICT' },
    { id: 'evt-4', timestamp: '2026-06-06 21:10:45', actor: 'Coach Mike', action: 'SHEETS_PUBLISHED', details: 'Published Alpha-09 Strength Phase to Sheets', status: 'SUCCESS' },
  ]);

  const handleRevoke = (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
  };

  return (
    <div className="p-6 font-sans space-y-6 overflow-y-auto h-full text-sm text-gray-200">
      
      {/* View Header */}
      <div className="flex items-center justify-between border-b border-white/5 pb-4">
        <div>
          <h2 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
            <Shield className="text-mac-blue" size={18} />
            <span>Security & Session Audit Console</span>
          </h2>
          <p className="text-[10px] font-mono text-[#AEAEB2] tracking-widest uppercase mt-0.5">
            Cryptographic Tokens & Device Terminals Management
          </p>
        </div>
      </div>

      {/* Connected Terminals (Devices) */}
      <div className="bg-[#111] border border-white/10 rounded-lg p-5">
        <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2 mb-4">
          <Smartphone size={15} className="text-mac-blue" />
          <span>Active Device Terminals ({sessions.length})</span>
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-white/10 text-zinc-500 uppercase text-[9px] tracking-widest">
                <th className="pb-3">Device Terminal</th>
                <th className="pb-3">IP Address</th>
                <th className="pb-3">Location</th>
                <th className="pb-3">Last Active</th>
                <th className="pb-3 text-center w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {sessions.map((sess) => (
                <tr key={sess.id} className="hover:bg-white/2">
                  <td className="py-3 flex items-center gap-2 text-white font-bold">
                    <span>{sess.device}</span>
                    {sess.current && (
                      <span className="text-[9px] font-black uppercase bg-[#34C759]/10 text-[#34C759] border border-[#34C759]/20 px-1.5 py-0.2 rounded font-mono">
                        THIS TERMINAL
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-zinc-400 tabular-nums">{sess.ip}</td>
                  <td className="py-3 text-zinc-400">{sess.location}</td>
                  <td className="py-3 text-[#AEAEB2]">{sess.lastActive}</td>
                  <td className="py-3 text-center">
                    {!sess.current && (
                      <button
                        onClick={() => handleRevoke(sess.id)}
                        className="px-2 py-1 bg-red-500/10 hover:bg-red-500/25 border border-red-500/30 hover:border-red-500/50 text-[#FF453A] rounded font-bold uppercase text-[9px] tracking-wider transition-all cursor-pointer"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Idempotent Audit Event Log */}
      <div className="bg-[#111] border border-white/10 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
            <Table size={15} className="text-mac-blue" />
            <span>Cryptographic Event Audit Log</span>
          </h3>
          <span className="text-[10px] font-mono text-zinc-500">IDEMPOTENT DECK</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-white/10 text-zinc-500 uppercase text-[9px] tracking-widest">
                <th className="pb-3">Timestamp</th>
                <th className="pb-3">Actor</th>
                <th className="pb-3">Action code</th>
                <th className="pb-3">Event Details</th>
                <th className="pb-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {events.map((evt) => (
                <tr key={evt.id} className="hover:bg-white/2">
                  <td className="py-3 text-[#AEAEB2] tabular-nums">{evt.timestamp}</td>
                  <td className="py-3 text-white font-bold">{evt.actor}</td>
                  <td className="py-3 text-mac-blue font-bold tracking-wider">{evt.action}</td>
                  <td className="py-3 text-gray-300">{evt.details}</td>
                  <td className="py-3 text-center">
                    <span className={`inline-block text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      evt.status === 'SUCCESS'
                        ? 'bg-[#34C759]/10 text-[#34C759] border border-[#34C759]/20'
                        : evt.status === 'CONFLICT'
                        ? 'bg-[#FF9500]/10 text-[#FF9500] border border-[#FF9500]/20'
                        : 'bg-[#FF453A]/10 text-[#FF453A] border border-[#FF453A]/20'
                    }`}>
                      {evt.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export const SampleDefault = () => (
  <SecurityView />
);
