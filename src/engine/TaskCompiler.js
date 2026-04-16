/**
 * TaskCompiler — NL-to-execution pipeline.
 * Parses user input → classifies intent → generates task DAG.
 * Each node: { id, action, params, retries, fallback, status, dependencies }
 * Real-time progress tracking with event emission.
 */
import messageBus from './MessageBus.js';

const TASK_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETE: 'complete',
  FAILED: 'failed',
  SKIPPED: 'skipped'
};

class TaskCompiler {
  constructor() {
    this.tasks = new Map(); // taskId -> compiled task
  }

  compile(plan) {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const steps = plan.steps.map(step => ({
      ...step,
      status: TASK_STATUS.PENDING,
      startedAt: null,
      completedAt: null,
      result: null,
      error: null
    }));

    const compiledTask = {
      id: taskId,
      goal: plan.goal,
      steps,
      status: TASK_STATUS.PENDING,
      progress: 0,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null
    };

    this.tasks.set(taskId, compiledTask);
    messageBus.publish('task.compiled', compiledTask);
    return compiledTask;
  }

  getReadySteps(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return [];

    return task.steps.filter(step => {
      if (step.status !== TASK_STATUS.PENDING) return false;
      // Check all dependencies are completed
      const deps = step.dependsOn || [];
      return deps.every(depId => {
        const depStep = task.steps.find(s => s.id === depId);
        return depStep && depStep.status === TASK_STATUS.COMPLETE;
      });
    });
  }

  markStepRunning(taskId, stepId) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const step = task.steps.find(s => s.id === stepId);
    if (step) {
      step.status = TASK_STATUS.RUNNING;
      step.startedAt = Date.now();
      task.status = TASK_STATUS.RUNNING;
      if (!task.startedAt) task.startedAt = Date.now();
      this._updateProgress(taskId);
      messageBus.publish('task.step.running', { taskId, stepId, step });
    }
  }

  markStepComplete(taskId, stepId, result) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const step = task.steps.find(s => s.id === stepId);
    if (step) {
      step.status = TASK_STATUS.COMPLETE;
      step.completedAt = Date.now();
      step.result = result;
      this._updateProgress(taskId);
      messageBus.publish('task.step.complete', { taskId, stepId, result });

      // Check if all steps done
      if (task.steps.every(s => s.status === TASK_STATUS.COMPLETE || s.status === TASK_STATUS.SKIPPED)) {
        task.status = TASK_STATUS.COMPLETE;
        task.completedAt = Date.now();
        messageBus.publish('task.completed', task);
      }
    }
  }

  markStepFailed(taskId, stepId, error) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const step = task.steps.find(s => s.id === stepId);
    if (step) {
      step.status = TASK_STATUS.FAILED;
      step.completedAt = Date.now();
      step.error = error;
      this._updateProgress(taskId);
      messageBus.publish('task.step.failed', { taskId, stepId, error });

      // Check if we should fail the whole task
      const hasFallback = step.fallback;
      if (!hasFallback) {
        // Skip dependent steps
        for (const s of task.steps) {
          if ((s.dependsOn || []).includes(stepId) && s.status === TASK_STATUS.PENDING) {
            s.status = TASK_STATUS.SKIPPED;
          }
        }
      }

      if (task.steps.every(s => [TASK_STATUS.COMPLETE, TASK_STATUS.FAILED, TASK_STATUS.SKIPPED].includes(s.status))) {
        task.status = task.steps.some(s => s.status === TASK_STATUS.FAILED) ? TASK_STATUS.FAILED : TASK_STATUS.COMPLETE;
        task.completedAt = Date.now();
        messageBus.publish('task.completed', task);
      }
    }
  }

  _updateProgress(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const done = task.steps.filter(s => [TASK_STATUS.COMPLETE, TASK_STATUS.FAILED, TASK_STATUS.SKIPPED].includes(s.status)).length;
    task.progress = Math.round((done / task.steps.length) * 100);
    messageBus.publish('task.progress', { taskId, progress: task.progress });
  }

  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  getAllTasks() {
    return Array.from(this.tasks.values());
  }

  getActiveTasks() {
    return this.getAllTasks().filter(t => t.status === TASK_STATUS.RUNNING || t.status === TASK_STATUS.PENDING);
  }
}

export { TASK_STATUS };
export default TaskCompiler;
