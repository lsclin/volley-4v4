import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/** @param {string} outputDirectory */
export async function stripBuildEnvironment(outputDirectory) {
  const file = path.join(outputDirectory, "cloudflare/next-env.mjs");
  // OpenNext writes local .env values here. Wrangler bundles this module later.
  // Credentials must come only from Worker secrets / local .dev.vars at runtime.
  const original = await readFile(file, "utf8");
  if (!["production", "development", "test"].every((mode) => original.includes(`export const ${mode}`))) throw new Error("未知OpenNext环境文件格式，拒绝生成可发布构建");
  await writeFile(file, 'export const production = {};\nexport const development = {};\nexport const test = {};\n');
  const serverDirectory = path.join(outputDirectory, "server-functions/default");
  const entries = await readdir(serverDirectory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) if (entry.isFile() && /^\.env(?:\.|$)/.test(entry.name)) await unlink(path.join(serverDirectory, entry.name));
}
