import React from 'react';
import { Brain, Map, Play, Sparkles, Clock } from 'lucide-react';

export default function ExecutionPipeline({ isActive, currentPhase = 0, activePhaseDescription, thoughtTime = 0 }) {
  const phases = [
    { id: 0, label: 'Intent', icon: <Brain size={14} /> },
    { id: 1, label: 'Strategy', icon: <Map size={14} /> },
    { id: 2, label: 'Action', icon: <Play size={14} /> },
  ];

  if (!isActive) return null;

  return (
    <div className="execution-pipeline-v2">
      <div className="pipeline-header-v2">
        <div className="pipeline-title-v2">
          <Sparkles size={14} className="sparkle-icon-v2" />
          <span>Intelligence Hub</span>
        </div>
        <div className="pipeline-meta-v2">
          <div className="pipeline-time-v2">
            <Clock size={12} />
            <span>{thoughtTime}s</span>
          </div>
          <div className="pipeline-phase-label-v2">
            {phases[currentPhase]?.label}
          </div>
        </div>
      </div>

      <div className="neural-progress-track">
        <div 
          className="neural-progress-fill" 
          style={{ width: `${((currentPhase + 1) / phases.length) * 100}%` }}
        >
          <div className="neural-glow"></div>
        </div>
      </div>

      <div className="pipeline-status-v2">
        {activePhaseDescription || 'Orchestrating browser intelligence...'}
      </div>
    </div>
  );
}
