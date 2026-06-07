import React, { useState } from 'react';
import { Send, CheckCircle, ArrowUpRight } from 'lucide-react';

export function TelegramLinkPanel() {
  const [status, setStatus] = useState<'disconnected' | 'linking' | 'connected'>('disconnected');
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  const handleGenerateToken = () => {
    setStatus('linking');
    setTimeout(() => {
      setToken(`TG-${Math.floor(100000 + Math.random() * 900000)}`);
    }, 600);
  };

  const handleSimulateConnection = () => {
    setStatus('connected');
    setUsername('@alex_mercer_lifts');
    setToken(null);
  };

  const handleDisconnect = () => {
    setStatus('disconnected');
    setUsername(null);
    setToken(null);
  };

  return (
    <div className="bg-[#111] border border-white/10 rounded-lg p-5 flex flex-col justify-between font-sans min-h-[240px]">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
            <Send size={14} className="text-mac-blue" />
            <span>Telegram Bot Integration</span>
          </h3>
          <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${
            status === 'connected' 
              ? 'bg-[#34C759]/10 text-[#34C759] border border-[#34C759]/20' 
              : 'bg-white/5 text-zinc-500 border border-white/10'
          }`}>
            {status}
          </span>
        </div>
        
        <p className="text-xs text-zinc-400 mt-2 font-mono">
          Launch workouts directly from Telegram Mini App webviews. Configures real-time push reminders.
        </p>

        {status === 'linking' && token && (
          <div className="mt-4 p-3 bg-black/40 border border-white/5 rounded text-center">
            <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-1">Send this token to bot</p>
            <div className="font-mono text-white text-lg font-bold tracking-wider">{token}</div>
            <button
              onClick={handleSimulateConnection}
              className="mt-2 text-[10px] uppercase font-bold text-mac-blue hover:underline cursor-pointer"
            >
              Simulate Bot Response
            </button>
          </div>
        )}

        {status === 'connected' && username && (
          <div className="mt-4 p-3 bg-green-500/5 border border-green-500/10 rounded flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-2">
              <CheckCircle size={14} className="text-[#34C759]" />
              <span className="text-white font-bold">Linked: {username}</span>
            </div>
            <button 
              onClick={handleDisconnect}
              className="text-[10px] text-zinc-500 hover:text-white uppercase cursor-pointer"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      <div className="mt-6 flex gap-2">
        {status === 'disconnected' && (
          <button
            onClick={handleGenerateToken}
            className="w-full py-2 bg-mac-blue hover:bg-blue-600 text-white rounded text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1 cursor-pointer transition-all shadow-[0_0_15px_rgba(0,122,255,0.4)]"
          >
            <span>Link Telegram Account</span>
          </button>
        )}

        {status === 'connected' && (
          <a
            href="https://t.me/obsidian_kinetic_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/15 hover:border-white/30 text-white rounded text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer text-center"
          >
            <span>Launch Bot Terminal</span>
            <ArrowUpRight size={14} />
          </a>
        )}
      </div>
    </div>
  );
}
