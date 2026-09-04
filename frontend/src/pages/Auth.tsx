import { useState } from 'react';
import { api, ApiError } from '../lib/api';

interface AuthProps {
  onLogin: () => void;
}

export function Auth({ onLogin }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/signup';
      const data = await api.post(endpoint, { email, password });
      localStorage.setItem('token', data.token);
      onLogin();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-4">
      <div className="w-full max-w-sm bg-white rounded-md p-8 shadow-sm border border-muted/20">
        <h1 className="font-display text-2xl mb-6 text-center text-ink">
          {isLogin ? 'Sign in to Cue' : 'Create an account'}
        </h1>
        
        {error && (
          <div className="bg-fall/10 text-fall p-3 rounded-md mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-muted/30 rounded-md focus:outline-none focus:border-accent"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-muted/30 rounded-md focus:outline-none focus:border-accent"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent text-white py-2 rounded-md hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'Please wait...' : (isLogin ? 'Sign in' : 'Sign up')}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-accent hover:underline"
          >
            {isLogin ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
