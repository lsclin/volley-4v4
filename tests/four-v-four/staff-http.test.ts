import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSameOrigin } from "../../src/lib/four-v-four/staff-origin.ts";
import { readSmallJson } from "../../src/lib/four-v-four/staff-http.ts";
import { ScoringError } from "../../src/lib/four-v-four/scoring-types.ts";

test("Next内部URL规范化后仍按浏览器实际Host检查来源，正式部署可显式绑定HTTPS域名", () => {
  const request = (origin: string, host = "127.0.0.1:4416") => new Request("http://localhost:4416/api/manage/login", { headers: { host, origin } });
  assert.doesNotThrow(() => assertSameOrigin(request("http://127.0.0.1:4416")));
  assert.throws(() => assertSameOrigin(request("http://elsewhere.test")), (error) => error instanceof ScoringError && error.status === 403);
  assert.throws(() => assertSameOrigin(new Request("http://localhost:4416")), ScoringError);
  assert.doesNotThrow(() => assertSameOrigin(request("https://event.example"), "https://event.example"));
  assert.throws(() => assertSameOrigin(request("http://127.0.0.1:4416"), "https://event.example"), ScoringError);
});

test("记分JSON读取有8KB流式上限，非法/过大输入不进入业务事务", async () => {
  const request = (body: string) => new Request("http://localhost", { method: "POST", body });
  assert.deepEqual(await readSmallJson(request('{"hello":1}')), { hello: 1 });
  await assert.rejects(readSmallJson(request("not-json")), (error) => error instanceof ScoringError && error.status === 400);
  await assert.rejects(readSmallJson(request(JSON.stringify("a".repeat(8192)))), (error) => error instanceof ScoringError && error.status === 413);
});
