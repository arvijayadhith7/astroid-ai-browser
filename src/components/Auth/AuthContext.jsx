import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing session
    const savedUser = localStorage.getItem('asteroid_user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    } else {
      // Default to Guest user to remove mandatory authentication page
      setUser({ id: 'guest', name: 'Guest User', email: 'guest@asteroid.ai', avatar: null });
    }
    setLoading(false);
  }, []);

  const signup = async (email, password, name) => {
    setLoading(true);
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const users = JSON.parse(localStorage.getItem('asteroid_users') || '[]');
    if (users.find(u => u.email === email)) {
      setLoading(false);
      throw new Error('User already exists');
    }

    const newUser = { id: Date.now().toString(), email, name, password };
    users.push(newUser);
    localStorage.setItem('asteroid_users', JSON.stringify(users));
    
    // Auto login
    const sessionUser = { id: newUser.id, email: newUser.email, name: newUser.name };
    localStorage.setItem('asteroid_user', JSON.stringify(sessionUser));
    setUser(sessionUser);
    setLoading(false);
    return sessionUser;
  };

  const login = async (email, password) => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1200));
    
    const users = JSON.parse(localStorage.getItem('asteroid_users') || '[]');
    const user = users.find(u => u.email === email && u.password === password);
    
    if (!user) {
      setLoading(false);
      throw new Error('Invalid email or password');
    }

    const sessionUser = { id: user.id, email: user.email, name: user.name };
    localStorage.setItem('asteroid_user', JSON.stringify(sessionUser));
    setUser(sessionUser);
    setLoading(false);
    return sessionUser;
  };

  const loginWithGitHub = async () => {
    setLoading(true);
    try {
      if (!window.electronAPI) throw new Error('GitHub Login is only available in the desktop app.');
      const profile = await window.electronAPI.invoke('auth:github-login');
      
      const sessionUser = { 
        id: profile.id, 
        email: profile.email, 
        name: profile.name, 
        avatar: profile.picture,
        provider: 'github'
      };
      
      localStorage.setItem('asteroid_user', JSON.stringify(sessionUser));
      setUser(sessionUser);
      return sessionUser;
    } catch (err) {
      console.error('GitHub Login Error:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('asteroid_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, loading, login, signup, logout, loginWithGitHub }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
