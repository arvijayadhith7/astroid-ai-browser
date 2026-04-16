import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  Activity, 
  Clock, 
  ShieldCheck, 
  TrendingUp, 
  X, 
  ChevronRight,
  Brain,
  Zap,
  Target,
  Download
} from 'lucide-react';
import contextEngine from '../../engine/ContextEngine';
import personalizationAgent from '../../engine/agents/PersonalizationAgent';
import { loadDownloads } from '../../db.js';

const IntelligenceDashboard = ({ isOpen, onClose }) => {
  const [stats, setStats] = useState({
    modeTimes: {},
    preferences: {},
    crossTab: {},
    totalDownloaded: 0
  });

  useEffect(() => {
    if (isOpen) {
      const updateData = async () => {
        const downloads = await loadDownloads();
        const totalBytes = downloads.reduce((acc, dl) => acc + (dl.totalBytes || 0), 0);

        setStats({
          modeTimes: contextEngine.getModeTimeSummary(),
          preferences: personalizationAgent.getPreferenceSummary(),
          crossTab: contextEngine.getCrossTabState(),
          totalDownloaded: totalBytes
        });
      };
      updateData();
      const interval = setInterval(updateData, 2000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const totalTimeMs = Object.values(stats.modeTimes).reduce((a, b) => a + b, 0);
  const formatTime = (ms) => {
    const mins = Math.floor(ms / 60000);
    const hours = Math.floor(mins / 60);
    return hours > 0 ? `${hours}h ${mins % 60}m` : `${mins}m`;
  };

  const getPercentage = (ms) => {
    if (totalTimeMs === 0) return 0;
    return Math.round((ms / totalTimeMs) * 100);
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const modeColors = {
    work: '#6366f1',
    browsing: '#94a3b8',
    entertainment: '#f59e0b',
    study: '#10b981',
    shopping: '#ec4899',
    social: '#3b82f6',
    email: '#8b5cf6'
  };

  return (
    <div className="dashboard-overlay">
      <div className="dashboard-container">
        {/* Header */}
        <div className="dashboard-header">
          <div className="header-left">
            <div className="header-icon-ring">
              <Zap size={20} className="text-yellow-400" />
            </div>
            <div>
              <h2>Intelligence Dashboard</h2>
              <p>Asteroid Insight Engine v1.0</p>
            </div>
          </div>
          <button className="close-dashboard-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Content Grid */}
        <div className="dashboard-grid">
          
          {/* Main Chart Section */}
          <div className="dashboard-card main-chart-card">
            <div className="card-header">
              <BarChart3 size={18} />
              <h3>Activity Breakdown</h3>
            </div>
            <div className="time-summary">
              <div className="main-time">{formatTime(totalTimeMs)}</div>
              <div className="time-label">Total Focused Browsing</div>
            </div>
            <div className="chart-bars">
              {Object.entries(stats.modeTimes)
                .sort((a, b) => b[1] - a[1])
                .map(([mode, time]) => (
                <div key={mode} className="mode-bar-group">
                  <div className="mode-bar-info">
                    <span className="mode-name">{mode}</span>
                    <span className="mode-time">{formatTime(time)} ({getPercentage(time)}%)</span>
                  </div>
                  <div className="mode-bar-track">
                    <div 
                      className="mode-bar-fill" 
                      style={{ 
                        width: `${getPercentage(time)}%`,
                        backgroundColor: modeColors[mode.toLowerCase()] || '#94a3b8'
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Intelligence Card */}
          <div className="dashboard-card intel-card">
            <div className="card-header">
              <Brain size={18} />
              <h3>AI Habit Learning</h3>
            </div>
            <div className="intelligence-content">
              <div className="intel-stat">
                <div className="stat-icon"><Activity size={16} /></div>
                <div className="stat-details">
                  <div className="stat-label">Frequent Focus</div>
                  <div className="stat-value text-blue-400">{stats.preferences.intelligence?.focus || 'Calibrating...'}</div>
                </div>
              </div>
              <div className="prediction-box">
                <div className="prediction-label">Proactive Prompt</div>
                <p className="prediction-text">"{stats.preferences.intelligence?.proactivePrompt}"</p>
              </div>
              <div className="suggested-list">
                <div className="list-title">Suggested Sites</div>
                {stats.preferences.suggestedNow?.map(site => (
                  <div key={site} className="site-item">
                    <TrendingUp size={12} className="text-emerald-400" />
                    <span>{site}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick Metrics Section */}
          <div className="dashboard-card metrics-card">
             <div className="metric-box">
              <Clock size={16} />
              <div className="metric-info">
                <div className="metric-val">{stats.crossTab.totalTabs}</div>
                <div className="metric-label">Active Tabs</div>
              </div>
            </div>
            <div className="metric-box">
              <ShieldCheck size={16} className="text-emerald-400" />
              <div className="metric-info">
                <div className="metric-val">{stats.preferences.totalActions || 0}</div>
                <div className="metric-label">Agent Actions</div>
              </div>
            </div>
            <div className="metric-box">
              <Target size={16} className="text-purple-400" />
              <div className="metric-info">
                <div className="metric-val">{stats.crossTab.dominantMode || 'None'}</div>
                <div className="metric-label">Dominant Mode</div>
              </div>
            </div>
            <div className="metric-box">
              <Download size={16} className="text-orange-400" />
              <div className="metric-info">
                <div className="metric-val">{formatBytes(stats.totalDownloaded)}</div>
                <div className="metric-label">Data Downloaded</div>
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="dashboard-footer">
          <div className="footer-privacy">
            <ShieldCheck size={14} className="text-emerald-500" />
            <span>Local Processing Only — No data leaves Asteroid</span>
          </div>
          <button className="focus-mode-btn">
            <span>Enable Focus Mode</span>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default IntelligenceDashboard;
