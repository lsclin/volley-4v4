-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'current' CHECK ("id" = 'current'),
    "name" TEXT NOT NULL,
    "mode" INTEGER NOT NULL CHECK ("mode" IN (8, 10)),
    "location" TEXT NOT NULL DEFAULT '高新区室外排球场',
    "rulesText" TEXT NOT NULL DEFAULT '',
    "groupTarget" INTEGER NOT NULL DEFAULT 25,
    "groupCap" INTEGER NOT NULL DEFAULT 29,
    "crossTarget" INTEGER NOT NULL DEFAULT 15,
    "crossCap" INTEGER NOT NULL DEFAULT 19,
    "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
    "groupResultsRevision" INTEGER NOT NULL DEFAULT 0 CHECK ("groupResultsRevision" >= 0),
    "resultsRevision" INTEGER NOT NULL DEFAULT 0 CHECK ("resultsRevision" >= 0),
    "schedulePublished" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME,
    "noticeText" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CHECK ("groupTarget" = 25 AND "groupCap" = 29 AND "crossTarget" = 15 AND "crossCap" = 19)
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tournamentId" TEXT NOT NULL DEFAULT 'current',
    "drawCode" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "group" TEXT NOT NULL CHECK ("group" IN ('A', 'B')),
    "slot" INTEGER NOT NULL CHECK ("slot" BETWEEN 1 AND 5),
    CHECK ("drawCode" = "group" || "slot"),
    CONSTRAINT "Team_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Court" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tournamentId" TEXT NOT NULL DEFAULT 'current',
    "name" TEXT NOT NULL,
    "netHeightCm" INTEGER NOT NULL,
    CHECK (("id" = 'main' AND "netHeightCm" = 243) OR ("id" = 'secondary' AND "netHeightCm" = 224)),
    CONSTRAINT "Court_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tournamentId" TEXT NOT NULL DEFAULT 'current',
    "code" TEXT NOT NULL,
    "stage" TEXT NOT NULL CHECK ("stage" IN ('GROUP', 'SEMIFINAL', 'THIRD_PLACE', 'FINAL', 'PLACEMENT')),
    "group" TEXT,
    "placement" INTEGER,
    "format" TEXT NOT NULL,
    "targetPoints" INTEGER NOT NULL,
    "capPoints" INTEGER NOT NULL,
    "courtId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
    "homeRef" TEXT NOT NULL,
    "awayRef" TEXT NOT NULL,
    "homeTeamId" TEXT,
    "awayTeamId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK ("status" IN ('NOT_STARTED', 'LIVE', 'FINISHED')),
    "winnerId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0 CHECK ("version" >= 0),
    "startedAt" DATETIME,
    "submittedAt" DATETIME,
    CHECK ("homeTeamId" IS NULL OR "awayTeamId" IS NULL OR "homeTeamId" <> "awayTeamId"),
    CHECK ("winnerId" IS NULL OR ("homeTeamId" IS NOT NULL AND "winnerId" = "homeTeamId") OR ("awayTeamId" IS NOT NULL AND "winnerId" = "awayTeamId")),
    CHECK (("stage" = 'GROUP' AND "format" = 'BO1' AND "targetPoints" = 25 AND "capPoints" = 29) OR ("stage" <> 'GROUP' AND "format" = 'BO3' AND "targetPoints" = 15 AND "capPoints" = 19)),
    CONSTRAINT "Match_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Match_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Match_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Match_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Match_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SetScore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "setIndex" INTEGER NOT NULL CHECK ("setIndex" BETWEEN 1 AND 3),
    "homePoints" INTEGER NOT NULL DEFAULT 0 CHECK (typeof("homePoints") = 'integer' AND "homePoints" >= 0),
    "awayPoints" INTEGER NOT NULL DEFAULT 0 CHECK (typeof("awayPoints") = 'integer' AND "awayPoints" >= 0),
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT,
    CONSTRAINT "SetScore_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScoreAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "before" TEXT NOT NULL,
    "after" TEXT NOT NULL,
    "expectedVersion" INTEGER NOT NULL CHECK ("expectedVersion" >= 0),
    "resultingVersion" INTEGER NOT NULL CHECK ("resultingVersion" = "expectedVersion" + 1),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScoreAction_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tournamentId" TEXT NOT NULL DEFAULT 'current',
    "type" TEXT NOT NULL CHECK ("type" IN ('CROSS', 'FINAL')),
    "sourceRevision" INTEGER NOT NULL,
    "snapshot" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidatedAt" DATETIME,
    CONSTRAINT "Approval_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tournamentId" TEXT NOT NULL DEFAULT 'current',
    "role" TEXT NOT NULL CHECK ("role" IN ('ADMIN', 'SCORER')),
    "courtId" TEXT,
    "codeHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" >= 1),
    "updatedAt" DATETIME NOT NULL,
    CHECK (("role" = 'ADMIN' AND "courtId" IS NULL) OR ("role" = 'SCORER' AND "courtId" IS NOT NULL)),
    CONSTRAINT "Credential_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Credential_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tournamentId" TEXT NOT NULL DEFAULT 'current',
    "actor" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_tournamentId_drawCode_key" ON "Team"("tournamentId", "drawCode");

