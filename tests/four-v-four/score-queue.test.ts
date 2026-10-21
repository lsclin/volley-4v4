import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ScoreQueue } from "../../src/lib/four-v-four/score-queue.ts";
import type { PendingScore, ScoreJournal } from "../../src/lib/four-v-four/score-queue.ts";
import { reduceScore } from "../../src/lib/four-v-four/scoring-rules.ts";
import { ScoringError } from "../../src/lib/four-v-four/scoring-types.ts";
import type { Principal, ScoreCommand, ScoreResponse, StaffMatch } from "../../src/lib/four-v-four/scoring-types.ts";

const actor: Principal = { id: "main-credential", version: 1, role: "SCORER", courtId: "main" };
function initial(): StaffMatch { return { code: "M01", courtId: "main", stage: "GROUP", format: "BO1", status: "LIVE", version: 1,
  homeTeamId: "team:A1", awayTeamId: "team:A2", winnerId: null, startedAt: "2026-10-15T01:00:00Z", submittedAt: null, crossApprovalIdAtStart: null,
  sets: [{ setIndex: 1, homePoints: 0, awayPoints: 0, confirmed: false, excluded: false, exclusionReason: null }],
  title: "A组小组赛", courtName: "主场地", netHeightCm: 243, targetPoints: 25, capPoints: 29,
  home: { ref: "team:A1", team: { drawCode: "A1", name: "甲队" } }, away: { ref: "team:A2", team: { drawCode: "A2", name: "乙队" } }, canStart: false, needsReview: false, courtBusyMatchCode: null }; }
function journal() {
  const entries = new Map<string, PendingScore>();
  const store: ScoreJournal = { read: () => structuredClone([...entries.values()]), put: (item) => { entries.set(item.command.requestId, structuredClone(item)); }, remove: (id) => { entries.delete(id); }, clear: () => entries.clear() };
  return { store, entries };
}
function endpoint() {
  let match = initial(); const received: ScoreCommand[] = []; const receipts = new Map<string, number>();
  const send = async (command: ScoreCommand): Promise<ScoreResponse> => {
    received.push(structuredClone(command));
    const old = receipts.get(command.requestId);
    if (old) return { receipt: { requestId: command.requestId, appliedVersion: old, replayed: true }, match: structuredClone(match) };
    if (command.expectedVersion !== match.version) throw new ScoringError("VERSION_CONFLICT", "服务器版本已变化", 409, structuredClone(match));
    match = { ...match, ...reduceScore(match, command.action, actor.role) }; receipts.set(command.requestId, match.version);
    return { receipt: { requestId: command.requestId, appliedVersion: match.version, replayed: false }, match: structuredClone(match) };
  };
  return { send, received, current: () => structuredClone(match) };
}

test("离线逐分立即反馈但标待同步；持久记录重建后按原ID与版本顺序发送", async () => {
  const { store, entries } = journal(); const server = endpoint(); let online = false;
  const queue = new ScoreQueue({ actor, match: initial(), journal: store, transport: server.send, online: () => online });
  queue.enqueue({ type: "POINT", setIndex: 1, side: "home", delta: 1 }); queue.enqueue({ type: "POINT", setIndex: 1, side: "away", delta: 1 });
  assert.equal(queue.getSnapshot().pending.length, 2); assert.equal(queue.getSnapshot().match.sets[0].homePoints, 1); assert.equal(server.current().sets[0].homePoints, 0);
  const ids = store.read().map((item) => item.command.requestId); queue.dispose();
  const restored = new ScoreQueue({ actor, match: initial(), journal: store, transport: server.send, online: () => online });
  online = true; await restored.sync();
  assert.deepEqual(server.received.map((item) => item.requestId), ids); assert.deepEqual(server.received.map((item) => item.expectedVersion), [1, 2]);
  assert.equal(entries.size, 0); assert.equal(restored.getSnapshot().server.sets[0].awayPoints, 1);
});

