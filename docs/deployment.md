# 独立4v4网站部署与恢复

本文件只用于部署准备。正式部署仍需用户另行确认；当前云库、Android/iOS真机及真实HTTPS代理尚未验收，依赖审计也仍有待处理项，不应据此直接上线。

用户现已授权 Cloudflare Workers + Turso 的代码和配置准备，专用操作入口见 [Cloudflare部署准备](cloudflare.md)。以下服务器/持久磁盘步骤用于普通Node部署，不能直接套用于Workers；正式部署授权状态不变。

## 运行方式与配置

沿用现有Next.js Node服务、单个独立赛事库及轮询，不引入容器平台或多实例架构。本地SQLite需单实例和持久磁盘，数据库、备份、环境文件均不可位于`public/`或反向代理的静态目录。不要把旧站数据库、旧站环境变量或旧站域名路径复制过来。

建议Node 24 LTS（项目最低22.18）。先在目标操作系统构建，避免复制Windows原生libSQL依赖到Linux。

| 环境变量 | 生产要求 |
| --- | --- |
| `NODE_ENV` | 维护命令设置为`production`；`next start`本身为生产模式 |
| `FOUR_V_FOUR_DATABASE_URL` | 独立数据库。SQLite使用持久盘绝对路径，例如`file:/srv/volley-4v4-data/event.db`；云端仅使用独立`libsql://`库 |
| `FOUR_V_FOUR_AUTH_TOKEN` | 仅云库需要，使用该4v4库独立令牌，存服务端密钥配置 |
| `FOUR_V_FOUR_SESSION_SECRET` | 至少32字符、独立随机值；可在安全终端用`node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`生成，勿粘贴到聊天或报告 |
| `FOUR_V_FOUR_SITE_ORIGIN` | 精确的独立HTTPS源，如`https://4v4.example.edu.cn`，不带路径、参数或账号 |
| `FOUR_V_FOUR_ALLOW_LOCAL_HTTP` | 正式环境不设置，禁止为`1`；仅限本机生产构建预览，不用于局域网现场部署 |

可由托管服务注入环境变量，或使用仅服务账户可读的`.env.production.local`。生产维护命令与Next采用相同优先级：进程变量优先，其后`.env.production.local`、`.env.local`、`.env.production`、`.env`。先检查并清除终端遗留的测试库变量，避免它们覆盖生产配置。任何密钥或数据库地址均不得使用`NEXT_PUBLIC_`前缀。

```powershell
# Windows生产维护终端；Linux对应 export NODE_ENV=production
$env:NODE_ENV = 'production'
npm run check:production
```

检查命令不连接或修改数据库，不输出密钥；它只能证明静态配置合格，不能证明域名、TLS、持久磁盘或云库可用。环境文件/目录使用系统权限保护，Linux示例为环境文件600、数据/备份目录700；Windows需为服务账户设置对应ACL。

## 首次部署与版本更新（获批后才执行）

1. 在隔离预发布环境完成本阶段检查，并处理下文依赖审计、真机和云库等待项。
2. 准备独立域名、HTTPS、持久磁盘及受限服务账户。反向代理只转发到本机Next进程，不把仓库目录配置为静态站点根目录；限制后台入口请求体与登录速率，转发正确Host/协议，不缓存`/api/`或工作人员响应。
3. 在干净发布目录安装和构建：`npm ci`，随后`npm run check:production`、`npm run build`。源码、Prisma模型及迁移、正式脚本、生成客户端和构建产物属于运行材料；不发布`artifacts/`、`tests/`、本机环境文件或本地测试数据库。原生依赖需与部署系统一致。
4. **已有赛事升级**：先通知记分员同步完毕并暂停操作、停止服务，执行备份，再`npm run db:migrate`。迁移会校验历史SQL，不重复清库；失败不启动新版本、不执行`init`。保存旧代码版本和迁移前备份。不要先替换正在使用的`node_modules/`。
5. **仅新空库**：`npm run db:migrate`后`npm run staff:access -- admin`，安全保存新码。生产缺失会话密钥会拒绝此命令，不自动写本机环境文件。已有赛事不重复生成初始码或初始化。
6. 使用`npm start -- --hostname 127.0.0.1`启动4315端口，由HTTPS反向代理提供外部访问。由宿主进程管理器负责重启；SQLite只运行一个实例。服务重启不得重新初始化赛事。
7. 新空库从`/manage`初始化8/10队、登记抽签结果、设置场地访问码并确认发布。核对公开首页和工作人员分权、实际HTTPS Cookie的`Secure/HttpOnly/SameSite=Strict`、跨源请求拒绝及接口不缓存后，才能交给现场人员。

