import React from 'react';
import { 
  Zap, Activity, Monitor, Brain, Video, FileText, Search, Link, Sparkles, Send, Mic, Plus 
} from 'lucide-react';

const NewTabPage = ({ isIncognito, onNavigate, onSubmitAgentTask }) => {
  const ntpItems = [
    { text: 'Highlight', icon: <Zap size={14}/>, prompt: 'Give me the latest tech highlights and top news for today.' },
    { text: 'Trending', icon: <Activity size={14}/>, prompt: 'What is currently trending on the web? Show me hot topics and viral news.' },
    { text: 'Design', icon: <Monitor size={14}/>, prompt: 'Show me the latest UI/UX and web design trends for 2026.' },
    { text: 'Technology', icon: <Brain size={14}/>, prompt: 'Research the most important breakthroughs in AI and technology from the last 24 hours.' },
    { text: 'Video', icon: <Video size={14}/>, prompt: 'Find the most interesting new videos and creators on YouTube today.' },
    { text: 'News', icon: <FileText size={14}/>, prompt: 'Give me a summary of the top global news stories right now.' }
  ];

  const shortcuts = [
    { name: 'Instagram', url: 'instagram.com', icon: 'https://cdn-icons-png.flaticon.com/512/174/174855.png' },
    { name: 'TikTok', url: 'tiktok.com', icon: 'https://cdn-icons-png.flaticon.com/512/3046/3046121.png' },
    { name: 'YouTube', url: 'youtube.com', icon: 'https://cdn-icons-png.flaticon.com/512/1384/1384060.png' },
    { name: 'Facebook', url: 'facebook.com', icon: 'https://cdn-icons-png.flaticon.com/512/124/124010.png' },
    { name: 'Pinterest', url: 'pinterest.com', icon: 'https://cdn-icons-png.flaticon.com/512/145/145808.png' },
    { name: 'Behance', url: 'behance.net', icon: 'https://cdn-icons-png.flaticon.com/512/145/145799.png' },
    { name: 'DPOP Studio', url: 'google.com', icon: 'https://cdn-icons-png.flaticon.com/512/1051/1051262.png' },
    { name: 'Add', url: '', icon: null }
  ];

  return (
    <div className="new-tab-page-v3">
      <div className="ntp-top-toolbar">
        {ntpItems.map((item, idx) => (
          <div 
            key={item.text} 
            className={`ntp-pill ${idx === 0 ? 'active' : ''}`}
            onClick={() => onSubmitAgentTask(item.prompt)}
          >
            {item.icon} {item.text}
          </div>
        ))}
      </div>

      <div className="ntp-hero-v3">
        <h1 className="ntp-heading-v3">Find what you need or ask anything...</h1>
      </div>

      <div className="ntp-search-pill-container">
        <div className="ntp-search-pill-input">
          <Search size={22} color="#9ca3af" />
          <input 
            type="text" 
            placeholder="Type a website or anything here..." 
            onKeyDown={(e) => {
              if (e.key === 'Enter') onNavigate(e.target.value);
            }}
          />
        </div>
        <div className="ntp-search-pill-footer">
          <div className="ntp-pill-actions">
            <button className="ntp-mini-btn" onClick={() => onSubmitAgentTask("Analyze the current page and extract all useful links.")}><Link size={14}/> Link</button>
            <button className="ntp-mini-btn" onClick={() => onSubmitAgentTask("Help me with this website using AI.")}><Sparkles size={14}/> With AI</button>
            <button className="ntp-mini-btn" onClick={() => onSubmitAgentTask("Perform deep research on my search query.")}><Brain size={14}/> Deep Research</button>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Mic size={18} color="#9ca3af" style={{ cursor: 'pointer' }} />
            <button className="ntp-submit-btn-v3" onClick={() => {
              const input = document.querySelector('.ntp-search-pill-input input')?.value;
              if (input) onNavigate(input);
            }}>
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="ntp-shortcuts-grid">
        {shortcuts.map(site => (
          <div key={site.name} className="ntp-shortcut-card-v3" onClick={() => site.url && onNavigate(site.url)}>
            <div className="ntp-shortcut-icon-wrapper">
              {site.icon ? <img src={site.icon} alt={site.name} /> : <Plus size={24} color="#9ca3af" />}
            </div>
            <span className="ntp-shortcut-text">{site.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default NewTabPage;