-- CreateIndex
CREATE UNIQUE INDEX "Team_tournamentId_group_slot_key" ON "Team"("tournamentId", "group", "slot");

-- CreateIndex
CREATE INDEX "Match_stage_status_idx" ON "Match"("stage", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Match_tournamentId_code_key" ON "Match"("tournamentId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Match_courtId_sequence_key" ON "Match"("courtId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "SetScore_matchId_setIndex_key" ON "SetScore"("matchId", "setIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreAction_requestId_key" ON "ScoreAction"("requestId");

-- CreateIndex
CREATE INDEX "Approval_type_invalidatedAt_idx" ON "Approval"("type", "invalidatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_tournamentId_type_sourceRevision_key" ON "Approval"("tournamentId", "type", "sourceRevision");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_courtId_key" ON "Credential"("courtId");

-- One active publication snapshot per type, preserving invalidated history.
CREATE UNIQUE INDEX "Approval_active_type_key" ON "Approval"("tournamentId", "type") WHERE "invalidatedAt" IS NULL;
CREATE UNIQUE INDEX "Credential_single_admin_key" ON "Credential"("role") WHERE "role" = 'ADMIN';

-- Structural locks only: no score-threshold, net-balance or cross-court conflict engine.
CREATE TRIGGER "Tournament_mode_locked" BEFORE UPDATE OF "mode" ON "Tournament"
WHEN NEW."mode" <> OLD."mode" AND (OLD."startedAt" IS NOT NULL OR EXISTS (SELECT 1 FROM "Match" WHERE "status" <> 'NOT_STARTED'))
BEGIN SELECT RAISE(ABORT, 'TOURNAMENT_STRUCTURE_LOCKED'); END;

CREATE TRIGGER "Team_draw_locked" BEFORE UPDATE OF "drawCode", "group", "slot" ON "Team"
WHEN (NEW."drawCode" <> OLD."drawCode" OR NEW."group" <> OLD."group" OR NEW."slot" <> OLD."slot")
AND ((SELECT "startedAt" FROM "Tournament" WHERE "id" = OLD."tournamentId") IS NOT NULL OR EXISTS (SELECT 1 FROM "Match" WHERE "status" <> 'NOT_STARTED'))
BEGIN SELECT RAISE(ABORT, 'TOURNAMENT_STRUCTURE_LOCKED'); END;

CREATE TRIGGER "Team_slot_range" BEFORE INSERT ON "Team"
WHEN NEW."slot" > (SELECT "mode" / 2 FROM "Tournament" WHERE "id" = NEW."tournamentId")
BEGIN SELECT RAISE(ABORT, 'TEAM_SLOT_OUT_OF_RANGE'); END;
