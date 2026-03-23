
Kimiki history:
# Conversation History

## Turn 1: Initial Question - Definition of Small Coding Task

**User:** What could be a good definition of a small coding task? Write a function, write a class, what else?

**Assistant Response:**
A "small coding task" typically refers to a self-contained, focused piece of work that can be completed in a short timeframe (usually minutes to a few hours). Categories include:
- Write a function
- Write a class
- Script/Utility
- Algorithm implementation
- API endpoint
- Bug fix
- Refactoring
- Configuration
- Test case
- SQL query
- Regex pattern
- Shell command

Characteristics: Single responsibility, limited scope, clear completion criteria, time-bounded, reviewable.

---

## Turn 2: Definition of Big Coding Task

**User:** What is coding big task?

**Assistant Response:**
A "big coding task" (feature, project, initiative) requires significant time, coordination, and architectural thinking. Examples:
- Feature (user-facing functionality)
- Module/Component (reusable system part)
- System/Platform (large infrastructure)
- Migration (large-scale change)

Differentiating factors: Time (days-months), code volume (thousands+ lines), dependencies, planning requirements, testing complexity, deployment strategy, collaboration needs.

---

## Turn 3: Definition of Medium Coding Task

**User:** What is a medium size task?

**Assistant Response:**
A "medium coding task" takes 4 hours to 3 days, 200-1,500 lines across ~5-15 files. Examples:
- Sub-feature (pagination, filtering, sorting)
- Refactoring module
- Integration with third-party API
- CLI tool
- UI component library
- Data pipeline segment
- Authentication flow
- Performance optimization
- Test framework setup

Hallmark: "I can hold the whole thing in my head, but I need to think before I type."

---

## Turn 4: "Devil Tasks" - Ambiguous Scope Tasks

**User:** What are the devils? Devil is a task that could be small or medium or big - task that fits in several buckets. Like write a module for example. What are such abstract and specific tasks?

**Assistant Response:**
Devil tasks resist clean categorization because their size is context-dependent. Examples:
- Write a module (single file vs. multi-layer package)
- Refactor X (rename variables vs. rewrite architecture)
- Add caching (in-memory dict vs. distributed Redis)
- Write tests (happy-path vs. property-based testing)
- Build an API client (thin wrapper vs. resilient client)
- Create a config system (.env loader vs. hierarchical platform)
- Add logging (print statements vs. observability platform)
- Implement search (SQL LIKE vs. Elasticsearch cluster)
- Build a dashboard (static page vs. real-time product)

Estimation traps: Ambiguous nouns, "just," invisible prerequisites, polishing spiral.

---

## Turn 5: Algorithm for Discovering Task Size

**User:** What is algorithm of discover size of the task? How to figure out if the task is small or big or medium?

**Assistant Response:**
Five-phase discovery algorithm:

1. **Decomposition Probe** (5-15 min): List moving parts
   - 1-2 sub-tasks = Small
   - 3-6 sub-tasks = Medium
   - 7+ sub-tasks = Big

2. **Interface Audit** (10-20 min): Count files touched
   - Single file = Small
   - 2-8 files = Medium
   - 9+ files or cross-module = Big

3. **Dependency Graph Check**: What blocks you?
   - None = Small
   - 1-2 async = Medium
   - Cyclical/multiple stakeholders = Big

4. **Tomorrow Test**: What does "done" look like tomorrow?
   - Merged/deployed = Small
   - Core working, tests tomorrow = Medium
   - Still designing = Big

5. **Risk Surface Scan**: Check expansion vectors (state, concurrency, users, data, rollback, novelty)

Golden rule: "If you can't describe 'done' in one sentence, it's not small. If you need a diagram, it's not medium."

---

## Turn 6: Guaranteed Indicators by Bucket

**User:** [Critique of previous approach] Need systematic patterns with 100% guaranteed indicators for AI task sorting. Output ALL examples for each bucket and ONLY GUARANTEED.

**Assistant Response:**

### GUARANTEED SMALL
- Single built-in function replacement
- Single variable rename
- Single line comment/docstring
- Fix single syntax error
- Change single constant value
- Delete unreachable code
- Add type hint to single parameter
- Single import addition/removal
- Single assertion addition
- Format/lint fix (single issue)
- Single regex literal fix
- Single config value change

### GUARANTEED MEDIUM
- CRUD for single entity, single table
- Implement single design pattern in isolation
- Add single middleware/interceptor
- Single migration (schema + data backfill)
- Single auth method implementation
- Single external API integration (wrapper)
- Single feature flag implementation
- Single webhook handler
- Single background job (queue task)
- Single data validation layer
- Single caching layer addition
- Single rate limiter
- Single CLI command with 2-3 subcommands
- Single reactive UI component
- Single database query optimization

### GUARANTEED BIG
- Multi-service orchestration
- Database technology change
- Authentication system replacement
- Real-time collaborative system
- Event sourcing implementation
- Multi-tenant data isolation
- Zero-downtime migration with data transformation
- Compliance implementation (GDPR/SOC2)
- Custom language/framework creation
- Distributed consensus system
- ML model training infrastructure
- Multi-region deployment
- Legacy system strangulation
- Cross-platform native apps (from scratch)
- Marketplace/platform with network effects

