# Skill Sandbox Architecture

This document describes the architecture for executing skills in isolated sandbox environments with Python, Node.js, and Bash runtimes.

## Overview

Skills are executed in containerized sandboxes using Podman with pre-built runtime images. Each skill execution runs in an isolated session with exclusive container access, preventing conflicts and ensuring clean state.

## Runtime Requirements

We have 4 runtime profiles plus skills that don't require sandboxing:

| Runtime Profile | Skills | Key Dependencies | Image Size Est. |
|---|---|---|---|
| **Office** | docx, pptx, xlsx | LibreOffice, Poppler, pandoc, pypdf, pdfplumber, reportlab, openpyxl, pandas, Pillow, `docx`/`pptxgenjs` npm | ~1.5-2GB |
| **PDF** | pdf | Poppler, pandoc, pypdf, pdfplumber, reportlab, pytesseract, pypdfium2, markitdown | ~500MB |
| **Web Testing** | webapp-testing | Playwright + Chromium | ~800MB |
| **Generic** | frontend-design, skill-creator | Python + Node.js + Bash only | ~300MB |
| **No Sandbox** | schedule | Interpreter-only skills (run in host runtime) | N/A |

**Sandbox configurations** are stored in `skills/.sandbox/` directory, separate from skill content.

## Architecture: Warm Container Pool with Exclusive Lock

### Core Concept

```
Pre-built Images (built once):
  office-runtime:latest
  web-runtime:latest
  base-runtime:latest

Container Pool (warm, ready to use):
  office-runtime-1  (idle or executing session-abc123)
  office-runtime-2  (idle, waiting for next task)
  web-runtime-1     (idle or executing session-def456)
  base-runtime-1    (idle)

Execution Flow:
  User asks: "Fill this PDF form"
    1. SandboxService.executeSkill(pdfSkill, inputFiles)
    2. Acquire container from pdf pool (or queue if full)
    3. Create session directory: /workspace/{sessionId}/
    4. Copy skill files + user files into session directory
    5. Flow receives tools (read, write, bash) scoped to session
    6. Flow executes without knowing sandbox internals
    7. Flow triggers cleanup: rm -rf /workspace/{sessionId}/
    8. Release container back to pool (stays warm)
```

### Why This Architecture

1. **No dependency installation at runtime** — everything baked into images
2. **Parallel execution by default** — multiple sessions per container (restricted only when needed, e.g., LibreOffice)
3. **Zero startup latency** — containers stay warm between uses
4. **Resource efficient** — containers reused, ~100MB per active session
5. **Scales naturally** — pool grows under load up to configured max
6. **User-friendly queue** — tasks wait gracefully when pool is full
7. **Clean state** — simple `rm -rf /workspace/{sessionId}` between sessions
8. **Flow-agnostic** — flows use simple tools (read/write/bash), no sandbox knowledge required

## System Architecture

### Layer Placement (per design.md)

```
┌─────────────────────────────────────────────┐
│  Flows Layer                                │
│  - PDF Fill Flow                            │
│  - DOCX Edit Flow                           │
│  - Uses: SandboxService, Skills             │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│  Services Layer                             │
│  - SandboxService (container pool manager) │
│  - Skills (skill metadata loader)          │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│  Infra Layer                                │
│  - Podman/Docker runtime                    │
│  - Container lifecycle management           │
└─────────────────────────────────────────────┘
```

**SandboxService** is a service because it:
- Encapsulates a specific feature (sandboxed skill execution)
- Has its own resources (container pool, queue, session lifecycle)
- Is used by Flows when they need to execute skills
- Can grow independently (monitoring, metrics, cleanup, etc.)

### Component Diagram

