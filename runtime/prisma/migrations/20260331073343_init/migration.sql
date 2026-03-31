/*
  Warnings:

  - You are about to drop the `flow_runs` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "flow_sessions" ADD COLUMN     "agent_session_id" VARCHAR(16),
ADD COLUMN     "current_node_name" VARCHAR(255),
ADD COLUMN     "current_packet_data" JSONB,
ADD COLUMN     "flow_schema" JSONB;

-- DropTable
DROP TABLE "flow_runs";

-- CreateTable
CREATE TABLE "agent_sessions" (
    "id" VARCHAR(16) NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "agent_name" VARCHAR(255) NOT NULL,
    "agent_schema" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'running',
    "current_step" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_agent_sessions_user_id" ON "agent_sessions"("user_id");

-- CreateIndex
CREATE INDEX "idx_agent_sessions_status" ON "agent_sessions"("status");

-- CreateIndex
CREATE INDEX "idx_agent_sessions_user_status" ON "agent_sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "idx_flow_sessions_agent_session_id" ON "flow_sessions"("agent_session_id");

-- AddForeignKey
ALTER TABLE "flow_sessions" ADD CONSTRAINT "flow_sessions_agent_session_id_fkey" FOREIGN KEY ("agent_session_id") REFERENCES "agent_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
