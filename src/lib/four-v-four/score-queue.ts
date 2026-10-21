import { reduceScore } from "./scoring-rules.ts";
import { ScoringError } from "./scoring-types.ts";
import type { Principal, ScoreAction, ScoreCommand, ScoreResponse, StaffMatch } from "./scoring-types.ts";

export interface PendingScore {
  schema: 1; credentialId: string; credentialVersion: number; command: ScoreCommand;
  before: StaffMatch; createdAt: number;
}
export interface ScoreJournal {
  read(): PendingScore[]; put(operation: PendingScore): void; remove(requestId: string): void;
  clear?(): void;
}
export interface QueueSnapshot {
  match: StaffMatch; server: StaffMatch; pending: PendingScore[]; syncing: boolean;
  blocked: { code: string; message: string } | null; error: string | null; controlPending: boolean;
}
export function makeRequestId() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const value = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
const boundary = (action: ScoreAction) => !["POINT", "SET_SCORE"].includes(action.type);
const project = (match: StaffMatch, action: ScoreAction, role: Principal["role"]) => {
  const next = reduceScore(match, action, role);
  return { ...match, ...next, canStart: next.status === "NOT_STARTED" && match.canStart };
};

// A durable append-only entry per request avoids one browser tab overwriting another tab's queue.
export class ScoreQueue {
  private actor: Principal;
  private journal: ScoreJournal;
  private transport: (command: ScoreCommand) => Promise<ScoreResponse>;
  private online: () => boolean;
  private listeners = new Set<() => void>();
  private server: StaffMatch;
  private view: QueueSnapshot;
  private running = false;
  private disposed = false;
  private blocked: QueueSnapshot["blocked"] = null;
  private error: string | null = null;
  private lastTap: { key: string; at: number } | null = null;
  constructor(options: { actor: Principal; match: StaffMatch; journal: ScoreJournal; transport: (command: ScoreCommand) => Promise<ScoreResponse>; online?: () => boolean }) {
    this.actor = options.actor; this.server = structuredClone(options.match); this.journal = options.journal;
    this.transport = options.transport; this.online = options.online ?? (() => true);
    this.view = { match: this.server, server: this.server, pending: [], syncing: false, blocked: null, error: null, controlPending: false };
    this.publish();
  }
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  getSnapshot = () => this.view;
  private read() {
    const operations = this.journal.read().sort((a, b) => a.command.expectedVersion - b.command.expectedVersion || a.createdAt - b.createdAt || a.command.requestId.localeCompare(b.command.requestId));
    if (operations.some((operation) => operation.schema !== 1 || operation.credentialId !== this.actor.id || operation.before.code !== this.server.code || operation.before.version !== operation.command.expectedVersion)) throw new ScoringError("LOCAL_RECORD_INVALID", "本机待同步记录无法完整读取，请保留并核对");
    if (operations.some((operation) => operation.credentialVersion !== this.actor.version)) throw new ScoringError("SESSION_CHANGED", "访问码版本已变化，本机旧会话记录需核对后处理");
    return operations;
  }
  private publish() {
    let operations: PendingScore[] = []; let projected = this.server;
    try {
      operations = this.read();
      if (operations.length) {
        projected = structuredClone(operations[0].before);
        for (const operation of operations) {
          if (operation.command.expectedVersion !== projected.version) throw new ScoringError("LOCAL_QUEUE_CONFLICT", "另一页面存在并行操作，请核对本机记录与服务器成绩");
          projected = project(projected, operation.command.action, this.actor.role);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "本机待同步记录无法读取";
      this.blocked ??= { code: error instanceof ScoringError ? error.code : "LOCAL_RECORD_INVALID", message };
    }
    const controlPending = operations.some((operation) => boundary(operation.command.action));
    this.view = { match: controlPending ? operations[0]?.before ?? projected : projected, server: this.server,
      pending: operations, syncing: this.running, blocked: this.blocked, error: this.error, controlPending };
    for (const callback of this.listeners) callback();
  }
  receiveServer(match: StaffMatch) {
    if (match.code !== this.server.code || match.version < this.server.version) return;
    this.server = structuredClone(match); this.publish();
  }
  storageChanged() { this.publish(); }
  activate() { this.disposed = false; }
  enqueue(action: ScoreAction): boolean {
    if (this.disposed || this.blocked) return false;
    this.publish(); if (this.blocked) return false;
    if (this.view.controlPending) { this.error = "正在核对上一条提交回执，请先等待同步"; this.publish(); return false; }
    if (boundary(action) && (this.view.pending.length > 0 || !this.online())) { this.error = "请先联网并等待比分同步，再确认本次操作"; this.publish(); return false; }
    const now = Date.now(); const tapKey = action.type === "POINT" ? `${action.side}:${action.delta}` : "";
    if (tapKey && this.lastTap?.key === tapKey && now - this.lastTap.at < 180) return false;
    try {
      project(this.view.match, action, this.actor.role); // Validate before persisting or showing an optimistic score.
      const operation: PendingScore = { schema: 1, credentialId: this.actor.id, credentialVersion: this.actor.version,
        command: { requestId: makeRequestId(), expectedVersion: this.view.match.version, action: structuredClone(action) },
        before: structuredClone(this.view.match), createdAt: now };
      this.journal.put(operation); // A failed local write must not look like a successful point.
      this.lastTap = tapKey ? { key: tapKey, at: now } : null;
      this.error = null; this.publish(); void this.sync(); return true;
    } catch (error) {
      this.error = error instanceof ScoringError ? error.message : "无法保存待同步操作，请允许浏览器本地存储后重试";
      this.publish(); return false;
    }
  }
  async sync() {
    if (this.running || this.disposed || this.blocked || !this.online()) return;
    this.running = true; this.error = null; this.publish();
    try {
      while (!this.disposed && this.online() && !this.blocked) {
        this.publish(); if (this.blocked) break;
        const first = this.view.pending[0]; if (!first) break;
        try {
          const response = await this.transport(first.command);
          if (this.disposed) break; // Leave the durable entry; remount can safely replay its original id.
          if (response.receipt.requestId !== first.command.requestId || response.receipt.appliedVersion !== first.command.expectedVersion + 1 || response.match.code !== this.server.code || response.match.version < response.receipt.appliedVersion) throw new ScoringError("INVALID_RECEIPT", "同步回执无法核对，请保留本机记录");
          this.journal.remove(first.command.requestId);
          if (response.match.version >= this.server.version) this.server = structuredClone(response.match);
          this.publish();
          if (this.view.pending[0] && this.view.pending[0].command.expectedVersion !== this.server.version) {
            this.blocked = { code: "VERSION_CONFLICT", message: "已有其他设备更新成绩，剩余本机操作未自动套用，请核对" };
          }
        } catch (error) {
          if (error instanceof ScoringError && error.match) this.receiveServer(error.match);
          if (error instanceof ScoringError && error.code === "COURT_BUSY" && error.status === 409 && first.command.action.type === "START" && error.match?.status === "NOT_STARTED" && error.match.version === first.command.expectedVersion && error.match.courtBusyMatchCode) {
            // This explicit rejection confirms START was not applied. Do not leave it
            // queued to unexpectedly start the match when the court later becomes free.
            this.journal.remove(first.command.requestId); this.error = null;
          } else if (error instanceof ScoringError && error.status < 500) this.blocked = { code: error.code, message: error.message };
          else this.error = "未同步：网络或服务暂不可用，已保留原请求，恢复后安全重试";
          break;
        }
      }
    } finally { this.running = false; this.publish(); }
  }
  adoptServer() {
    if (!this.blocked || this.running) return false;
    try {
      // Explicit operator choice only. No operation receives a new id/version automatically.
      if (this.journal.clear) this.journal.clear();
      else { const operations = this.journal.read(); for (const operation of operations) this.journal.remove(operation.command.requestId); }
      this.blocked = null; this.error = null; this.publish(); return true;
    } catch { this.error = "本机记录未能清除，请保留页面并联系管理员"; this.publish(); return false; }
  }
  dispose() { this.disposed = true; this.listeners.clear(); }
}

export function browserScoreJournal(credentialId: string, matchCode: string): ScoreJournal {
  const prefix = `ustc4v4:score:v1:${credentialId}:${matchCode}:`;
  return {
    read() {
      const entries: PendingScore[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i); if (!key?.startsWith(prefix)) continue;
        const raw = localStorage.getItem(key); if (raw) entries.push(JSON.parse(raw));
      }
      return entries;
    },
    put(operation) { localStorage.setItem(prefix + operation.command.requestId, JSON.stringify(operation)); },
    remove(requestId) { localStorage.removeItem(prefix + requestId); },
    clear() { const keys: string[] = []; for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith(prefix)) keys.push(key); } for (const key of keys) localStorage.removeItem(key); },
  };
}

export function actionLabel(action: ScoreAction) {
  if (action.type === "POINT") return `第${action.setIndex}局 ${action.side === "home" ? "左队" : "右队"}${action.delta > 0 ? "+1" : "−1"}`;
  if (action.type === "SET_SCORE") return `修正第${action.setIndex}局为 ${action.homePoints}:${action.awayPoints}`;
  return { START: "开始比赛", CONFIRM_SET: "确认结束当前局", SUBMIT_MATCH: "提交整场比赛", CORRECT_RESULT: "管理员修正整场结果" }[action.type];
}
