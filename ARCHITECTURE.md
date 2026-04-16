# Asteroid - System Architecture

Asteroid is a professional-grade, self-driving multi-agent browser. It is built to bridge the gap between human browsing and AI-driven automation using a layered intelligence architecture.

## 1. Core Intelligence Layers

Asteroid's intelligence is distributed across 4 specialized agents coordinated by a central orchestrator.

### 1.1 Agent Orchestrator
The **Agent Orchestrator** is the "brain" of the system. It handles the lifecycle of user requests:
- **Phase 0 (Intent parsing)**: Quickly classifies requests (Simple vs. Complex).
- **Phase 1 (Planning)**: Dispatches complex requests to the Planning Agent.
- **Phase 2 (Execution)**: Manages the Task Compiler and Action Agent to execute steps.
- **Phase 3 (Recovery)**: Handles failures by triggering Research Agent diagnosis or finding alternative selectors.

### 1.2 Specialized Agents
- **Planning Agent**: Decomposes natural language into a **Directed Acyclic Graph (DAG)** of tasks (GOTO, CLICK, TYPE, etc.). It uses an LLM-backed strategy with a heuristic fallback.
- **Action Agent**: The hands of the system. It interacts directly with the Chromium engine (Electron WebViews) to perform clicks, navigation, and media control.
- **Research Agent**: Performs deep page analysis, semantic extraction, summarization, and autonomous failure diagnosis (e.g., "The button is hidden under an overlay").
- **Personalization Agent**: Learns user preferences over time (e.g., "User prefers Dark Mode for work", "User watches Bloomberg at 9 AM").

---

## 2. Engine & Communication

### 2.1 The Message Bus
Communication between agents is strictly decoupled via a **Pub/Sub Message Bus**. 
- Agents emit events like `agent.planning.started`, `task.step.failed`, or `context.mode.changed`.
- This allows real-time UI updates (the Task Dashboard) and logs without direct agent-to-agent coupling.

### 2.2 Context Engine
The **Context Engine** monitors browser state to categorize the current active tab into "Intent Modes":
- `Work`: URL patterns matching corporate tools (GitHub, Slack).
- `Entertainment`: Media-heavy sites (YouTube, Netflix).
- `Research`: Educational or news-oriented content.
This context is passed to the LLM to improve reasoning accuracy (e.g., "Search this" means search the *current* wiki, not the whole web).

---

## 3. Persistence & Data Model

Asteroid leverages **IndexedDB** as its primary persistent store, organized into several specialized buckets:

| Store | Purpose |
|-------|---------|
| `history` | Browsing logs with timestamps. |
| `intents` | Record of every user intent and its outcome. |
| `tasks` | Persisted DAGs of completed or running workflows. |
| `preferences` | Configuration and learned user patterns. |
| `intent_memory` | Cross-session intelligence state (TF-IDF indexed). |

---

## 4. Security & Privacy

### 4.1 InPrivate Browsing
Asteroid features a strict **InPrivate Mode** (Incognito). When active:
- Electron partitions are set to `incognito`.
- No history, cookies, or agent memory is written to IndexedDB.
- LLM requests include an `isIncognito` flag to prevent context-based learning.

### 4.2 Tracking Protection & Firewall
A built-in **Network Firewall** monitors and blocks invasive trackers at the IPC level. The "Omnibox Shield" provides real-time feedback on blocked elements per tab.

---

## 5. Development Pipeline

- **Frontend**: React + Lucide Icons + CSS Variables.
- **Runtime**: Electron (Main Process handles IPC, AI streams, and Shell commands).
- **Styles**: "Light-Glass" aesthetic (Glassmorphism + harmonious gradients).