test("服务器已加分但回执丢失：恢复重放原请求只计一次，并读取后来更高版本", async () => {
  const { store } = journal(); const server = endpoint(); let lose = true;
  const transport = async (command: ScoreCommand) => { const response = await server.send(command); if (lose) { lose = false; throw new TypeError("response lost"); } return response; };
  const queue = new ScoreQueue({ actor, match: initial(), journal: store, transport });
  queue.enqueue({ type: "POINT", setIndex: 1, side: "home", delta: 1 });
  while (queue.getSnapshot().syncing) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(store.read().length, 1); assert.equal(server.current().sets[0].homePoints, 1);
  await server.send({ requestId: randomUUID(), expectedVersion: 2, action: { type: "POINT", setIndex: 1, side: "home", delta: 1 } });
  await queue.sync(); assert.equal(server.current().sets[0].homePoints, 2); assert.equal(queue.getSnapshot().match.sets[0].homePoints, 2); assert.equal(store.read().length, 0);
});

test("恢复时版本冲突不自动换ID、改版本或覆盖；需明确选择采用服务器成绩才清除", async () => {
  const { store } = journal(); const server = endpoint(); let online = false;
  const queue = new ScoreQueue({ actor, match: initial(), journal: store, transport: server.send, online: () => online });
  queue.enqueue({ type: "POINT", setIndex: 1, side: "home", delta: 1 }); const original = structuredClone(store.read());
  await server.send({ requestId: randomUUID(), expectedVersion: 1, action: { type: "SET_SCORE", setIndex: 1, homePoints: 7, awayPoints: 5 } });
  online = true; await queue.sync();
  assert.equal(queue.getSnapshot().blocked!.code, "VERSION_CONFLICT"); assert.deepEqual(store.read(), original); assert.equal(server.current().sets[0].homePoints, 7);
  await queue.sync(); assert.equal(server.received.length, 2); // A blocked queue does not silently retry with a new version.
  assert.equal(queue.adoptServer(), true); assert.equal(queue.getSnapshot().match.sets[0].homePoints, 7); assert.equal(store.read().length, 0);
});

test("并行标签页追加独立请求不会覆盖记录；相同基准版本触发本机队列冲突", async () => {
  const { store } = journal(); const firstStore = journal(); const secondStore = journal();
  const server = endpoint();
  const options = { actor, match: initial(), transport: server.send, online: () => false };
  const first = new ScoreQueue({ ...options, journal: firstStore.store }); const second = new ScoreQueue({ ...options, journal: secondStore.store });
  first.enqueue({ type: "POINT", setIndex: 1, side: "home", delta: 1 }); second.enqueue({ type: "POINT", setIndex: 1, side: "away", delta: 1 });
  store.put(firstStore.store.read()[0]); store.put(secondStore.store.read()[0]);
  const merged = new ScoreQueue({ ...options, journal: store });
  assert.equal(store.read().length, 2); assert.equal(merged.getSnapshot().blocked!.code, "LOCAL_QUEUE_CONFLICT");
  await merged.sync(); assert.equal(server.received.length, 0);
});

test("快速双击同一加分键只建立一个请求；存储失败不伪装成本地成功", () => {
  const { store } = journal(); const server = endpoint();
  const queue = new ScoreQueue({ actor, match: initial(), journal: store, transport: server.send, online: () => false });
  assert.equal(queue.enqueue({ type: "POINT", setIndex: 1, side: "home", delta: 1 }), true);
  assert.equal(queue.enqueue({ type: "POINT", setIndex: 1, side: "home", delta: 1 }), false); assert.equal(store.read().length, 1);
  const broken = new ScoreQueue({ actor, match: initial(), journal: { read: () => [], put: () => { throw new Error("quota"); }, remove: () => {} }, transport: server.send });
  assert.equal(broken.enqueue({ type: "POINT", setIndex: 1, side: "home", delta: 1 }), false); assert.equal(broken.getSnapshot().match.sets[0].homePoints, 0); assert.ok(broken.getSnapshot().error);
});

test("旧会话记录不自动转交新访问码版本，未知/损坏记录不静默丢弃", () => {
  const { store } = journal(); const server = endpoint();
  const first = new ScoreQueue({ actor, match: initial(), journal: store, transport: server.send, online: () => false });
  first.enqueue({ type: "POINT", setIndex: 1, side: "home", delta: 1 });
  const changed = new ScoreQueue({ actor: { ...actor, version: 2 }, match: initial(), journal: store, transport: server.send });
  assert.equal(changed.getSnapshot().blocked!.code, "SESSION_CHANGED"); assert.equal(store.read().length, 1);
  const broken = new ScoreQueue({ actor, match: initial(), journal: { read: () => { throw new Error("bad JSON"); }, put: () => {}, remove: () => {} }, transport: server.send });
  assert.equal(broken.getSnapshot().blocked!.code, "LOCAL_RECORD_INVALID");
});

