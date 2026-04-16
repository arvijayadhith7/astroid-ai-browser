import React, { useState, useEffect } from 'react';
import { Sparkles, FileText, Zap, ChevronRight, Activity } from 'lucide-react';
import intentMemory from '../../engine/IntentMemory.js';
import messageBus from '../../engine/MessageBus.js';

export default function AutoSummaryPanel({ activeTab, settings }) {
  const [summary, setSummary] = useState("");
  const [insights, setInsights] = useState([]);
  const [isSummarizing, setIsSummarizing] = useState(false);

  useEffect(() => {
    const handleActivity = async (activity) => {
      if (activity.tabId === activeTab?.id && activity.action === 'navigate') {
        generateSummary(activeTab);
      }
    };

    messageBus.subscribe('memory.activity.logged', handleActivity);
    return () => messageBus.unsubscribe('memory.activity.logged', handleActivity);
  }, [activeTab?.id]);

  const generateSummary = async (tab) => {
    if (!tab || tab.url.startsWith('internal://')) return;
    
    setIsSummarizing(true);
    // In a real app, we'd call the AI engine here.
    // For now, let's simulate a summary capture.
    setTimeout(() => {
      setSummary(`Summary of ${tab.title}: This page explores ${tab.url.split('/')[2]} with a focus on user experience and agentic capabilities.`);
      setInsights([
        "Matches your current goal: 'Researching Browser Features'",
        "Related to 3 other tabs in this session",
        "Key takeaway: Modern browsers require context-aware sidebars"
      ]);
      setIsSummarizing(false);
    }, 1500);
  };

  if (!activeTab || activeTab.url.startsWith('internal://')) {
    return (
      <div className="summary-panel-empty">
        <Sparkles size={24} className="opacity-50" />
        <p>Open a page to see AI insights</p>
      </div>
    );
  }

  return (
    <div className="auto-summary-panel">
      <div className="summary-section">
        <div className="section-header">
          <FileText size={16} />
          <span>Page Summary</span>
          {isSummarizing && <Activity size={12} className="spin ml-auto" />}
        </div>
        <div className="summary-content">
          {isSummarizing ? (
            <div className="skeleton-text">
               <div className="skeleton-line"></div>
               <div className="skeleton-line" style={{ width: '80%' }}></div>
            </div>
          ) : (
            summary && <p>{summary}</p>
          )}
          {!isSummarizing && !summary && (
            <div className="summary-placeholder">
              <Sparkles size={16} style={{ opacity: 0.3 }} />
              <span>Ready to analyze this page...</span>
            </div>
          )}
        </div>
      </div>

      <div className="insights-section">
        <div className="section-header">
          <Zap size={16} />
          <span>Contextual Insights</span>
        </div>
        <div className="insights-list">
          {insights.map((insight, i) => (
            <div key={i} className="insight-item">
              <ChevronRight size={12} />
              <span>{insight}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