```
┌─────────────────────────────────────────────┐
│  Flow (e.g., PDF Fill Flow)                 │
│                                             │
│  1. Gets skill from Skills class            │
│  2. Calls SandboxService.execute()          │
│     └─ Provides: skill, input files         │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  SandboxService                             │
│                                             │
│  Methods:                                   │
│  - executeSkill(skill, inputFiles)          │
│  - acquireContainer(runtimeType)            │
│  - createSession(container, skill, files)   │
│  - executeTool(session, tool, params)       │
│  - releaseContainer(container)              │
│                                             │
│  Internal:                                  │
│  - ContainerPool per runtime type           │
│  - Queue for waiting tasks                  │
│  - Session lifecycle management             │
│  - Timeout enforcement                      │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  ContainerPool                              │
│                                             │
│  office-runtime:  [container1, container2]  │
│  web-runtime:     [container3]              │
│  base-runtime:    [container4]              │
│                                             │
│  Queue: [task1, task2, task3]               │
│  Locks: [container1: locked, ...]          │
└─────────────────────────────────────────────┘
```

## Live Sandbox Workflow

### Tool Execution Flow

```
┌─────────────────────────────────────────────┐
│  Your Runtime (Node.js host)                │
│                                             │
│  LLM says: tool_call("bash", "ls -la")      │
│       │                                     │
│       ▼                                     │
│  ToolRouter                                 │
│    ├─ bash  → podman exec {cid} bash -c ... │
│    ├─ read  → podman exec {cid} cat ...     │
│    ├─ write → podman cp from stdin ...      │
│    ├─ edit  → podman exec {cid} sed/patch   │
│    └─ ls    → podman exec {cid} ls ...      │
│                                             │
│  Container (pdf-runtime)                    │
│  ┌────────────────────────────────────┐     │
│  │ /workspace/session-abc123/         │     │
│  │   ├── (skill files copied here)   │     │
│  │   └── (user files copied here)    │     │
│  │                                    │     │
│  │ Python 3.x, Node 20, PDF tools    │     │
│  │ All deps pre-installed             │     │
│  └────────────────────────────────────┘     │
└─────────────────────────────────────────────┘
```

### Example: PDF Form Fill Workflow

1. **Acquire container** from pdf pool
2. **Create session**: `podman exec {cid} mkdir /workspace/session-abc123`
3. **Copy skill files**: `podman cp /host/skills/pdf/* → {cid}:/workspace/session-abc123/`
4. **Copy user files**: `podman cp input.pdf → {cid}:/workspace/session-abc123/`
5. **Flow receives tools** scoped to session directory (read, write, bash)
6. **Flow executes** — tools map to podman exec:
   ```bash
   bash("python check_fillable_fields.py input.pdf")
   bash("python extract_form_structure.py input.pdf")
   write("fill_config.json", "{...}")
   bash("python fill_pdf_form_with_annotations.py ...")
   ```
7. **Copy output**: `podman cp {cid}:/workspace/session-abc123/output.pdf → host`
8. **Cleanup**: `podman exec {cid} rm -rf /workspace/session-abc123`
9. **Release container** back to pool

## Pool Configuration

### Resource Limits

```typescript
const poolConfig = {
  office: {
    min: 1,                    // Always keep 1 warm
    max: 3,                    // Don't spawn more than 3
    sessionTimeout: 300000,    // 5 min max per session
    parallelSessions: false    // LibreOffice locking issue
  },
  pdf: {
    min: 0,                    // Spawn on demand
    max: 2,
    sessionTimeout: 300000,    // 5 min max per session
    parallelSessions: true     // Allow parallel execution
  },
  webTesting: {
    min: 0,                    // Spawn on demand
    max: 2,
    sessionTimeout: 600000,    // 10 min for web tests
    parallelSessions: true     // Allow parallel execution
  },
  generic: {
    min: 1,
    max: 2,
    sessionTimeout: 180000,    // 3 min
    parallelSessions: true     // Allow parallel execution
  }
};
```

**Configuration location**: `skills/.sandbox/runtimes/{runtime-name}/config.json`

### Queueing Behavior

