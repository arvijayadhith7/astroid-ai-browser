import React, { useState, useEffect, useRef } from 'react';
import { WifiOff, Search, History, Bookmark, Activity, Play, RefreshCw, Zap } from 'lucide-react';
import { savePreference, loadPreference } from '../../db';

const OfflineExperience = ({ onSearchLocal, onNavigate, bookmarks = [], history = [] }) => {
  const [gameState, setGameState] = useState('idle'); // idle, playing
  const [searchQuery, setSearchQuery] = useState('');
  const [highScore, setHighScore] = useState(0);
  const canvasRef = useRef(null);
  
  // Load High Score from DB on mount
  useEffect(() => {
    const loadScore = async () => {
      const score = await loadPreference('neural_pong_score');
      if (score !== null) setHighScore(parseInt(score));
      else {
        // Fallback to localStorage if available (migration)
        const local = localStorage.getItem('neural_pong_score');
        if (local) setHighScore(parseInt(local));
      }
    };
    loadScore();
  }, []);

  // Derived state for local search
  const filteredHistory = history.filter(item => 
    item.title?.toLowerCase().includes(searchQuery.toLowerCase()) || 
    item.url?.toLowerCase().includes(searchQuery.toLowerCase())
  ).slice(0, 5);

  const filteredBookmarks = bookmarks.filter(item => 
    item.title?.toLowerCase().includes(searchQuery.toLowerCase()) || 
    item.url?.toLowerCase().includes(searchQuery.toLowerCase())
  ).slice(0, 5);
  
  // Minimalist 'Neural Pong' Game Logic
  useEffect(() => {
    if (gameState !== 'playing' || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationFrameId;
    
    let ball = { x: 200, y: 150, dx: 3, dy: 3, radius: 5 };
    let paddle = { y: 100, height: 60, width: 6 };
    let score = 0;
    
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw Grid Lines (Premium Aesthetic)
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.05)';
      for(let i=0; i<canvas.width; i+=20) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, canvas.height); ctx.stroke();
      }
      
      // Draw Paddle
      ctx.fillStyle = '#f59e0b';
      ctx.shadowBlur = 15;
      ctx.shadowColor = 'rgba(245, 158, 11, 0.5)';
      ctx.fillRect(10, paddle.y, paddle.width, paddle.height);
      
      // Draw Ball
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fillStyle = 'white';
      ctx.fill();
      
      // Move Ball
      ball.x += ball.dx;
      ball.y += ball.dy;
      
      // Walls
      if (ball.y + ball.radius > canvas.height || ball.y - ball.radius < 0) ball.dy *= -1;
      if (ball.x + ball.radius > canvas.width) ball.dx *= -1;
      
      // Paddle Collision
      if (ball.x - ball.radius <= 20 && ball.y >= paddle.y && ball.y <= paddle.y + paddle.height) {
        ball.dx = Math.abs(ball.dx) * 1.05; // Gentle speed up
        score++;
      }
      
      // Reset
      if (ball.x < 0) {
        if (score > highScore) {
          setHighScore(score);
          savePreference('neural_pong_score', score.toString());
          localStorage.setItem('neural_pong_score', score.toString());
        }
        setGameState('idle');
        return;
      }
      
      animationFrameId = requestAnimationFrame(render);
    };
    
    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      paddle.y = Math.max(0, Math.min(canvas.height - paddle.height, e.clientY - rect.top - paddle.height/2));
    };
    
    canvas.addEventListener('mousemove', handleMouseMove);
    render();
    
    return () => {
      cancelAnimationFrame(animationFrameId);
      canvas.removeEventListener('mousemove', handleMouseMove);
    };
  }, [gameState, highScore]);

  return (
    <div className="offline-experience">
      <div className="offline-hero">
        <div className="radar-container">
          <div className="radar-circle pulse-1"></div>
          <div className="radar-circle pulse-2"></div>
          <div className="radar-circle pulse-3"></div>
          <WifiOff size={48} className="offline-icon" />
        </div>
        <h1>Connectivity Pulse</h1>
        <p>Your workspace is syncing locally...</p>
        
        <div className="reconnect-pill">
          <RefreshCw size={14} className="spin" />
          <span>Listening for network heartbeat...</span>
        </div>
      </div>

      <div className="offline-grid">
        <div className="offline-card search-card">
          <div className="card-header">
            <Search size={18} />
            <span>Local Intelligence Search</span>
          </div>
          <div className="offline-search-input">
            <input 
              type="text" 
              placeholder="Search saved intents, history..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          {(filteredHistory.length > 0 || filteredBookmarks.length > 0) && searchQuery && (
            <div className="search-results-mini">
              {filteredBookmarks.map((bm, i) => (
                <div key={i} className="mini-result" onClick={() => onNavigate(bm.url)}>
                  <Bookmark size={12} />
                  <span>{bm.title}</span>
                </div>
              ))}
              {filteredHistory.map((h, i) => (
                <div key={i} className="mini-result" onClick={() => onNavigate(h.url)}>
                  <History size={12} />
                  <span>{h.title}</span>
                </div>
              ))}
            </div>
          )}

          <div className="search-stats">
            <span>{history.length} History Logs</span>
            <span>{bookmarks.length} Favorites</span>
          </div>
        </div>

        <div className="offline-card game-card">
          <div className="card-header">
            <Activity size={18} />
            <span>Neural Pong</span>
            <span className="high-score-tag">High: {highScore}</span>
          </div>
          {gameState === 'idle' ? (
            <div className="game-overlay" onClick={() => setGameState('playing')}>
              <Play size={32} />
              <span>Initiate Training</span>
            </div>
          ) : (
            <canvas ref={canvasRef} width={400} height={200} className="pong-canvas" />
          )}
        </div>

        <div className="offline-card quick-access">
          <div className="card-header">
            <Zap size={18} />
            <span>Productivity Shortcuts</span>
          </div>
          <div className="access-links">
            <button className="access-btn" onClick={() => onSearchLocal('show history')}><History size={14}/> View Full History</button>
            <button className="access-btn" onClick={() => onSearchLocal('show bookmarks')}><Bookmark size={14}/> Browse Bookmarks</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OfflineExperience;

