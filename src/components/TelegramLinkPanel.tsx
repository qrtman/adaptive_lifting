import React, { useState, useEffect } from 'react';
import { Send, CheckCircle2, AlertCircle, RefreshCw, XCircle, ArrowRight } from 'lucide-react';

export const TelegramLinkPanel = () => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'unlinked' | 'generating' | 'linked' | 'error'>('idle');
  const [token, setToken] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState<string>('ObsidianKineticBot');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(600); // 10 minutes

  const checkStatus = async (silent = false) => {
    if (!silent) setStatus('loading');
    try {
      const res = await fetch('http://localhost:8000/api/integrations/telegram/status', {
        headers: { 'credentials': 'include' } // matches cookie session setup
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'connected') {
          setStatus('linked');
          setToken(null);
        } else {
          if (status !== 'generating') {
            setStatus('unlinked');
          }
        }
      } else {
        throw new Error("Failed to fetch connection status");
      }
    } catch (e: any) {
      console.error(e);
      if (!silent) {
        setStatus('error');
        setErrorMsg("Could not load Telegram linkage status. Ensure backend is running.");
      }
    }
  };

  const generateToken = async () => {
    setStatus('loading');
    setErrorMsg(null);
    try {
      const res = await fetch('http://localhost:8000/api/integrations/telegram/link-token', {
        method: 'POST',
        headers: { 'credentials': 'include' }
      });
      if (res.ok) {
        const data = await res.json();
        setToken(data.token);
        setBotUsername(data.bot_username || 'ObsidianKineticBot');
        setStatus('generating');
        setSecondsLeft(600); // reset countdown
      } else {
        throw new Error("Failed to request short-lived linking token");
      }
    } catch (e: any) {
      console.error(e);
      setStatus('error');
      setErrorMsg("Failed to generate link token. Please verify server connection.");
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Are you sure you want to disconnect your Telegram account? WebApp logging and bot updates will be disabled.")) {
      return;
    }
    setStatus('loading');
    try {
      const res = await fetch('http://localhost:8000/api/integrations/telegram', {
        method: 'DELETE',
        headers: { 'credentials': 'include' }
      });
      if (res.ok) {
        setStatus('unlinked');
        setToken(null);
      } else {
        throw new Error("Failed to sever integration");
      }
    } catch (e) {
      console.error(e);
      setStatus('error');
      setErrorMsg("Failed to sever Telegram link. Please try again.");
    }
  };

  // Initial load status check
  useEffect(() => {
    checkStatus();
  }, []);

  // Poll status when in 'generating' mode to capture bot-activated linking
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (status === 'generating') {
      interval = setInterval(() => {
        checkStatus(true); // silent check in background
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [status]);

  // Countdown timer for link token
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (status === 'generating' && secondsLeft > 0) {
      timer = setTimeout(() => {
        setSecondsLeft(prev => prev - 1);
      }, 1000);
    } else if (secondsLeft === 0 && status === 'generating') {
      setStatus('unlinked');
      setToken(null);
    }
    return () => clearTimeout(timer);
  }, [status, secondsLeft]);

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="bg-[#131313] p-6 rounded-xl border border-white/10 relative overflow-hidden transition-all duration-300">
      {/* Dynamic Glow Strip */}
      <div className={`absolute top-0 left-0 w-full h-[3px] ${
        status === 'linked' ? 'bg-mac-green' : status === 'generating' ? 'bg-mac-blue' : 'bg-white/10'
      }`} />

      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            Telegram Mini App Companion
            {status === 'linked' && (
              <span className="px-2 py-0.5 bg-mac-green/10 text-mac-green border border-mac-green/20 rounded-full text-[10px] uppercase font-bold tracking-wider">
                Active
              </span>
            )}
          </h3>
          <p className="text-gray-400 text-sm mt-1">
            Access your workouts on the gym floor using the bot interface or custom Telegram WebView.
          </p>
        </div>
      </div>

      {status === 'loading' && (
        <div className="flex items-center gap-3 py-6 justify-center text-gray-400">
          <RefreshCw size={18} className="animate-spin text-mac-blue" />
          <span className="text-sm font-semibold tracking-wide">Syncing status...</span>
        </div>
      )}

      {status === 'error' && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-lg flex items-start gap-3 mb-4">
          <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-200 font-medium">{errorMsg}</p>
            <button onClick={() => checkStatus()} className="text-xs text-red-400 hover:text-red-300 font-bold underline mt-2 cursor-pointer">
              Retry Connection Check
            </button>
          </div>
        </div>
      )}

      {status === 'unlinked' && (
        <div className="mt-4">
          <div className="bg-black/20 p-4 rounded-lg border border-white/5 mb-4 text-sm text-gray-400">
            <p className="mb-2">Connecting your account enables:</p>
            <ul className="list-disc list-inside space-y-1 pl-1">
              <li>Automatic morning workout summaries via direct message.</li>
              <li>Real-time logging via Telegram native Mini App WebView.</li>
              <li>Interactive keyboard commands (<code>/today</code>, <code>/log</code>, <code>/done</code>).</li>
            </ul>
          </div>
          <button 
            onClick={generateToken} 
            className="px-5 py-2.5 bg-[#007aff] hover:bg-blue-600 text-white rounded-lg font-bold text-sm transition-all shadow-md shadow-blue-500/10 cursor-pointer flex items-center gap-2"
          >
            <Send size={15} />
            Generate Linking Token
          </button>
        </div>
      )}

      {status === 'generating' && token && (
        <div className="mt-4 space-y-4">
          <div className="bg-mac-blue/5 border border-mac-blue/20 p-4 rounded-lg flex gap-3">
            <RefreshCw size={18} className="text-mac-blue animate-spin shrink-0 mt-0.5" />
            <p className="text-xs text-gray-400 leading-relaxed">
              Waiting for link verification. Open Telegram, start a chat with <span className="text-white font-mono">@{botUsername}</span> and enter the code below.
            </p>
          </div>

          <div className="bg-black/50 p-5 rounded-xl border border-white/10 flex flex-col items-center justify-center text-center relative">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold mb-1">Temporary Code</p>
            <p className="font-mono text-3xl font-black text-white tracking-[0.2em] pl-[0.2em]">{token}</p>
            <p className="text-xs text-gray-400 mt-2 flex items-center gap-1.5">
              Send this token to <span className="text-mac-blue font-semibold">@{botUsername}</span>
            </p>
            <div className="absolute top-3 right-3 text-[10px] font-bold font-mono text-mac-blue/60 bg-mac-blue/10 px-2 py-0.5 rounded-full border border-mac-blue/15">
              Expires in {formatTime(secondsLeft)}
            </div>
          </div>
          
          <button onClick={() => setStatus('unlinked')} className="text-xs text-gray-500 hover:text-white font-semibold transition-colors flex items-center gap-1 cursor-pointer">
            <XCircle size={14} /> Cancel Link Request
          </button>
        </div>
      )}

      {status === 'linked' && (
        <div className="mt-4 space-y-4">
          <div className="bg-mac-green/5 border border-mac-green/20 p-4 rounded-lg flex items-center gap-3">
            <CheckCircle2 size={20} className="text-mac-green shrink-0" />
            <div className="text-sm">
              <p className="text-white font-bold">Account Successfully Synced</p>
              <p className="text-xs text-gray-400 mt-0.5">Your lifter profile is securely tied to Telegram. WebApp operations are live.</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 items-center justify-between p-4 bg-black/30 rounded-lg border border-white/5">
            <div className="text-xs space-y-1">
              <p className="text-gray-500 uppercase tracking-widest font-bold">Integration Service</p>
              <p className="text-gray-200 font-mono">Telegram Bot (API Webhooks)</p>
            </div>
            <button 
              onClick={disconnect} 
              className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg font-bold text-xs border border-red-500/20 transition-all cursor-pointer flex items-center gap-1.5"
            >
              <XCircle size={14} /> Disconnect Account
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
