import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, User, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const result = await login(username, password);
      if (result.success) {
        navigate('/overview');
      } else {
        setError(result.error || 'Invalid username or password');
      }
    } catch (err) {
      setError('An error occurred during login');
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'var(--app-bg)' }}
    >
      <div
        className="w-full max-w-[380px] rounded-xl p-8 flex flex-col items-center"
        style={{ background: 'var(--app-surface)', border: '1px solid var(--app-border)' }}
      >
        {/* Logo mark */}
        <div
          className="flex items-center justify-center rounded-xl mb-5 font-mono text-[13px] font-semibold text-white tracking-tight"
          style={{ width: 52, height: 52, background: 'var(--app-accent)', letterSpacing: '-0.3px' }}
        >
          I/O
        </div>

        <h1 className="text-[20px] font-semibold mb-1 text-center" style={{ color: 'var(--app-text-1)' }}>
          Faclon I/OConnect
        </h1>
        <p className="text-[13.5px] mb-7 text-center" style={{ color: 'var(--app-text-3)' }}>
          Gateway management portal
        </p>

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
          {error && (
            <div
              className="px-4 py-3 rounded-lg text-[13px]"
              style={{ background: 'var(--app-danger-sub)', color: 'var(--app-danger)' }}
            >
              {error}
            </div>
          )}

          {/* Username */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium" style={{ color: 'var(--app-text-1)' }}>
              Username
            </label>
            <div className="relative">
              <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--app-text-3)' }} />
              <input
                type="text"
                required
                autoFocus
                autoComplete="username"
                placeholder="Your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg text-[13.5px] outline-none"
                style={{
                  background: 'var(--app-elevated)',
                  border: '1px solid var(--app-border-mid)',
                  color: 'var(--app-text-1)',
                }}
                onFocus={e => e.target.style.borderColor = 'var(--app-accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--app-border-mid)'}
              />
            </div>
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium" style={{ color: 'var(--app-text-1)' }}>
              Password
            </label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--app-text-3)' }} />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-9 pr-10 py-2 rounded-lg text-[13.5px] outline-none"
                style={{
                  background: 'var(--app-elevated)',
                  border: '1px solid var(--app-border-mid)',
                  color: 'var(--app-text-1)',
                }}
                onFocus={e => e.target.style.borderColor = 'var(--app-accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--app-border-mid)'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--app-text-3)' }}
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-2.5 rounded-lg text-[13.5px] font-semibold text-white mt-1 transition-opacity duration-[130ms] hover:opacity-90"
            style={{ background: 'var(--app-accent)' }}
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
