import React, { useState, useEffect } from 'react';
import { Target, Play, Trash2, Clock, CheckCircle2, Layout } from 'lucide-react';
import intentMemory from '../../engine/IntentMemory.js';
import { loadTasks } from '../../db.js';

export default function TaskDashboard({ tasks: propTasks, onResumeTask }) {
  const [tasks, setTasks] = useState(propTasks || []);

  useEffect(() => {
    if (propTasks) {
      setTasks(propTasks);
    } else {
      const fetchTasks = async () => {
        const savedTasks = await loadTasks();
        const allIntents = intentMemory.getActiveIntents();
        const merged = [...allIntents];
        savedTasks.forEach(st => {
          if (!merged.find(m => m.id === st.id)) merged.push(st);
        });
        setTasks(merged.sort((a, b) => b.updatedAt - a.updatedAt));
      };
      fetchTasks();
    }
  }, [propTasks]);

  const handleDelete = async (id) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  return (
    <div className="task-dashboard">
      <div className="dashboard-header">
        <div className="dashboard-header-title">
          <Target size={24} color="var(--accent)" />
          <h2>Intent Memory</h2>
        </div>
        <p>Your goals, remembered and ready to resume.</p>
      </div>

      <div className="task-grid">
        {tasks.map(task => (
          <div key={task.id} className={`task-card ${task.status}`}>
            <div className="task-card-header">
              <span className="task-tag">{task.priority}</span>
              <span className="task-time"><Clock size={12} /> {new Date(task.updatedAt).toLocaleDateString()}</span>
            </div>
            
            <h3 className="task-goal">{task.goal}</h3>
            
            <div className="task-meta">
              <div className="task-stat">
                <Layout size={14} />
                <span>{task.linkedTabs?.length || 0} tabs</span>
              </div>
              <div className="task-stat">
                <CheckCircle2 size={14} />
                <span>{task.completedSteps?.length || 0}/{task.steps?.length || 0} steps</span>
              </div>
            </div>

            <div className="task-actions">
              <button className="resume-btn" onClick={() => onResumeTask(task)}>
                <Play size={14} /> Resume Task
              </button>
              <button className="delete-btn" onClick={() => handleDelete(task.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}

        {tasks.length === 0 && (
          <div className="empty-dashboard">
            <Target size={40} className="opacity-20" />
            <p>No active tasks yet. Tell Charlie what you're trying to achieve!</p>
          </div>
        )}
      </div>
    </div>
  );
}
