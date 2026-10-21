-- Only an administrator may exist before the single tournament is initialized.
-- Preserve credential IDs, hashes and versions so existing sessions remain valid.
CREATE TABLE "Credential_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tournamentId" TEXT DEFAULT 'current',
    "role" TEXT NOT NULL CHECK ("role" IN ('ADMIN', 'SCORER')),
    "courtId" TEXT,
    "codeHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" >= 1),
    "updatedAt" DATETIME NOT NULL,
    CHECK (("role" = 'ADMIN' AND "courtId" IS NULL) OR ("role" = 'SCORER' AND "courtId" IS NOT NULL AND "tournamentId" IS NOT NULL)),
    FOREIGN KEY ("tournamentId") REFERENCES "Tournament" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY ("courtId") REFERENCES "Court" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "Credential_new" SELECT "id", "tournamentId", "role", "courtId", "codeHash", "version", "updatedAt" FROM "Credential";
DROP TABLE "Credential";
ALTER TABLE "Credential_new" RENAME TO "Credential";
CREATE UNIQUE INDEX "Credential_courtId_key" ON "Credential"("courtId");
CREATE UNIQUE INDEX "Credential_single_admin_key" ON "Credential"("role") WHERE "role" = 'ADMIN';
