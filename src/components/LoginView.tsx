import React, { useState } from 'react';
import { apiService } from '../services/api';

interface LoginViewProps {
  onAuthSuccess: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onAuthSuccess }) => {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'ATHLETE' | 'COACH'>('ATHLETE');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMsg('Please fill out all fields.');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      if (isLoginMode) {
        await apiService.login(email, password);
      } else {
        await apiService.register(email, password, role);
      }
      onAuthSuccess();
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full w-full bg-[#000000] flex flex-col items-center justify-center p-6 text-white font-sans overflow-hidden">
      <div className="w-full max-w-md bg-zinc-950 border border-zinc-900 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
        {/* Aesthetic Glow */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-[#75ff9e] to-transparent opacity-50" />
        
        <h1 className="text-3xl font-black mb-2 tracking-tight text-white text-center">
          {isLoginMode ? 'Welcome Back' : 'Join Iron Box'}
        </h1>
        <p className="text-zinc-500 text-sm text-center mb-8">
          {isLoginMode ? 'Enter your credentials to access your terminal.' : 'Create your account and select your role.'}
        </p>

        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded-xl mb-6 text-sm text-center">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 flex flex-col">
          <div>
            <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-1 block pl-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-[#75ff9e] transition-colors"
              placeholder="athlete@ironbox.app"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-1 block pl-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:border-[#75ff9e] transition-colors"
              placeholder="••••••••"
            />
          </div>

          {!isLoginMode && (
            <div>
              <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-1 block pl-1">Account Role</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRole('ATHLETE')}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all border ${role === 'ATHLETE' ? 'bg-[#75ff9e] text-black border-[#75ff9e]' : 'bg-zinc-900/50 text-zinc-400 border-zinc-800 hover:text-zinc-200'}`}
                >
                  ATHLETE
                </button>
                <button
                  type="button"
                  onClick={() => setRole('COACH')}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all border ${role === 'COACH' ? 'bg-mac-blue text-white border-mac-blue' : 'bg-zinc-900/50 text-zinc-400 border-zinc-800 hover:text-zinc-200'}`}
                >
                  COACH
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full bg-[#75ff9e] text-black font-black tracking-widest uppercase text-sm py-3.5 rounded-xl hover:bg-[#5ff088] transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="h-4 w-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
            ) : (
              isLoginMode ? 'AUTHENTICATE' : 'CREATE ACCOUNT'
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => {
              setIsLoginMode(!isLoginMode);
              setErrorMsg('');
            }}
            className="text-xs text-zinc-500 hover:text-white transition-colors"
          >
            {isLoginMode ? "Don't have an account? Register" : "Already have an account? Sign In"}
          </button>
        </div>
      </div>
    </div>
  );
};
