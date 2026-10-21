import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSchedule, validateGeneratedSchedule } from "../../src/lib/four-v-four/schedule.ts";
import { teamCodes } from "../../src/lib/four-v-four/types.ts";
import type { TournamentMode } from "../../src/lib/four-v-four/types.ts";

for (const mode of [8, 10] as const) {
  test(`${mode}队：固定总场次、全部组内对手唯一且完整`, () => {
    const schedule = generateSchedule(mode);
    assert.equal(schedule.length, mode === 8 ? 18 : 27);
    const group = schedule.filter((match) => match.stage === "GROUP");
    assert.equal(group.length, mode === 8 ? 12 : 20);
    for (const code of teamCodes(mode)) {
      const own = group.filter((m) => m.homeRef === `team:${code}` || m.awayRef === `team:${code}`);
      const opponents = own.map((m) => (m.homeRef === `team:${code}` ? m.awayRef : m.homeRef).slice(5)).sort();
      assert.deepEqual(opponents, teamCodes(mode).filter((candidate) => candidate !== code && candidate[0] === code[0]));
    }
  });
  test(`${mode}队：每队主副场地出场严格满足网高均衡`, () => {
    const group = generateSchedule(mode).filter((m) => m.stage === "GROUP");
    for (const code of teamCodes(mode)) {
      const own = group.filter((m) => [m.homeRef, m.awayRef].includes(`team:${code}` as typeof m.homeRef));
      const counts = ["main", "secondary"].map((court) => own.filter((m) => m.courtId === court).length).sort();
      assert.deepEqual(counts, mode === 8 ? [1, 2] : [2, 2]);
    }
  });
  test(`${mode}队：场地队列独立、连续，不生成开赛时刻`, () => {
    const schedule = generateSchedule(mode);
    for (const court of ["main", "secondary"]) {
      const sequence = schedule.filter((m) => m.courtId === court).map((m) => m.sequence).sort((a, b) => a - b);
      assert.deepEqual(sequence, Array.from({ length: sequence.length }, (_, i) => i + 1));
    }
    assert.ok(schedule.every((m) => !("startAt" in m)));
  });
  test(`${mode}队：BO1/BO3参数、半决赛与排位赛来源`, () => {
    const schedule = generateSchedule(mode);
    for (const match of schedule) assert.deepEqual([match.format, match.targetPoints, match.capPoints], match.stage === "GROUP" ? ["BO1", 25, 29] : ["BO3", 15, 19]);
    const semis = schedule.filter((m) => m.stage === "SEMIFINAL");
    assert.deepEqual(semis.map((m) => [m.homeRef, m.awayRef]), [["rank:A:1", "rank:B:2"], ["rank:B:1", "rank:A:2"]]);
    assert.deepEqual(schedule.filter((m) => m.stage === "PLACEMENT").map((m) => m.placement), mode === 8 ? [5, 7] : [5, 7, 9]);
    assert.deepEqual(schedule.find((m) => m.stage === "FINAL")!.homeRef, `winner:${semis[0].code}`);
    assert.deepEqual(schedule.find((m) => m.stage === "THIRD_PLACE")!.awayRef, `loser:${semis[1].code}`);
  });
  test(`${mode}队：四强赛全部主场地且在主场地排位赛之后`, () => {
    const queue = generateSchedule(mode).filter((m) => m.courtId === "main" && m.stage !== "GROUP").sort((a, b) => a.sequence - b.sequence);
    assert.deepEqual(queue.map((m) => m.stage), [...Array(mode === 8 ? 1 : 2).fill("PLACEMENT"), "SEMIFINAL", "SEMIFINAL", "THIRD_PLACE", "FINAL"]);
  });
  test(`${mode}队：生成结果独立、可复现，不携带示例队名或比分`, () => {
    const first = generateSchedule(mode); first[0].sequence = 999;
    const second = generateSchedule(mode);
    assert.equal(second[0].sequence, 1);
    assert.ok(second.every((m) => !("name" in m) && !("score" in m)));
  });
}

test("拒绝8/10之外的模式", () => {
  for (const value of [0, 6, 9, 12, NaN]) assert.throws(() => generateSchedule(value as TournamentMode));
});

for (const [name, mutate] of [
  ["漏赛", (s: ReturnType<typeof generateSchedule>) => { s.pop(); }],
  ["重复编号", (s: ReturnType<typeof generateSchedule>) => { s[1].code = s[0].code; }],
  ["重复对阵", (s: ReturnType<typeof generateSchedule>) => { s[2].homeRef = s[0].homeRef; s[2].awayRef = s[0].awayRef; }],
  ["跨组对阵", (s: ReturnType<typeof generateSchedule>) => { s[0].awayRef = "team:B2"; }],
  ["网高失衡", (s: ReturnType<typeof generateSchedule>) => { s[0].courtId = "secondary"; }],
  ["错误BO1参数", (s: ReturnType<typeof generateSchedule>) => { s[0].targetPoints = 15; }],
  ["错误决赛来源", (s: ReturnType<typeof generateSchedule>) => { s.find((m) => m.stage === "FINAL")!.homeRef = "rank:A:1"; }],
  ["四强移往副场", (s: ReturnType<typeof generateSchedule>) => { s.find((m) => m.stage === "SEMIFINAL")!.courtId = "secondary"; }],
] as const) test(`赛程验证器拒绝${name}`, () => {
  const schedule = generateSchedule(8); mutate(schedule);
  assert.throws(() => validateGeneratedSchedule(8, schedule));
});
