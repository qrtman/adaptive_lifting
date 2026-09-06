import React, { useState } from 'react';
import { Lock, Mail } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export const LoginView = () => {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStandardLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const formData = new URLSearchParams();
      formData.append('username', email);
      formData.append('password', password);

      const res = await fetch('http://localhost:8000/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
        credentials: 'include'
      });
      if (!res.ok) {
        throw new Error('Invalid credentials');
      }
      const data = await res.json();
      signIn(data.user);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const mockEmail = prompt('Enter mock Google email (e.g. coach):', 'coach');
      if (!mockEmail) {
        setLoading(false);
        return;
      }
      const token = `mock_google_token_${mockEmail.split('@')[0]}`;

      const res = await fetch('http://localhost:8000/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, role: 'COACH' }),
        credentials: 'include'
      });

      if (!res.ok) {
        throw new Error('Google authentication failed');
      }
      const data = await res.json();
      signIn(data.user);
    } catch (err: any) {
      setError(err.message || 'Google login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] p-4">
      <div className="w-full max-w-md bg-[#131313] border border-white/10 rounded-[8px] p-6 flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">Adaptive Lifting</h1>
          <p className="text-sm text-[#AEAEB2] mt-1">Sign in</p>
        </div>

        {error && (
          <div role="alert" className="border border-[#FF453A]/40 bg-[#FF453A]/10 text-[#FF453A] text-sm p-3 rounded-[8px]">
            {error}
          </div>
        )}

        <form onSubmit={handleStandardLogin} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-[#AEAEB2]">
            Email
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AEAEB2]" size={16} />
              <input
                type="email"
                autoComplete="username"
                placeholder="coach@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full min-h-12 bg-[#161616] border border-white/10 rounded-[8px] py-3 pl-10 pr-3 text-white placeholder:text-[#636366] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]"
                required
              />
            </div>
          </label>

          <label className="flex flex-col gap-1 text-xs text-[#AEAEB2]">
            Password
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AEAEB2]" size={16} />
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full min-h-12 bg-[#161616] border border-white/10 rounded-[8px] py-3 pl-10 pr-3 text-white placeholder:text-[#636366] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]"
                required
              />
            </div>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-12 bg-[#007AFF] hover:bg-[#0066d6] text-white rounded-[8px] disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full min-h-12 border border-white/10 bg-[#161616] text-white rounded-[8px] disabled:opacity-50"
        >
          Continue with Google
        </button>
      </div>
    </div>
  );
};
