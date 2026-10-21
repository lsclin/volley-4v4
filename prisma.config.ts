import { config } from "dotenv";
import { defineConfig } from "prisma/config";
import { resolveFourVFourDatabaseUrl } from "./src/lib/four-v-four/database-url";

config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "prisma/four-v-four/schema.prisma",
  migrations: { path: "prisma/four-v-four/migrations" },
  // Client generation does not open a database.
  // The migration runner and runtime enforce explicit production configuration.
  datasource: { url: resolveFourVFourDatabaseUrl({ ...process.env, NODE_ENV: "development", FOUR_V_FOUR_DEPLOY_TARGET: "node" }) },
});
