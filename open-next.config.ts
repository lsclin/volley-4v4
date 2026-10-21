import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const config = defineCloudflareConfig();
// Keep the existing Node build and local SQLite development workflow intact.
config.buildCommand = "npm run db:generate && next build --webpack";
export default config;