HTTPS代理同时配置`X-Content-Type-Options: nosniff`、禁止嵌入的`X-Frame-Options: DENY`及适当Referrer策略；HSTS在实际证书与域名验证后启用。不在代理访问日志中记录POST正文、访问码、Cookie或Authorization。

## 本地SQLite备份与恢复

备份使用SQLite `VACUUM INTO`生成一致快照，保留服务器已同步的比分、确认记录、凭据、幂等记录和审计；不包含浏览器中尚未同步的分数。正式升级前仍应暂停记分并停止服务，确保业务切换边界清晰。命令拒绝覆盖已有文件并校验数据库与外键完整性；失败的输出不可使用。[SQLite官方说明](https://www.sqlite.org/lang_vacuum.html)

```powershell
# 使用与服务完全相同的环境；目标目录必须非公开且受权限保护
$env:NODE_ENV = 'production'
npm run db:backup -- data/backups/before-release-20261015.db
```

安全保存备份及输出的SHA256，并将必要备份加密保存到另一块磁盘或受控存储；同磁盘副本不能应对磁盘丢失。备份包含凭据散列及赛事数据，不能放入普通Review包或公开下载。

恢复仅写入**全新文件名**，不会覆盖/切换当前服务：

```powershell
# 先停止服务。此变量是新恢复文件，绝不能填旧站路径或当前已有文件
$env:FOUR_V_FOUR_DATABASE_URL = 'file:D:/排协网站/volley-4v4/data/recovered-event.db'
npm run db:restore -- data/backups/before-release-20261015.db
npm run tournament -- inspect
```

核对恢复输出SHA、队伍/比赛数量、最近已提交比分和确认状态。使用与快照兼容的旧代码版本；如需升级，先在恢复副本上迁移并验证，不能简单用旧代码读取不兼容的新结构。**恢复确认后重置三类访问码**：`npm run staff:access -- all`，让旧会话及旧设备离线队列失效，记分员重新登录并人工核对服务器进度，不允许旧队列自动套用到回退后的成绩。

最后由操作人员更新持久环境配置到已核对的新文件，重启服务并检查公开与管理接口；当前终端变量不会自动写回环境文件。原库保留作取证/核对，不自动删除。存在未同步或快照后的比赛结果时，先依现场原始记录核对，不能假定恢复会找回它们。

## Turso/libSQL

当前没有专用云测试库，本地通过不代表远程事务、锁或迁移兼容。获得独立空测试库后，将地址和令牌仅写入`.env.cloud-test.local`，运行`npm run test:cloud -- --empty-dedicated-test-database`，再在该专用库完成多角色联调；该命令会拒绝非空库。不得对正式赛事库使用此测试命令。

正式云库备份优先采用供应商快照/恢复能力，并在另一个独立库演练恢复、迁移记录和会话撤销。Turso的导出/恢复命令及可用恢复窗口需按当前服务确认，不假设本地`VACUUM INTO`可备份远程文件。官方亦提供SQL dump及向新库加载的方式：[Turso db shell](https://docs.turso.tech/cli/db/shell)。不要在未验证的云库上直接升级生产。

## 当前安全等待项

本次`npm audit --omit=dev`报告7个包项（4高、3中），集中于Prisma CLI及其`@prisma/config/deepmerge-ts`、`@prisma/dev/@hono/node-server/valibot`、`mysql2`依赖链。由于CLI也作为`@prisma/client`可选peer存在，额外`--omit=peer`仍未排除这些告警。没有据此执行`audit fix --force`或把Prisma降级到6.x。

当前请求服务使用Next及libSQL，不启用Prisma dev、Hono静态服务或MySQL连接；检查的Next运行文件追踪中未发现Prisma CLI路径。但这不等于告警已消除，**在正式部署批准前仍须决定并验证修补版本或运行包隔离方案，并重新核对实际发布包的审计结果**。本阶段保留依赖和架构，不宣称安全审计全绿。

## 本地联调复现

`npm test`覆盖必要业务与备份/生产配置；`npm run build`后可运行可选`npm run test:field`，它只创建`data/field-tests/`下的新隔离库并启动独立本机端口，不读取生产环境文件，不部署。

该命令需要已有Playwright模块、Chrome及Edge；本机使用Codex提供的Playwright，可将其绝对模块路径设置在`FOUR_V_FOUR_PLAYWRIGHT_MODULE`。缺失时脚本退出，不自动安装依赖。结果在忽略提交的`artifacts/reviews/phase-5/`，不输出访问码或会话密钥。