test("离线不确认结束局/整场；提交回执到达前不显示正式完成", async () => {
  const { store } = journal(); const server = endpoint(); const online = false;
  const queue = new ScoreQueue({ actor, match: initial(), journal: store, transport: server.send, online: () => online });
  assert.equal(queue.enqueue({ type: "SUBMIT_MATCH" }), false); assert.equal(store.read().length, 0);
  const scored = { ...initial(), sets: [{ ...initial().sets[0], homePoints: 1 }] };
  let release!: (result: ScoreResponse) => void;
  const gate = new Promise<ScoreResponse>((resolve) => { release = resolve; });
  const submitting = new ScoreQueue({ actor, match: scored, journal: journal().store, transport: () => gate });
  submitting.enqueue({ type: "SUBMIT_MATCH" }); assert.equal(submitting.getSnapshot().match.status, "LIVE"); assert.equal(submitting.getSnapshot().controlPending, true);
  const match = { ...scored, ...reduceScore(scored, { type: "SUBMIT_MATCH" }, "SCORER") };
  const command = submitting.getSnapshot().pending[0].command;
  release({ receipt: { requestId: command.requestId, appliedVersion: 2, replayed: false }, match });
  while (submitting.getSnapshot().syncing) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(submitting.getSnapshot().match.status, "FINISHED");
});

test("旧轮询/迟到响应不能把更高版本的服务器快照退回", () => {
  const server = endpoint(); const queue = new ScoreQueue({ actor, match: initial(), journal: journal().store, transport: server.send });
  const latest = initial(); latest.version = 5; latest.sets[0].homePoints = 4;
  queue.receiveServer(latest); queue.receiveServer(initial()); assert.equal(queue.getSnapshot().match.version, 5); assert.equal(queue.getSnapshot().match.sets[0].homePoints, 4);
});

test("同场地开赛被明确拒绝后不保留自动开赛队列，场地空出后必须人工重新点击", async () => {
  const { store } = journal(); const fresh = { ...initial(), status: "NOT_STARTED" as const, version: 0, sets: [], startedAt: null, canStart: true };
  const requests: ScoreCommand[] = []; let busy = true;
  const queue = new ScoreQueue({ actor, match: fresh, journal: store, transport: async (command) => {
    requests.push(command);
    if (busy) throw new ScoringError("COURT_BUSY", "主场地已有 M03 比赛进行中", 409, { ...fresh, courtBusyMatchCode: "M03" });
    return { receipt: { requestId: command.requestId, appliedVersion: 1, replayed: false }, match: { ...fresh, ...reduceScore(fresh, command.action, "SCORER") } };
  } });
  queue.enqueue({ type: "START" }); while (queue.getSnapshot().syncing) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(store.read().length, 0); assert.equal(queue.getSnapshot().match.status, "NOT_STARTED"); assert.equal(queue.getSnapshot().blocked, null);
  assert.equal(queue.getSnapshot().server.courtBusyMatchCode, "M03"); assert.equal(queue.getSnapshot().error, null); await queue.sync(); assert.equal(requests.length, 1);
  busy = false; queue.receiveServer(fresh); await queue.sync(); assert.equal(requests.length, 1); assert.equal(queue.getSnapshot().error, null);
  assert.equal(queue.enqueue({ type: "START" }), true); while (queue.getSnapshot().syncing) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(queue.getSnapshot().match.status, "LIVE"); assert.notEqual(requests[1].requestId, requests[0].requestId);
});

test("开赛断网或不完整拒绝回执仍保留原请求，不将未知结果当成明确未开赛", async () => {
  const fresh = { ...initial(), status: "NOT_STARTED" as const, version: 0, sets: [], startedAt: null, canStart: true };
  for (const failure of [new Error("network"), new ScoringError("COURT_BUSY", "暂不能开赛", 409)]) {
    const { store } = journal(); const queue = new ScoreQueue({ actor, match: fresh, journal: store, transport: async () => { throw failure; } });
    queue.enqueue({ type: "START" }); while (queue.getSnapshot().syncing) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(store.read().length, 1); assert.equal(queue.getSnapshot().match.status, "NOT_STARTED");
  }
});
