import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { stripBuildEnvironment } from "./cloudflare-build-output.mjs";

const require = createRequire(import.meta.url);
const command = path.resolve(path.dirname(require.resolve("@opennextjs/cloudflare")), "../cli/index.js");
const result = spawnSync(process.execPath, [command, "build"], {
  stdio: "inherit", windowsHide: true,
  env: { ...process.env, FOUR_V_FOUR_DEPLOY_TARGET: "cloudflare", NEXT_TELEMETRY_DISABLED: "1" },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (result.status === 0) {
  await stripBuildEnvironment(path.resolve(".open-next"));
  console.log("Cloudflare构建完成；已移除本机环境默认值。未上传、部署或连接云库。");
}
