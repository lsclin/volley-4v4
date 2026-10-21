// Optional browser integration runner. No product/production environment file is loaded.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, access, writeFile } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { createFourVFourClient } from "../src/lib/four-v-four/database.ts";
import { migrateFourVFour } from "../src/lib/four-v-four/migrate.ts";
import { generateAccessCode, setAccessCode } from "../src/lib/four-v-four/credentials.ts";
import { readPublicSchedule } from "../src/lib/four-v-four/repository.ts";
import { assertPrincipal } from "../src/lib/four-v-four/scoring-service.ts";
import { backupLocalDatabase, restoreLocalDatabase } from "../src/lib/four-v-four/local-backup.ts";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require(process.env.FOUR_V_FOUR_PLAYWRIGHT_MODULE || "playwright"); }
catch { throw new Error("需提供已有Playwright模块：设置FOUR_V_FOUR_PLAYWRIGHT_MODULE，不会自动安装浏览器或依赖"); }
await access(".next/BUILD_ID");
const root = path.resolve("data/field-tests"); await mkdir(root, { recursive: true });
const directory = await mkdtemp(path.join(root, "event-"));
const reportDirectory = path.resolve("artifacts/reviews/phase-5"); await mkdir(reportDirectory, { recursive: true });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
async function freePort() {
  const server = net.createServer(); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port;
}
async function run(mode) {
  const databaseUrl = `file:${path.join(directory, `${mode}.db`)}`;
  await migrateFourVFour({ FOUR_V_FOUR_DATABASE_URL: databaseUrl });
  const seed = createFourVFourClient(databaseUrl, ""); const adminCode = generateAccessCode();
  await setAccessCode(seed, "admin", adminCode); await seed.$disconnect();
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const secret = randomBytes(48).toString("base64url");
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "--hostname", "127.0.0.1"], {
    cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production", FOUR_V_FOUR_DATABASE_URL: databaseUrl, FOUR_V_FOUR_AUTH_TOKEN: "", FOUR_V_FOUR_SESSION_SECRET: secret, FOUR_V_FOUR_SITE_ORIGIN: base, FOUR_V_FOUR_ALLOW_LOCAL_HTTP: "1" },
  });
  let browser, edge; let serverLog = "";
  child.stdout.on("data", (data) => serverLog += data); child.stderr.on("data", (data) => serverLog += data);
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch { /* wait for only our child */ } if (child.exitCode !== null || i === 99) throw new Error("isolated server not ready"); await pause(200); }
    browser = await playwright.chromium.launch({ channel: "chrome", headless: true });
    const contexts = await Promise.all([
      browser.newContext({ viewport: { width: 375, height: 812 } }),
      browser.newContext({ ...playwright.devices["Pixel 7"] }),
      browser.newContext({ ...playwright.devices["iPhone 13"] }),
      browser.newContext({ viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true }),
    ]);
    const [admin, main, secondary, spectator] = contexts;
    const principals = [];
    const login = async (context, code) => {
      const response = await context.request.post(`${base}/api/manage/login`, { headers: { Origin: base }, data: { accessCode: code } });
      assert.equal(response.status(), 200); const cookie = response.headers()["set-cookie"];
      assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Strict/i); assert.ok(cookie.includes("ustc-4v4-session"));
      principals.push((await response.json()).actor);
    };
    await login(admin, adminCode);
    const state = async () => { const r = await admin.request.get(`${base}/api/manage/tournament`); assert.equal(r.status(), 200); return r.json(); };
    const manage = async (action) => {
      const current = await state(); const r = await admin.request.post(`${base}/api/manage/tournament`, { headers: { Origin: base }, data: { expectedRevision: current.tournament?.revision ?? null, action } });
      assert.equal(r.status(), 200, await r.text()); return r.json();
    };
    const getMatch = async (context, code) => { const r = await context.request.get(`${base}/api/scorer/matches/${code}`); assert.equal(r.status(), 200); return (await r.json()).match; };
    const command = async (context, code, action) => ({ requestId: randomUUID(), expectedVersion: (await getMatch(context, code)).version, action });
    const rawScore = (context, code, input) => context.request.post(`${base}/api/scorer/matches/${code}`, { headers: { Origin: base }, data: input });
    const score = async (context, code, action) => {
      const input = await command(context, code, action); const r = await rawScore(context, code, input);
      assert.equal(r.status(), 200, await r.text()); return { ...(await r.json()), input };
    };
    const publicState = async () => {
      const r = await spectator.request.get(`${base}/api/schedule`); assert.match(r.headers()["cache-control"], /no-store/); return r.json();
    };
    await manage({ type: "INITIALIZE", mode, name: `阶段5隔离赛事-${mode}` });
    assert.equal((await publicState()).publication, "draft");
    await manage({ type: "TEAMS", names: Object.fromEntries((await state()).teams.map((team) => [team.drawCode, team.drawCode.endsWith("1") ? `中国科学技术大学学生排球协会长队名联调${team.drawCode}` : `联调队${team.drawCode}`])) });
    const codes = {};
    for (const target of ["main", "secondary"]) {
      codes[target] = randomBytes(16).toString("base64url");
      await manage({ type: "SET_SCORER_PASSWORD", target, password: codes[target], expectedCredentialVersion: null });
    }
    await Promise.all([login(main, codes.main), login(secondary, codes.secondary)]);
    const secure = await admin.request.post(`${base}/api/manage/login`, { headers: { Origin: base, Host: "volley-test.example" }, data: { accessCode: adminCode } });
    assert.equal(secure.status(), 200); assert.match(secure.headers()["set-cookie"], /; Secure/i);
    // Restore the localhost preview cookie after inspecting secure policy for non-local hosts.
    await login(admin, adminCode);
    await manage({ type: "PUBLISH_SCHEDULE" });
    const initial = await state(); assert.equal(initial.matches.length, mode === 8 ? 18 : 27);
    const first = Object.fromEntries(["main", "secondary"].map((court) => [court, initial.matches.find((match) => match.courtId === court && match.stage === "GROUP")]));
    assert.equal((await main.request.get(`${base}/api/manage/tournament`)).status(), 403);
    assert.equal((await spectator.request.get(`${base}/api/manage/tournament`)).status(), 401);
    assert.equal((await main.request.get(`${base}/api/scorer/matches/${first.secondary.code}`)).status(), 403);
    assert.equal((await main.request.post(`${base}/api/manage/tournament`, { headers: { Origin: base }, data: { expectedRevision: initial.tournament.revision, action: { type: "PUBLISH_SCHEDULE" } } })).status(), 403);
    assert.equal((await admin.request.post(`${base}/api/manage/tournament`, { headers: { Origin: "https://elsewhere.example" }, data: {} })).status(), 403);
    for (const url of ["/.env", "/.env.local", "/data/four-v-four.db", "/prisma/four-v-four/schema.prisma"]) assert.equal((await spectator.request.get(base + url)).status(), 404);
    const privateRead = await admin.request.get(`${base}/api/manage/tournament`); assert.match(privateRead.headers()["cache-control"], /no-store/); assert.match(privateRead.headers().vary, /Cookie/);
    await Promise.all([score(main, first.main.code, { type: "START" }), score(secondary, first.secondary.code, { type: "START" })]);
    const [mainPage, sidePage, watch, adminPage] = await Promise.all([main.newPage(), secondary.newPage(), spectator.newPage(), admin.newPage()]);
    const pageErrors = []; for (const page of [mainPage, sidePage, watch, adminPage]) page.on("pageerror", (error) => pageErrors.push(error.message));
    await Promise.all([mainPage.goto(`${base}/score/${first.main.code}`), sidePage.goto(`${base}/score/${first.secondary.code}`), watch.goto(base)]);
    await mainPage.getByRole("button", { name: "左队加1分", exact: true }).waitFor();
    const point = { type: "POINT", setIndex: 1, side: "home", delta: 1 };
    const mainPoint = await command(main, first.main.code, point), sidePoint = await command(secondary, first.secondary.code, point);
    const writes = await Promise.all([rawScore(main, first.main.code, mainPoint), rawScore(secondary, first.secondary.code, sidePoint), manage({ type: "CONFIG", name: initial.tournament.name, location: initial.tournament.location, rulesText: initial.tournament.rulesText, noticeText: "两名记分员和管理员并发联调" })]);
    assert.equal(writes[0].status(), 200); assert.equal(writes[1].status(), 200);
    for (const court of ["main", "secondary"]) await watch.locator(`[data-court="${court}"] .board-points strong`).filter({ hasText: "1 : 0" }).waitFor();
    const replay = await Promise.all([rawScore(main, first.main.code, mainPoint), rawScore(main, first.main.code, mainPoint)]);
    for (const response of replay) { assert.equal(response.status(), 200); assert.equal((await response.json()).receipt.replayed, true); }
    assert.equal((await getMatch(main, first.main.code)).sets[0].homePoints, 1);
    const competingVersion = (await getMatch(main, first.main.code)).version;
    const races = await Promise.all([rawScore(main, first.main.code, { requestId: randomUUID(), expectedVersion: competingVersion, action: point }), rawScore(admin, first.main.code, { requestId: randomUUID(), expectedVersion: competingVersion, action: { ...point, side: "away" } })]);
    assert.deepEqual(races.map((r) => r.status()).sort(), [200, 409]);
    const current = await getMatch(main, first.main.code);
    console.log(`${mode}队：并发记分、请求重放与版本冲突通过，检查断网恢复`);
    await mainPage.waitForFunction((value) => document.querySelector(".operator-points")?.textContent === `${value.homePoints} : ${value.awayPoints}`, current.sets[0]);
    const journal = () => mainPage.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("ustc4v4:score:")).map((key) => JSON.parse(localStorage.getItem(key))));
    await main.setOffline(true); await mainPage.getByRole("button", { name: "左队加1分", exact: true }).click();
    await mainPage.locator('[data-sync-state="未同步"]').waitFor(); assert.equal((await journal()).length, 1);
    if (mode === 10) await score(admin, first.main.code, { ...point, side: "away" });
    await main.setOffline(false);
    if (mode === 10) {
      await mainPage.getByRole("heading", { name: "成绩需要核对", exact: true }).waitFor(); assert.equal((await journal()).length, 1);
      await mainPage.getByRole("button", { name: "核对后采用服务器成绩", exact: true }).click(); await mainPage.getByRole("button", { name: "确认采用服务器成绩", exact: true }).click();
    }
    await mainPage.locator('[data-sync-state="已同步"]').waitFor(); assert.equal((await journal()).length, 0);
    if (mode === 8) {
      await pause(200);
      const beforeLost = await getMatch(main, first.main.code); let resolveApplied;
      const applied = new Promise((resolve) => resolveApplied = resolve);
      const pattern = `**/api/scorer/matches/${first.main.code}`;
      await mainPage.route(pattern, async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const response = await route.fetch(); assert.equal(response.status(), 200);
        await main.setOffline(true); await route.abort("failed"); resolveApplied();
      });
      await mainPage.getByRole("button", { name: "左队加1分", exact: true }).click();
      await Promise.race([applied, pause(5000).then(() => { throw new Error("未捕获到预期的丢失回执请求"); })]);
      await mainPage.locator('[data-sync-state="未同步"]').waitFor(); assert.equal((await journal()).length, 1);
      const once = await getMatch(admin, first.main.code); assert.equal(once.sets[0].homePoints, beforeLost.sets[0].homePoints + 1);
      await mainPage.unroute(pattern); await main.setOffline(false); await mainPage.locator('[data-sync-state="已同步"]').waitFor();
      assert.equal((await getMatch(admin, first.main.code)).sets[0].homePoints, once.sets[0].homePoints);
    }
    // A double click must produce one point, not two; use the actual mobile controls.
    const beforeDouble = await getMatch(main, first.main.code); await pause(200);
    await mainPage.getByRole("button", { name: "左队加1分", exact: true }).dblclick();
    await mainPage.locator('[data-sync-state="已同步"]').waitFor();
    assert.equal((await getMatch(main, first.main.code)).sets[0].homePoints, beforeDouble.sets[0].homePoints + 1);
    console.log(`${mode}队：断网恢复与双击保护通过，完成剩余赛事`);
    const finish = async (context, match, threeSets = false) => {
      const latest = await getMatch(context, match.code); if (latest.status === "FINISHED") return;
      if (latest.status === "NOT_STARTED") await score(context, match.code, { type: "START" });
      const homeWins = match.stage !== "GROUP" || match.home.team.drawCode < match.away.team.drawCode;
      const count = match.format === "BO1" ? 1 : threeSets ? 3 : 2;
      for (let index = 1; index <= count; index++) {
        const leftWins = threeSets && index === 2 ? false : homeWins;
        await score(context, match.code, { type: "SET_SCORE", setIndex: index, homePoints: leftWins ? match.format === "BO1" ? 25 : 15 : 11, awayPoints: leftWins ? 11 : match.format === "BO1" ? 25 : 15 });
        if (match.format === "BO3") await score(context, match.code, { type: "CONFIRM_SET", setIndex: index });
      }
      const submitted = await score(context, match.code, { type: "SUBMIT_MATCH" });
      const duplicate = await rawScore(context, match.code, submitted.input); assert.equal(duplicate.status(), 200); assert.equal((await duplicate.json()).receipt.replayed, true);
      const locked = await rawScore(context, match.code, { requestId: randomUUID(), expectedVersion: submitted.match.version, action: { type: "SET_SCORE", setIndex: 1, homePoints: 99, awayPoints: 0 } }); assert.equal(locked.status(), 423);
    };
    await Promise.all([...["main", "secondary"].map((court) => (async () => {
      for (const match of initial.matches.filter((row) => row.stage === "GROUP" && row.courtId === court)) await finish(court === "main" ? main : secondary, match);
    })()), manage({ type: "CONFIG", name: initial.tournament.name, location: initial.tournament.location, rulesText: initial.tournament.rulesText, noticeText: "独立场地推进中" })]);
    await mainPage.reload(); await mainPage.getByText("整场已提交，成绩锁定。只有管理员可以修正。", { exact: true }).waitFor(); assert.equal(await mainPage.getByRole("button", { name: "左队加1分", exact: true }).count(), 0);
    let pub = await publicState(); assert.equal(pub.crossPublished, false); assert.ok(pub.matches.filter((match) => match.stage !== "GROUP").every((match) => !match.home.team && !match.away.team));
    const groupsDone = await state(); assert.ok(groupsDone.groups.every((group) => group.complete && !group.unresolved));
    await manage({ type: "CONFIRM_CROSS", sourceRevision: groupsDone.tournament.groupResultsRevision, tieBreaks: {}, reason: "", acknowledgePlayed: false });
    const cross = (await state()).matches.filter((match) => match.stage !== "GROUP");
    await Promise.all([...["main", "secondary"].map((court) => (async () => {
      for (const match of cross.filter((row) => row.stage === "PLACEMENT" && row.courtId === court)) await finish(court === "main" ? main : secondary, match);
    })())]);
    for (const stage of ["SEMIFINAL", "THIRD_PLACE", "FINAL"]) for (const match of cross.filter((row) => row.stage === stage)) await finish(match.courtId === "main" ? main : secondary, match, stage === "SEMIFINAL");
    pub = await publicState(); assert.equal(pub.allFinished, true); assert.equal(pub.finalPublished, false); assert.deepEqual(pub.finalStandings, []);
    await adminPage.goto(`${base}/manage`); await adminPage.getByRole("button", { name: "成绩发布", exact: true }).click();
    const pendingResponse = adminPage.waitForResponse((response) => response.url() === `${base}/api/manage/tournament` && response.request().method() === "POST");
    adminPage.once("dialog", (dialog) => { assert.match(dialog.message(), /完整最终名次.*正式公布/); void dialog.accept(); });
    await adminPage.getByRole("button", { name: "确认并公布最终名次", exact: true }).click(); assert.equal((await pendingResponse).status(), 200);
    pub = await publicState(); assert.equal(pub.finalStandings.length, mode); assert.equal(pub.finalPublished, true);
    await watch.goto(`${base}/rankings`); await watch.locator(".final-ranking li").last().waitFor(); assert.equal(await watch.locator(".final-ranking li").count(), mode);
    const serialized = JSON.stringify(pub); for (const hidden of ["codeHash", "approvedBy", "requestId", "credentialId", "resultsRevision", adminCode, codes.main, codes.secondary, secret]) assert.ok(!serialized.includes(hidden));
    // Only existing desktop engines are available. iPhone sizing above is Chromium, not Safari.
    edge = await playwright.chromium.launch({ channel: "msedge", headless: true });
    const edgePage = await edge.newPage({ viewport: { width: 375, height: 812 } }); edgePage.on("pageerror", (error) => pageErrors.push(error.message));
    for (const route of ["/", "/schedule", "/rankings", "/rules"]) {
      await edgePage.goto(base + route); await edgePage.locator(".hero, .tabs, .final-ranking, .rules-body").first().waitFor();
      assert.ok(await edgePage.locator("main").innerText()); assert.ok(await edgePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    assert.deepEqual(pageErrors, []);
    const db = createFourVFourClient(databaseUrl, "");
    try {
      const backup = path.join(directory, `${mode}-backup.db`); await backupLocalDatabase({ FOUR_V_FOUR_DATABASE_URL: databaseUrl }, backup);
      const restoredUrl = `file:${path.join(directory, `${mode}-restore.db`)}`; await restoreLocalDatabase(backup, { FOUR_V_FOUR_DATABASE_URL: restoredUrl });
      const restored = createFourVFourClient(restoredUrl, "");
      try {
        assert.deepEqual(await readPublicSchedule(restored), pub);
        assert.equal(await restored.scoreAction.count(), await db.scoreAction.count());
        for (const target of ["admin", "main", "secondary"]) await setAccessCode(restored, target, generateAccessCode());
        for (const principal of principals) await assert.rejects(assertPrincipal(restored, principal));
      } finally { await restored.$disconnect(); }
    } finally { await db.$disconnect(); }
    const result = { mode, matches: pub.matches.length, status: "PASS", engine: `Chrome ${browser.version()}`, mobile: "Pixel 7 / iPhone 13 size and touch emulation on desktop Chromium; not real devices", edge: edge.version(), checks: ["empty initialization and draw names", "three independent authenticated contexts and spectator polling", "simultaneous courts and administrator", "request replay", "version conflict", mode === 8 ? "offline recovery and lost receipt retry" : "offline conflicting update and explicit adoption", "double tap protection", "BO1/BO3 and whole-match lock", "cross and final publication gates", "read-only public projection and CSRF/cookie checks", "backup/restore and session revocation"], realAndroid: "NOT TESTED", realSafari: "NOT TESTED", cloud: "NOT TESTED" };
    results.push(result); console.log(`${mode}队 ${pub.matches.length}场：完整HTTP/多角色/浏览器联调通过`);
  } finally {
    if (edge) await edge.close(); if (browser) await browser.close();
    const stopped = new Promise((resolve) => child.once("exit", resolve)); if (child.exitCode === null) { child.kill(); await stopped; }
    await writeFile(path.join(reportDirectory, `${mode}-server.log`), serverLog);
  }
}
try {
  await run(8); await run(10);
  await writeFile(path.join(reportDirectory, "integration-results.json"), JSON.stringify({ browserProvider: "Browser plugin not available; existing Playwright and desktop Chrome/Edge", directory, results }, null, 2));
} catch (error) { console.error(error); process.exitCode = 1; }
