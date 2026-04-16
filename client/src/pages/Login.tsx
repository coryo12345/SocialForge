import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import apiClient from '../api/client';
import { useSession } from '../store/useSession';
import type { User } from 'shared/types';

export default function Login() {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { setUser } = useSession();

  const loginMutation = useMutation({
    mutationFn: (u: string) =>
      apiClient.post<{ user: User }>('/auth/login', { username: u }).then((r) => r.data),
    onSuccess: (data) => {
      setUser(data.user);
      navigate('/');
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : 'Login failed';
      setError(msg ?? 'Login failed');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) {
      setError('Please enter a username');
      return;
    }
    setError('');
    loginMutation.mutate(trimmed);
  };

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link to="/" className="text-accent font-bold text-2xl">
            SocialForge
          </Link>
          <p className="text-text-secondary text-sm mt-2">Enter any username to continue</p>
        </div>

        <div className="bg-bg-secondary border border-border rounded-xl p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-text-primary mb-1.5">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your_username"
                autoFocus
                autoComplete="username"
                className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 text-text-primary placeholder-text-secondary text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
              />
              <p className="text-xs text-text-secondary mt-1">
                New account will be created if username doesn't exist.
              </p>
            </div>

            {error && (
              <p className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full bg-accent hover:bg-accent-hover disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition-colors"
            >
              {loginMutation.isPending ? 'Logging in…' : 'Log In / Sign Up'}
            </button>
          </form>
        </div>

        <p className="text-center mt-4 text-xs text-text-secondary">
          <Link to="/" className="hover:text-accent transition-colors">
            ← Back to feed
          </Link>
        </p>
      </div>
    </div>
  );
}
