import { ScoringError } from "./scoring-types.ts";
import type { ScoreAction, ScoreSet, ScoringState } from "./scoring-types.ts";

const MAX_POINTS = 2_147_483_647; // SQLite/Prisma Int input range; never a volleyball score threshold.
function points(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_POINTS) throw new ScoringError("INVALID_POINTS", "比分必须为可存储的非负整数");
}
function setLimit(state: ScoringState, index: number) {
  if (!Number.isInteger(index) || index < 1 || index > (state.format === "BO1" ? 1 : 3)) throw new ScoringError("INVALID_SET", "局号不正确");
}
function equal(set: ScoreSet) { return set.homePoints === set.awayPoints; }

// Preserve every raw row; eligibility and confirmation are recomputed without score-threshold decisions.
export function normalizeSets(state: ScoringState) {
  const sets = state.sets.sort((a, b) => a.setIndex - b.setIndex);
  let home = 0, away = 0;
  for (const set of sets) {
    points(set.homePoints); points(set.awayPoints); setLimit(state, set.setIndex);
    const exclude = state.format === "BO3" && (home >= 2 || away >= 2);
    const wasExcluded = set.excluded;
    set.excluded = exclude; set.exclusionReason = exclude ? "前两局修正后形成2:0，本局不计入正式成绩" : null;
    if (exclude) continue;
    if (set.confirmed && equal(set)) {
      if (wasExcluded) set.confirmed = false; // A reactivated tied raw set needs manual completion.
      else throw new ScoringError("WINNER_REQUIRED", "已确认局不能同分，请补全能够确定胜者的比分");
    }
    if (!set.confirmed) break;
    if (set.homePoints > set.awayPoints) home++; else away++;
  }
  const decided = state.format === "BO1" ? home + away === 1 : home === 2 || away === 2;
  const winnerId = decided ? home > away ? state.homeTeamId : state.awayTeamId : null;
  return { home, away, decided, winnerId };
}

function ensureCurrent(state: ScoringState) {
  const total = normalizeSets(state);
  if (total.decided) return null;
  let current = state.sets.find((set) => !set.confirmed && !set.excluded);
  if (!current) {
    const index = state.sets.filter((set) => !set.excluded && set.confirmed).length + 1;
    setLimit(state, index);
    current = { setIndex: index, homePoints: 0, awayPoints: 0, confirmed: false, excluded: false, exclusionReason: null };
    state.sets.push(current);
  }
  return current;
}

export function reduceScore(original: ScoringState, action: ScoreAction, role: "ADMIN" | "SCORER", now = new Date().toISOString()): ScoringState {
  const state = structuredClone(original);
  if (state.status === "FINISHED" && !(role === "ADMIN" && action.type === "CORRECT_RESULT")) throw new ScoringError("MATCH_LOCKED", "整场已提交，仅管理员可修正成绩", 423);
  if (action.type === "CORRECT_RESULT") {
    if (role !== "ADMIN") throw new ScoringError("FORBIDDEN", "只有管理员可以修正已提交成绩", 403);
    if (state.status !== "FINISHED") throw new ScoringError("INVALID_STATE", "请在进行中比赛中使用比分修改");
    if (!action.sets.length || new Set(action.sets.map((set) => set.setIndex)).size !== action.sets.length) throw new ScoringError("INVALID_SET", "请提供不重复的完整局分");
    for (const input of action.sets) {
      setLimit(state, input.setIndex); points(input.homePoints); points(input.awayPoints);
      const old = state.sets.find((set) => set.setIndex === input.setIndex);
      if (old) Object.assign(old, input, { confirmed: true });
      else state.sets.push({ ...input, confirmed: true, excluded: false, exclusionReason: null });
    }
    // Always require the first two BO3 sets / the BO1 set in the correction form.
    if (!action.sets.some((set) => set.setIndex === 1) || (state.format === "BO3" && !action.sets.some((set) => set.setIndex === 2))) throw new ScoringError("INCOMPLETE_RESULT", "请填写全部正式局分");
    const result = normalizeSets(state);
    if (!result.decided || !result.winnerId) throw new ScoringError("INCOMPLETE_RESULT", "局分尚不能确定整场胜者，请补全相关局分");
    state.winnerId = result.winnerId;
  } else if (action.type === "START") {
    if (state.status !== "NOT_STARTED") throw new ScoringError("INVALID_STATE", "比赛已经开始，请读取最新记录", 409);
    if (!state.homeTeamId || !state.awayTeamId || state.homeTeamId === state.awayTeamId) throw new ScoringError("UNRESOLVED_MATCH", "比赛双方尚未确定", 409);
    state.status = "LIVE"; state.startedAt = now; ensureCurrent(state);
  } else {
    if (state.status !== "LIVE") throw new ScoringError("INVALID_STATE", "请先开始比赛", 409);
    const current = ensureCurrent(state);
    if (action.type === "POINT") {
      if (!current || current.setIndex !== action.setIndex) throw new ScoringError("NOT_CURRENT_SET", "只能逐分操作当前局，请重新核对局号", 409);
      const key = action.side === "home" ? "homePoints" : "awayPoints";
      current[key] += action.delta; points(current[key]);
    } else if (action.type === "SET_SCORE") {
      points(action.homePoints); points(action.awayPoints); setLimit(state, action.setIndex);
      const set = state.sets.find((row) => row.setIndex === action.setIndex);
      if (!set) throw new ScoringError("INVALID_SET", "这局尚未建立，不能跳过局号修改");
      if (set.confirmed && !set.excluded && action.homePoints === action.awayPoints) throw new ScoringError("WINNER_REQUIRED", "已确认局不能同分，请补全胜者信息");
      set.homePoints = action.homePoints; set.awayPoints = action.awayPoints;
      normalizeSets(state); ensureCurrent(state);
    } else if (action.type === "CONFIRM_SET") {
      if (state.format !== "BO3") throw new ScoringError("INVALID_ACTION", "一局制请直接核对并提交整场比赛");
      if (!current || current.setIndex !== action.setIndex) throw new ScoringError("NOT_CURRENT_SET", "当前局已变化，请重新核对", 409);
      if (equal(current)) throw new ScoringError("WINNER_REQUIRED", "双方同分，尚不能确定本局胜者，请补全比分");
      current.confirmed = true; ensureCurrent(state);
    } else if (action.type === "SUBMIT_MATCH") {
      if (state.format === "BO1") {
        const set = state.sets.find((row) => row.setIndex === 1)!;
        if (equal(set)) throw new ScoringError("WINNER_REQUIRED", "双方同分，尚不能确定整场胜者，请补全比分");
        set.confirmed = true;
      }
      const result = normalizeSets(state);
      if (!result.decided || !result.winnerId) throw new ScoringError("INCOMPLETE_RESULT", "请先人工确认全部需要的局分，再提交整场");
      state.status = "FINISHED"; state.winnerId = result.winnerId; state.submittedAt = now;
    }
  }
  state.version++;
  return state;
}
