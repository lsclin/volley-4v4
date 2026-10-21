-- Preserve which publication authorized the actual start. Existing records remain intact.
ALTER TABLE "Match" ADD COLUMN "crossApprovalIdAtStart" TEXT
  REFERENCES "Approval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