### GUARANTEED AMBIGUOUS
- "Build a module"
- "Add caching"
- "Refactor the service"
- "Implement search"
- "Write tests"
- "Create an API"
- "Add authentication"
- "Build a dashboard"

---

## Turn 7: PM Perspective on Planning Hierarchy

**User:** [Critique] Take Product Manager with Programming Expertise perspective. Think about epics, features, stories. Act as PM.

**Assistant Response:**

### Planning Hierarchy
- Epic (weeks-months, business outcome, cross-functional)
- Feature (days-2 weeks, user-facing, shippable)
- Story (1-3 days, vertical slice, INVEST-compliant)
- Task (hours-1 day, technical step)

### GUARANTEED SMALL (Story-level)
- Single user action, single system response
- Single API endpoint, existing schema
- UI change using existing components
- Configuration toggle for existing behavior
- Single validation rule addition
- Single notification template
- Single metric/dashboard addition
- Single permission check

### GUARANTEED MEDIUM (Feature-level)
- New user workflow (3-5 steps)
- New entity with full CRUD + UI
- Integration with 1 external system
- Single state machine implementation
- Migration with dual-write period
- Single access control model
- Single async job with observability
- Single data aggregation/report

### GUARANTEED BIG (Epic-level)
- Cross-team dependency mandatory
- Platform change affecting all teams
- New business line or revenue model
- Compliance/security mandate with deadline
- Technology bet with irreversible data
- Scale threshold requiring rearchitecture
- Multi-environment consistency requirement
- Acquisition or third-party absorption

---

## Extended Decision Framework: Operational Rules

### The PM's Sizing Checklist

Before committing to roadmap placement, verify:

| Checkpoint | Epic | Feature | Story |
|-----------|------|---------|-------|
| Requires quarterly planning visibility? | ✓ | — | — |
| Has dedicated slack channel or working group? | ✓ | — | — |
| Needs executive escalation pathway? | ✓ | — | — |
| Blocks other teams if delayed? | ✓ | ✓ | — |
| Fits within single sprint? | — | ✓ | ✓ |
| Demoable at sprint review without setup? | — | ✓ | ✓ |
| Can be split further without losing value? | ✓ | ✓ | — |
| Acceptance criteria fits on index card? | — | — | ✓ |

---

### Anti-Patterns by Level

**Story Bloat** (When Stories Become Features)
- Multiple user personas in one flow
- "And then" in acceptance criteria (&gt;1 conjunction)
- Requires mock data creation before development
- Spans frontend and backend with new contract needed

**Feature Bloat** (When Features Become Epics)
- Rollout plan has phases (pilot → beta → GA)
- Requires training or documentation before release
- Legal/Compliance review in critical path
- Performance testing against production-scale data

**Epic Shrink** (When Epics Should Be Features)
- No dedicated team—"we'll find engineers"
- Success metrics undefined or vanity
- No external dependency despite "platform" label
- Can be toggled off without user notice

---

### Conversation-to-Classification Mapping

| What User Actually Says | Decode | Classification |
|------------------------|--------|----------------|
| "Quick win" | Undefined scope, time pressure | **Ambiguous**—force constraints |
| "Just add..." | Invisible complexity incoming | **ASK**: "What does 'working' look like?" |
| "Like X but for Y" | Pattern match, verify surface area | **Medium** if 1:1 mapping, **Big** if Y is new domain |
| "Phase 1 of..." | Acknowledged epic, extract independent feature | **Medium** (bounded) or **Big** (if Phase 1 requires Phase 2 to ship) |
| "Spike on..." | Research task, not deliverable | **Exclude**—spikes are time-boxed, not sized |
| "Fix the bug where..." | Symptom description | **Small** if root cause isolated, **Medium** if architectural |

---

### The Refusal Protocol

When classification fails, respond with:

&gt; "I can size this accurately with one clarification: [specific question]. Otherwise, I'll assume [conservative size] and we can de-scope if needed."

**Forced-choice questions:**
- "Does this change data that exists in production today?"
- "Will a user interact with this directly, or is it infrastructure?"
- "If this breaks at 2am, who gets paged?"
- "Has this pattern been built elsewhere in our system?"

---

### Final Output: AI Sorting Logic

```python
def classify_pm_request(user_input: str, context: dict) -&gt; Classification:
    """
    Returns: EPIC | FEATURE | STORY | AMBIGUOUS
    """
    
    # EPIC triggers (organizational)
    if has_cross_team_dependency(user_input) or \
       requires_quarterly_commitment(user_input) or \
       affects_platform_or_infra(user_input):
        return EPIC
    
    # STORY triggers (atomic)
    if is_single_user_action(user_input) and \
       uses_existing_systems_only(user_input) and \
       demoable_in_under_2_minutes(user_input):
        return STORY
    
    # FEATURE triggers (bounded coordination)
    if bounded_to_single_team(user_input) and \
       requires_design_doc_not_rfc(user_input) and \
       shippable_independently(user_input):
        return FEATURE
    
    # Fallback
    return AMBIGUOUS
