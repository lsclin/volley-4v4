# Cloudflare Workers + Turso 部署准备

本工程保留现有 Next.js 与 Prisma/libSQL 业务实现，使用 OpenNext 适配 Workers，不迁往 D1、不改变计分与排名规则。当前仅获授权做部署准备；未创建云资源、上传代码、连接云库或正式部署。

## 已准备的入口

```powershell
npm ci
npm run cf:build
npm run cf:check
```

- `cf:build`：生成 Prisma 客户端、Next.js 生产构建及 `.open-next/`。只构建，不迁移数据库或部署。
- `cf:check`：使用 Wrangler 的 `deploy --dry-run` 在本地打包检查，不上传或发布。
- `cf:preview`：在 `http://localhost:8787` 启动本机 Workers 模拟运行环境，不是线上预发布。
- 原有 `npm run dev`、`npm run build`、`npm start` 继续用于本地开发及普通 Node 部署；切换构建目标时重新构建，不能用 Cloudflare 的 Next 中间产物运行本地 SQLite。

正式构建建议在干净的 Linux CI/WSL 环境执行。OpenNext 对 Windows 的兼容性有限；不能将本机原生 SQLite 依赖复制到 Worker。Workers 构建会将 Prisma 的 libSQL 适配器映射到 HTTP/Web 版本；本地 Node 仍保留原有驱动。

## 配置与数据库隔离

| 配置 | Worker 中的用途 |
| --- | --- |
| `FOUR_V_FOUR_DEPLOY_TARGET=cloudflare` | 在构建和运行中启用 Workers 适配，拒绝本地 SQLite 与默认数据库回退 |
| `FOUR_V_FOUR_DATABASE_URL` | 专用于4v4的 `libsql://` 数据库地址 |
| `FOUR_V_FOUR_AUTH_TOKEN` | 该数据库的独立令牌，仅服务端密钥 |
| `FOUR_V_FOUR_SESSION_SECRET` | 至少32字符的独立随机会话密钥 |
| `FOUR_V_FOUR_SITE_ORIGIN` | 实际访问的精确 HTTPS 源；更换域名后同步修改 |

本地 Workers 预览可复制 `.dev.vars.example` 为 `.dev.vars`，填入**独立测试库**的配置，再运行 `npm run cf:preview`。预览脚本禁用Wrangler从普通`.env*`读取配置，避免串用日常赛事数据库；不自动复制或创建密钥文件。其中 `FOUR_V_FOUR_ALLOW_LOCAL_HTTP=1` 和本机 HTTP 源只用于 localhost 预览，不能复制到正式 Worker。没有云库时只能检查启动与配置失败边界，无法验证实际记分。

`.dev.vars*`、`.env*`、`.wrangler/`、`.open-next/`、数据库及测试产物均已排除提交，示例文件除外。真实令牌和会话密钥在获批后通过 Worker Secrets 设置，不写入 `wrangler.jsonc`。构建脚本会清空 OpenNext 从本机 `.env` 汇总的服务端默认值，防止上传本机配置；Worker 必须在运行时取得自己的配置。

云库不会在应用启动、构建或发布时自动初始化/迁移。复用现有命令，在安全维护终端选择准确的独立目标后运行迁移；已有库先备份、暂停记分，不重复初始化。专用空测试库验证仍使用：

```powershell
npm run test:cloud -- --empty-dedicated-test-database
```

该命令读取 `.env.cloud-test.local` 并拒绝非空目标，不能对正式赛事数据库运行。云端备份恢复沿用 Turso 的导出/快照及新库恢复流程，不能使用本地 SQLite 文件备份命令代替。

## 工作人员密码

登录、设置密码与本地维护统一支持3至64字符，开发和生产不再采用不同长度限制。密码依然使用随机盐 scrypt 散列；没有硬编码管理员密码或自动注入测试码。现有赛事的管理员密码继续保留，管理员网页只修改两名记分员密码。

若新空库需要指定管理员密码，维护命令支持标准输入，避免把密码放入命令行参数或脚本。例如 PowerShell 7：

```powershell
# 先在当前终端明确配置目标云库、令牌、会话密钥，并设 NODE_ENV=production
Read-Host '输入管理员密码' -MaskInput | npm run staff:access -- admin --stdin
```

指定模式不回显密码。它只更新选定身份的散列与版本，不更改赛程或比分；旧会话失效。不要在日常启动时运行此命令。随后登录 `/manage` 完成新赛事初始化，并由管理员设置记分员密码。

## 正式发布前仍需完成

1. 提供独立空 Turso 测试库，完成迁移、事务回滚、幂等、并发和重连验证；再用 Workers 环境完成8/10队联调。
2. 在实际校园网、手机网络验证 HTTPS 登录、记分同步、断网恢复和页面操作。
3. 核对轮询请求量与 scrypt 的 CPU 消耗；正式比赛不能只凭队伍少就假定免费档足够。
4. 在 Cloudflare 配置登录入口 `/api/manage/login` 的限流，再检查 Cookie、同源校验、密钥与不缓存边界。现有进程内登录计数不代表跨 Worker 实例的统一限流。
5. 处理 `docs/deployment.md` 中既有依赖审计等待项，并核对最终发布产物。不要执行强制降级或未经验证的 `audit fix --force`。
6. 获得正式部署授权后再设置账号、Worker Secrets、测试访问地址或自定义域名并发布。当前 `workers_dev`、预览链接默认关闭，没有添加自动部署脚本或 CI 发布任务。

本文件是部署步骤，不是云端验收通过声明。旧 VolleyBoard 的域名、账号配置和数据库均不参与本流程。

2026-10-19本地验证：60项相关业务/部署测试通过（数据库测试进程首次异常退出，单独复跑17项全部通过）；普通Node和Workers构建、Wrangler本地打包检查通过。Workers本机预览验证了页面加载、缺库拒绝、同源拒绝及私有文件404；独立SQLite测试赛事的Node生产浏览器验证了三类指定短码登录与权限。未使用真实手机或专用云库，既有依赖审计仍为7个包项（4高、3中），不构成正式上线验收。

官方参考：[OpenNext 配置](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/)、[Turso 接入](https://developers.cloudflare.com/workers/databases/third-party-integrations/turso/)、[Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[自定义域名](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。Cloudflare 当前也推荐 vinext；本工程先保留现有 Next 构建，避免此次部署准备顺带迁换框架。
