-- CreateTable
CREATE TABLE "users" (
    "id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255),
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'UTC',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" VARCHAR(16) NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "chat_id" VARCHAR(255) NOT NULL,
    "task_name" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "schedule_type" VARCHAR(10) NOT NULL,
    "schedule_value" TEXT NOT NULL,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "timezone" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_sessions" (
    "id" VARCHAR(16) NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "flow_name" VARCHAR(255) NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "user_prompt_template" TEXT,
    "status" VARCHAR(20) NOT NULL,
    "parent_session_id" VARCHAR(16),
    "messages" JSONB NOT NULL DEFAULT '[]',
    "active_messages" JSONB NOT NULL DEFAULT '[]',
    "message_window_config" JSONB NOT NULL,
    "context_files" JSONB NOT NULL DEFAULT '[]',
    "context_folders_infos" JSONB NOT NULL DEFAULT '[]',
    "tool_schemas" JSONB NOT NULL DEFAULT '[]',
    "skill_schemas" JSONB NOT NULL DEFAULT '[]',
    "call_llm_options" JSONB NOT NULL DEFAULT '{}',
    "agent_loop_config" JSONB NOT NULL DEFAULT '{}',
    "temp_files" JSONB NOT NULL DEFAULT '[]',
    "tool_logs" JSONB NOT NULL DEFAULT '[]',
    "skill_logs" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "flow_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_runs" (
    "id" VARCHAR(32) NOT NULL,
    "flow_name" VARCHAR(255) NOT NULL,
    "session_id" VARCHAR(255) NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,
    "parent_session_id" VARCHAR(255),

    CONSTRAINT "flow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agentic_loop_schemas" (
    "flow_name" VARCHAR(255) NOT NULL,
    "user_id" VARCHAR(255),
    "description" TEXT NOT NULL,
    "user_prompt_template" TEXT,
    "system_prompt" TEXT NOT NULL,
    "tool_names" TEXT[],
    "skill_names" TEXT[],
    "context_paths" JSONB NOT NULL,
    "call_llm_options" JSONB NOT NULL,
    "message_window_config" JSONB NOT NULL,
    "agent_loop_config" JSONB NOT NULL,

    CONSTRAINT "agentic_loop_schemas_pkey" PRIMARY KEY ("flow_name")
);

-- CreateIndex
CREATE INDEX "idx_tasks_user_active" ON "tasks"("user_id", "active");

-- CreateIndex
CREATE INDEX "idx_flow_sessions_user_id" ON "flow_sessions"("user_id");

-- CreateIndex
CREATE INDEX "idx_flow_sessions_parent_id" ON "flow_sessions"("parent_session_id");

-- CreateIndex
CREATE INDEX "idx_flow_sessions_status" ON "flow_sessions"("status");

-- CreateIndex
CREATE INDEX "idx_flow_sessions_user_status" ON "flow_sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "idx_flow_sessions_tree" ON "flow_sessions"("parent_session_id", "started_at");

-- CreateIndex
CREATE INDEX "flow_runs_user_id_idx" ON "flow_runs"("user_id");

-- CreateIndex
CREATE INDEX "flow_runs_session_id_idx" ON "flow_runs"("session_id");

-- CreateIndex
CREATE INDEX "flow_runs_status_idx" ON "flow_runs"("status");

-- CreateIndex
CREATE INDEX "idx_agentic_loop_schemas_user" ON "agentic_loop_schemas"("user_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_sessions" ADD CONSTRAINT "flow_sessions_parent_session_id_fkey" FOREIGN KEY ("parent_session_id") REFERENCES "flow_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
