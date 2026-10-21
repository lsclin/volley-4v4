import { mkdtemp, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const directory = await mkdtemp(path.join(os.tmpdir(), "volley-4v4-suite-"));
try {
  const files = (await readdir("tests/four-v-four")).filter((name) => name.endsWith(".test.ts")).map((name) => path.join("tests/four-v-four", name));
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "--test-reporter=spec", ...files], {
    encoding: "utf8", env: { ...process.env, FOUR_V_FOUR_TEST_ROOT: directory }, maxBuffer: 4 * 1024 * 1024,
  });
  process.stdout.write(result.stdout || ""); process.stderr.write(result.stderr || "");
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("volley-4v4-suite-")) throw new Error("拒绝清理测试沙箱以外的路径");
  await rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