- **Pool available** → instant start
- **Pool full** → task queued, user sees: "Waiting for available sandbox (position 1 in queue)"
- **Container becomes available** → queued task starts automatically
- **Timeout exceeded** → container killed, task fails with timeout error

## Resource Usage

| Metric | Value |
|---|---|
| Memory per active session | ~100MB |
| Memory per idle warm container | ~30-50MB |
| Idle overhead (1 warm per type) | ~90-150MB total |
| Typical workload (1-3 concurrent) | ~100-300MB |
| Container startup (cold) | ~1-2s |
| Container startup (warm) | ~0s (instant) |

**Verdict:** Very reasonable resource usage for the functionality provided.

## Key Design Decisions

### 1. Skill Files: Copy Per Session

**Decision:** Copy skill files and user files into session directory on execution start.

```bash
podman cp /host/skills/pdf/* {cid}:/workspace/session-abc123/
podman cp input.pdf {cid}:/workspace/session-abc123/
```

**Rationale:**
- Simple model: everything in one flat session directory
- Flow doesn't need to know about skill vs user files
- Clean isolation: each session is completely independent
- Skills can be modified during execution if needed
- Easy cleanup: `rm -rf /workspace/{sessionId}` removes everything

### 2. Dependencies: Baked Into Images

**Decision:** All dependencies pre-installed in Dockerfile, never at runtime.

**Rationale:**
- Zero runtime installation delay
- Reproducible environments
- Explicit dependency management
- When deps change, rebuild image

### 3. Parallel Execution By Default

**Decision:** Allow multiple sessions per container by default. Only disable when needed (e.g., LibreOffice locking).

**Configuration:**
```json
{
  "parallelSessions": true  // default: allow
}
```

**Rationale:**
- Better resource utilization
- Faster execution (no waiting for container)
- Only restrict when dependencies conflict
- Most tools (Python, Node, PDF utils) are parallel-safe

### 4. Container Timeout

**Decision:** Hard timeout per session (5-10 minutes depending on runtime type).

**Implementation:**
```typescript
Promise.race([
  executeSession(session),
  timeout(poolConfig[runtimeType].timeout)
])
```

**Rationale:**
- Prevents hung LibreOffice processes
- Protects against infinite loops in model-generated code
- Ensures containers return to pool

### 5. Networking

**Decision:**
- Office/PDF/Generic: `--network=none` (no internet access needed)
- Web testing: `--network=slirp4netns` (needs to reach test servers)

**Rationale:**
- Security: minimize attack surface
- Isolation: prevent unintended external calls
- Flexibility: web testing still works

### 6. Sandbox Configuration Separation

**Decision:** Store all sandbox configs in `skills/.sandbox/`, separate from skill content.

**Structure:**
```
skills/.sandbox/
  runtimes/
    office/config.json + Dockerfile
    pdf/config.json + Dockerfile
    web-testing/config.json + Dockerfile
    generic/config.json + Dockerfile
  skill-runtimes.json (skill → runtime mapping)
```

**Rationale:**
- No pollution of skill directories
- Easy to version and manage
- Clear separation of concerns
- Runtime configs can evolve independently

## Concurrency & LibreOffice

### The LibreOffice Locking Problem

LibreOffice uses a user profile lock (`~/.config/libreoffice/4/user/.lock`). When two `soffice` processes try to run concurrently in the same container:
- **Both will conflict** — lock errors, crashes, or corrupted output
- **No automatic waiting** — they fail immediately

### The Solution: Configurable Parallel Sessions

**For LibreOffice skills** (office runtime):
```json
{
  "parallelSessions": false
}
```
- ✅ Only one session per container at a time
- ✅ Only one LibreOffice instance per container
- ✅ No profile lock conflicts
- ✅ No code changes needed to existing scripts

**For other runtimes** (pdf, web-testing, generic):
```json
{
  "parallelSessions": true
}
```
- ✅ Multiple sessions run concurrently in same container
- ✅ Better resource utilization
- ✅ No waiting for containers

