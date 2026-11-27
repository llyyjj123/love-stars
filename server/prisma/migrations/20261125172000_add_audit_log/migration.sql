-- 系统行为审计：自动确认等系统操作必须可追溯（规格 v1.2 §5.4）
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "actorId" TEXT,
    "targetId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_event_createdAt_idx" ON "AuditLog"("event", "createdAt");
CREATE INDEX "AuditLog_targetId_idx" ON "AuditLog"("targetId");
