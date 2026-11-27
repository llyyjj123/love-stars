-- 送星星（2026-11-28）
-- 只做账户间划转，不发行不销毁，SUM(balance) 仍为 0
CREATE TABLE IF NOT EXISTS "Gift" (
  "id"        TEXT NOT NULL,
  "fromId"    TEXT NOT NULL,
  "toId"      TEXT NOT NULL,
  "amount"    INTEGER NOT NULL,
  "note"      TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Gift_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Gift_fromId_createdAt_idx" ON "Gift"("fromId", "createdAt");
CREATE INDEX IF NOT EXISTS "Gift_toId_createdAt_idx"   ON "Gift"("toId", "createdAt");

ALTER TABLE "Gift"
  ADD CONSTRAINT "Gift_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Gift"
  ADD CONSTRAINT "Gift_toId_fkey"   FOREIGN KEY ("toId")   REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
