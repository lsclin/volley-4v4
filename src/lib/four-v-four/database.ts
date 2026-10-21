import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../../generated/four-v-four/index.js";
import { resolveFourVFourDatabaseUrl } from "./database-url.ts";

export function createFourVFourClient(url = resolveFourVFourDatabaseUrl(process.env), authToken = process.env.FOUR_V_FOUR_AUTH_TOKEN) {
  const isolatedUrl = resolveFourVFourDatabaseUrl({ ...process.env, FOUR_V_FOUR_DATABASE_URL: url });
  if (process.env.FOUR_V_FOUR_DEPLOY_TARGET === "cloudflare" && !authToken?.trim()) throw new Error("Cloudflare需要独立libSQL数据库令牌");
  return new PrismaClient({ adapter: new PrismaLibSql({ url: isolatedUrl, authToken }) });
}

const globalDatabase = globalThis as unknown as { fourVFour?: PrismaClient };
// Lazy: importing this module never opens or changes the old site's database.
export function getFourVFourDatabase(): PrismaClient {
  globalDatabase.fourVFour ??= createFourVFourClient();
  return globalDatabase.fourVFour;
}