**For high concurrency:**
- Spawn more containers from the same image (they're lightweight after the first)
- Pool scales up to configured `max` limit
- Queue handles overflow gracefully

## Image Build Strategy

### Four Dockerfiles

Dockerfiles are stored in `skills/.sandbox/runtimes/{runtime-name}/Dockerfile`

**1. office runtime** (`skills/.sandbox/runtimes/office/Dockerfile`)
```dockerfile
FROM node:20-bookworm

RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    libreoffice-core libreoffice-writer libreoffice-calc \
    poppler-utils pandoc \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages --no-cache-dir \
    pypdf pdfplumber reportlab pytesseract pypdfium2 \
    openpyxl pandas python-docx python-pptx Pillow markitdown

RUN npm install -g docx pptxgenjs

WORKDIR /workspace
CMD ["/bin/bash"]
```

**2. pdf runtime** (`skills/.sandbox/runtimes/pdf/Dockerfile`)
```dockerfile
FROM node:20-bookworm

RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    poppler-utils pandoc \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages --no-cache-dir \
    pypdf pdfplumber reportlab pytesseract pypdfium2 markitdown

WORKDIR /workspace
CMD ["/bin/bash"]
```

**3. web-testing runtime** (`skills/.sandbox/runtimes/web-testing/Dockerfile`)
```dockerfile
FROM node:20-bookworm

RUN apt-get update && apt-get install -y \
    python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages --no-cache-dir playwright pytest
RUN playwright install chromium --with-deps

WORKDIR /workspace
CMD ["/bin/bash"]
```

**4. generic runtime** (`skills/.sandbox/runtimes/generic/Dockerfile`)
```dockerfile
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    python3 python3-pip bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
CMD ["/bin/bash"]
```

### Build Process

#### Automated Build Script (Recommended)

The build script automatically discovers all runtimes in `.sandbox/runtimes/` and builds them:

```bash
cd runtime/src/skills/.sandbox
npm run build  # or: node build.ts
```

**Auto-discovery:**
- Scans `runtimes/` directory for subdirectories with Dockerfiles
- Builds each runtime with tag convention: `{name}-runtime:latest`
- No hardcoded runtime list — just add a new directory with a Dockerfile

#### Manual Build (if needed)

```bash
cd runtime
podman build -f src/skills/.sandbox/runtimes/office/Dockerfile -t office-runtime:latest .
podman build -f src/skills/.sandbox/runtimes/pdf/Dockerfile -t pdf-runtime:latest .
podman build -f src/skills/.sandbox/runtimes/web-testing/Dockerfile -t web-testing-runtime:latest .
podman build -f src/skills/.sandbox/runtimes/generic/Dockerfile -t generic-runtime:latest .
```

## Implementation Summary

**Services Layer:**
- `SandboxService` — manages container pools, sessions, and execution
- `Skills` — loads skill metadata (name, description, location)

**Container Pool:**
- Warm containers (min idle per runtime type)
- Configurable parallel sessions (default: allowed, disabled for LibreOffice)
- Auto-scaling (spawn up to max)
- Queue for overflow

**Session Lifecycle:**
1. Acquire container (or reuse if parallelSessions: true)
2. Create session directory: `/workspace/{sessionId}/`
3. Copy skill files to session directory
4. Copy user input files to session directory
5. Flow receives tools (read, write, bash) scoped to session
6. Flow executes without knowing sandbox internals
7. Flow triggers cleanup: `rm -rf /workspace/{sessionId}/`
8. Release container (if exclusive) or continue (if parallel)

**Boundary Compliance:**
- ✅ Skills layer: only skill files
- ✅ Services layer: SandboxService manages execution
- ✅ Flows layer: uses SandboxService to run skills
- ✅ No abstraction leaks

This architecture provides secure, isolated, resource-efficient skill execution with excellent user experience (instant warm starts, graceful queueing) and maintainability (3 images, clear boundaries, simple pool management).
