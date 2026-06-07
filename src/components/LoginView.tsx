import React, { useState } from 'react';
import { ArrowRight, AlertCircle } from 'lucide-react';

interface LoginViewProps {
  onLogin: (role: 'coach' | 'athlete') => void;
}

export function LoginView({ onLogin }: LoginViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    // Mock verification delay
    setTimeout(() => {
      setLoading(false);
      // Simple credentials mock routing
      if (email.includes('coach')) {
        onLogin('coach');
      } else {
        onLogin('athlete');
      }
    }, 800);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-gray-200 flex items-center justify-center p-4 font-sans relative overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-[-20%] left-[-20%] w-[80vw] h-[80vh] rounded-full bg-mac-blue/2 opacity-[0.03] blur-[150px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[80vw] h-[80vh] rounded-full bg-mac-green/2 opacity-[0.02] blur-[150px] pointer-events-none" />

      <div className="w-full max-w-md bg-[#111] border border-white/10 rounded-lg p-6 md:p-8 shadow-2xl relative z-10 space-y-6">
        
        {/* Header Logo */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-lg bg-mac-blue flex items-center justify-center text-white font-black mx-auto shadow-[0_0_20px_rgba(0,122,255,0.4)] text-lg">
            Ω
          </div>
          <div>
            <h1 className="text-sm font-black text-white tracking-widest uppercase mt-3">Obsidian Kinetic</h1>
            <span className="text-[9px] font-mono text-[#AEAEB2] tracking-widest uppercase block mt-0.5">
              Secure Gym Auth Terminal
            </span>
          </div>
        </div>

        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded flex items-center gap-2 text-xs font-mono">
            <AlertCircle size={14} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[9px] font-black uppercase text-zinc-500 tracking-widest block mb-1.5">Email Address</label>
            <div className="relative">
              <input
                type="email"
                placeholder="athlete@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#1C1C1E] border border-white/10 rounded px-3 py-2.5 text-xs text-white focus:outline-none focus:border-mac-blue placeholder-zinc-600 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="text-[9px] font-black uppercase text-zinc-500 tracking-widest block mb-1.5">Password</label>
            <div className="relative">
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#1C1C1E] border border-white/10 rounded px-3 py-2.5 text-xs text-white focus:outline-none focus:border-mac-blue placeholder-zinc-600 transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-mac-blue hover:bg-blue-600 text-white rounded text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-[0_0_15px_rgba(0,122,255,0.4)] disabled:opacity-50"
          >
            {loading ? 'Decrypting Credentials...' : 'Access Console'}
            <ArrowRight size={14} />
          </button>
        </form>

        {/* Quick Testing Bypass (Bypasses typing for developer testing) */}
        <div className="pt-4 border-t border-white/5 space-y-3">
          <div className="text-[9px] font-black text-zinc-500 uppercase tracking-widest text-center">
            Or quick login for validation
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => {
                setEmail('coach@example.com');
                setPassword('password');
                onLogin('coach');
              }}
              className="py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer text-center"
            >
              Coach Mike
            </button>
            <button
              onClick={() => {
                setEmail('athlete@example.com');
                setPassword('password');
                onLogin('athlete');
              }}
              className="py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer text-center"
            >
              Athlete Alex
            </button>
          </div>
        </div>

        {/* Security Warning Footer */}
        <div className="text-[9px] font-mono text-zinc-500 text-center uppercase tracking-wider">
          AES-256 SESSION ENCRYPTION ACTIVE
        </div>
      </div>
    </div>
  );
}

export const SampleDefault = () => (
  <LoginView onLogin={(role) => console.log('Mock logged in as:', role)} />
);
