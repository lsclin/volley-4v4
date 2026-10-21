import { spawnSync } from "node:child_process";
import path from "node:path";

const result = spawnSync(process.execPath, [path.resolve("node_modules/wrangler/bin/wrangler.js"), "dev", "--local", "--port", "8787", ...process.argv.slice(2)], {
  stdio: "inherit", windowsHide: true,
  // A local Worker must not inherit the ordinary site's .env database settings.
  env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false", WRANGLER_SEND_METRICS: "false" },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
