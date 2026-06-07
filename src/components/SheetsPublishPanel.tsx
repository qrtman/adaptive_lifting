import React, { useState } from 'react';
import { LayoutGrid, CheckCircle, RefreshCw, CloudUpload } from 'lucide-react';

export function SheetsPublishPanel() {
  const [status, setStatus] = useState<'disconnected' | 'connected' | 'publishing'>('disconnected');
  const [spreadsheetName, setSpreadsheetName] = useState<string | null>(null);

  const handleConnect = () => {
    setStatus('connected');
    setSpreadsheetName('Alex Mercer — Powerlifting Program (Staging)');
  };

  const handlePublish = () => {
    setStatus('publishing');
    setTimeout(() => {
      setStatus('connected');
      alert('Successfully exported/published mesocycle spreadsheet.');
    }, 1200);
  };

  const handleDisconnect = () => {
    setStatus('disconnected');
    setSpreadsheetName(null);
  };

  return (
    <div className="bg-[#111] border border-white/10 rounded-lg p-5 flex flex-col justify-between font-sans min-h-[240px]">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
            <LayoutGrid size={14} className="text-mac-blue" />
            <span>Google Sheets Exporter</span>
          </h3>
          <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${
            status === 'connected' 
              ? 'bg-[#34C759]/10 text-[#34C759] border border-[#34C759]/20' 
              : status === 'publishing'
              ? 'bg-mac-blue/10 text-mac-blue border border-mac-blue/20'
              : 'bg-white/5 text-zinc-500 border border-white/10'
          }`}>
            {status === 'publishing' ? 'publishing...' : status}
          </span>
        </div>
        
        <p className="text-xs text-zinc-400 mt-2 font-mono">
          One-way program publishing flow. Note: Edits made directly inside Google Sheets will NOT write back to Obsidian Kinetic database.
        </p>

        {status === 'connected' && spreadsheetName && (
          <div className="mt-4 p-3 bg-green-500/5 border border-green-500/10 rounded flex items-center justify-between text-xs font-mono">
            <div>
              <div className="flex items-center gap-2">
                <CheckCircle size={14} className="text-[#34C759]" />
                <span className="text-white font-bold truncate max-w-[200px]">{spreadsheetName}</span>
              </div>
              <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wider font-mono">Row edits here do not write to database</p>
            </div>
            <button 
              onClick={handleDisconnect}
              className="text-[10px] text-zinc-500 hover:text-white uppercase cursor-pointer"
            >
              Revoke
            </button>
          </div>
        )}
      </div>

      <div className="mt-6 flex gap-2">
        {status === 'disconnected' ? (
          <button
            onClick={handleConnect}
            className="w-full py-2 bg-mac-blue hover:bg-blue-600 text-white rounded text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1 cursor-pointer transition-all shadow-[0_0_15px_rgba(0,122,255,0.4)]"
          >
            <span>Authorize Google OAuth</span>
          </button>
        ) : (
          <button
            onClick={handlePublish}
            disabled={status === 'publishing'}
            className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/15 hover:border-white/30 text-white rounded text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {status === 'publishing' ? (
              <>
                <RefreshCw size={14} className="animate-spin text-mac-blue" />
                <span>Publishing to Sheets...</span>
              </>
            ) : (
              <>
                <CloudUpload size={14} />
                <span>Export Now</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
