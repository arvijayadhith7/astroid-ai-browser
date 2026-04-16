import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal, 
  Cpu, 
  Globe, 
  ShieldAlert, 
  Layers, 
  Activity, 
  Info, 
  Search,
  ExternalLink,
  Lock,
  Zap,
  Box,
  Layout,
  X
} from 'lucide-react';
import messageBus from '../../engine/MessageBus';
import contextEngine from '../../engine/ContextEngine';

const AdminDashboard = ({ isOpen, onClose }) => {
  const [events, setEvents] = useState([]);
  const [tabContexts, setTabContexts] = useState([]);
  const [agentStatus, setAgentStatus] = useState({
    orchestrator: 'idle',
    planner: 'idle',
    action: 'idle',
    researcher: 'idle'
  });
  const terminalRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      // Initialize data
      setEvents(messageBus.getHistory(null, 50));
      setTabContexts(contextEngine.getAllTabContexts());

      // Subscribe to all events for the live console
      const subId = messageBus.subscribe('*', (payload, event) => {
        setEvents(prev => [...prev.slice(-49), event]);
        
        // Update agent status based on event channels
        if (event.channel.startsWith('agent.')) {
          const parts = event.channel.split('.');
          const agent = parts[1];
          const state = parts[2] === 'started' ? 'active' : 'idle';
          setAgentStatus(prev => ({ ...prev, [agent]: state }));
        }

        // Update tab contexts if relevant
        if (event.channel.startsWith('context.tab')) {
          setTabContexts(contextEngine.getAllTabContexts());
        }
      });

      return () => messageBus.unsubscribe('*', subId);
    }
  }, [isOpen]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [events]);

  if (!isOpen) return null;

  const getOriginStats = () => {
    const origins = {};
    tabContexts.forEach(tab => {
      try {
        const url = new URL(tab.url);
        origins[url.hostname] = (origins[url.hostname] || 0) + 1;
      } catch (e) {}
    });
    return Object.entries(origins).sort((a, b) => b[1] - a[1]);
  };

  return (
    <div className="admin-dashboard-overlay">
      <div className="admin-dashboard-container">
        
        {/* Header */}
        <div className="admin-header">
          <div className="admin-header-left">
            <div className="admin-icon-ring">
              <Cpu size={20} className="text-purple-400" />
            </div>
            <div>
              <h3>Asteroid Admin Console</h3>
              <p>Core Engine Monitor v1.2.0 • Real-time Data Flow</p>
            </div>
          </div>
          <div className="admin-header-right">
            <div className="status-badge">
              <Activity size={14} className="pulse-icon" />
              <span>Engine Online</span>
            </div>
            <button className="admin-close-btn" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Layout Grid */}
        <div className="admin-grid">
          
          {/* Main Monitor - Event Console */}
          <div className="admin-card console-card">
            <div className="admin-card-header">
              <Terminal size={18} />
              <h4>Live Message Bus Event Stream</h4>
            </div>
            <div className="terminal-window" ref={terminalRef}>
              {events.length === 0 && <div className="terminal-empty">Waiting for events...</div>}
              {events.map((ev, i) => (
                <div key={i} className="terminal-line">
                  <span className="terminal-time">[{new Date(ev.timestamp).toLocaleTimeString()}]</span>
                  <span className={`terminal-channel channel-${ev.channel.split('.')[0]}`}>{ev.channel}</span>
                  <span className="terminal-payload">{JSON.stringify(ev.payload).slice(0, 120)}...</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column - System Metadata */}
          <div className="admin-sidebar">
            
            {/* Agent Status Board */}
            <div className="admin-card status-card">
              <div className="admin-card-header">
                < Zap size={18} className="text-yellow-400" />
                <h4>Agent Runtime Status</h4>
              </div>
              <div className="agent-status-grid">
                {Object.entries(agentStatus).map(([name, state]) => (
                  <div key={name} className={`agent-item ${state}`}>
                    <div className="agent-indicator" />
                    <span className="agent-name">{name.toUpperCase()}</span>
                    <span className="agent-state">{state}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Network Origins */}
            <div className="admin-card origins-card">
              <div className="admin-card-header">
                <Globe size={18} className="text-blue-400" />
                <h4>Data Pipeline Origins</h4>
              </div>
              <div className="origins-list">
                {getOriginStats().map(([host, count]) => (
                  <div key={host} className="origin-item">
                    <span className="origin-host">{host}</span>
                    <span className="origin-count">{count} {count === 1 ? 'tab' : 'tabs'}</span>
                  </div>
                ))}
                {tabContexts.length === 0 && <div className="no-data">No active origins</div>}
              </div>
            </div>

          </div>

          {/* Bottom Row - Tab Topology */}
          <div className="admin-card topology-card">
            <div className="admin-card-header">
              <Layers size={18} className="text-emerald-400" />
              <h4>Tab Intelligence Topology</h4>
            </div>
            <div className="topology-grid">
              {tabContexts.map(tab => (
                <div key={tab.tabId} className="topology-node">
                  <div className="node-icon">
                    {tab.mode === 'work' ? <Box size={14} /> : <Globe size={14} />}
                  </div>
                  <div className="node-content">
                    <div className="node-title">{tab.title || 'Empty Tab'}</div>
                    <div className="node-meta">
                      <span className="node-id">ID: {tab.tabId.slice(0, 8)}</span>
                      <span className={`node-mode mode-${tab.mode}`}>{tab.mode}</span>
                      <span className="node-score">Audit: {tab.privacyScore}%</span>
                    </div>
                  </div>
                  <div className="node-stats">
                    <div className="node-stat" title="Interactive Elements">
                      <Layout size={12} /> {tab.interactive?.length || 0}
                    </div>
                  </div>
                </div>
              ))}
              {tabContexts.length === 0 && <div className="no-data">No tabs currently analyzed</div>}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="admin-footer">
          <div className="footer-info">
            <ShieldAlert size={14} className="text-yellow-500" />
            <span>Telemetry Active • Local Engine Only</span>
          </div>
          <div className="engine-version">asteroid-core-v1.2.0-stable</div>
        </div>

      </div>
    </div>
  );
};

export default AdminDashboard;
