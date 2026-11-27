-- 任务时限、提交附言、超时赔偿（2026-11-27）
ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "timeLimitHours" INTEGER,
  ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deadlineAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "submitPhotoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "submitNote" TEXT;

-- 超时扫描用：找已过截止时间但还没提交的任务
CREATE INDEX IF NOT EXISTS "Task_deadlineAt_status_idx" ON "Task"("deadlineAt", "status");
