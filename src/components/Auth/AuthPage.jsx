import React, { useState } from 'react';
import { Mail, Lock, User, ArrowRight, Shield, Sparkles, Orbit, Globe, Terminal } from 'lucide-react';
import { useAuth } from './AuthContext';

const AuthPage = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  
  const { login, signup, loading, loginWithGitHub } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await signup(email, password, name);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setError('');
  };

  return (
    <div className="auth-container">
      {/* Animated Background */}
      <div className="auth-bg-blobs">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
        <div className="blob blob-3"></div>
      </div>
      
      <div className="auth-card-wrapper">
        <div className={`auth-glass-card ${loading ? 'auth-loading' : ''} ${error ? 'auth-error-shake' : ''}`}>
          <div className="auth-header">
            <div className="auth-logo">
              <div className="logo-icon">
                <Orbit size={32} />
              </div>
              <h1>Asteroid</h1>
            </div>
            <p className="auth-subtitle">
              {isLogin ? 'Welcome back to the future of browsing' : 'Join the intelligence revolution'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            {!isLogin && (
              <div className="auth-input-group">
                <label><User size={16} /> Full Name</label>
                <input 
                  type="text" 
                  placeholder="Enter your name" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required 
                />
              </div>
            )}
            
            <div className="auth-input-group">
              <label><Terminal size={16} /> GitHub ID</label>
              <input 
                type="text" 
                placeholder="Enter your GitHub username" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required 
              />
            </div>

            <div className="auth-input-group">
              <label><Lock size={16} /> Password</label>
              <input 
                type="password" 
                placeholder="••••••••" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required 
              />
            </div>

            {error && <div className="auth-error-msg">{error}</div>}

            <button type="submit" className="auth-submit-btn" disabled={loading}>
              {loading ? (
                <span className="auth-spinner"></span>
              ) : (
                <>
                  {isLogin ? 'Login' : 'Create Account'}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <div className="auth-divider">
            <span>OR CONTINUE WITH</span>
          </div>

          <div className="auth-social-grid" style={{ display: 'flex', justifyContent: 'center' }}>
            <button 
              className="social-btn" 
              onClick={() => loginWithGitHub().catch(err => setError(err.message))}
              disabled={loading}
              style={{ width: 'auto', padding: '10px 24px' }}
            >
              <img src="https://www.google.com/s2/favicons?sz=64&domain_url=github.com" alt="" style={{ width: 18, height: 18 }} />
              Login with GitHub
            </button>
          </div>

          <div className="auth-footer">
            <p>
              {isLogin ? "Don't have an account?" : "Already have an account?"}{' '}
              <button onClick={toggleMode} className="auth-toggle-btn">
                {isLogin ? 'Sign up' : 'Log in'}
              </button>
            </p>
          </div>

          <div className="security-verified-badge">
            <Shield size={14} fill="#22c55e" color="#22c55e" />
            <span>Google Security Verified</span>
          </div>
        </div>

        <div className="auth-features-sidebar">
          <div className="feature-item">
            <div className="feature-icon"><Sparkles size={20} /></div>
            <div className="feature-text">
              <h4>AI-Driven Automation</h4>
              <p>Self-driving browser agents that handle your complex workflows.</p>
            </div>
          </div>
          <div className="feature-item">
            <div className="feature-icon"><Shield size={20} /></div>
            <div className="feature-text">
              <h4>Advanced Privacy</h4>
              <p>Built-in firewall and InPrivate mode protection.</p>
            </div>
          </div>
          <div className="feature-item">
            <div className="feature-icon"><Orbit size={20} /></div>
            <div className="feature-text">
              <h4>Cross-Device Sync</h4>
              <p>Sync your bookmarks and intents seamlessly.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
