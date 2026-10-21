# 高新区继往开来排球赛

这是高新区继往开来排球赛使用的独立4v4赛事网站。与VolleyBoard是两个不同的项目，拥有自己的依赖、数据库、构建产物、环境变量和部署入口。

阶段1–4已通过Review。阶段5本地完整联调及部署准备已完成，等待Review；真机、云端及目标HTTPS环境仍未验收，依赖审计仍有待处理项。正式部署尚未授权，不应将本地通过视为可以直接上线。

## 项目目录

本项目的源码、参考资料、生成文件和验收材料统一放在`D:\排协网站\volley-4v4`，后续4v4文件也按下面的目录保存。

```text
volley-4v4/
├─ README.md                         项目说明、目录与运行方法
├─ AGENTS.md                         Agent授权范围、效率及安全规范
├─ package.json / package-lock.json   依赖与常用命令
├─ wrangler.jsonc / open-next.config.ts  Cloudflare Workers构建配置
├─ src/
│  ├─ app/                           页面、接口与全局样式
│  ├─ components/public/             公开赛事页面组件
│  ├─ components/staff/              工作人员入口与记分台组件
│  ├─ lib/four-v-four/               赛程、排名、计分、权限及数据库服务
│  └─ generated/                     自动生成的Prisma客户端
├─ prisma/four-v-four/               数据库模型与迁移SQL
├─ scripts/                          日常维护、迁移、测试赛事准备等命令
├─ tests/                            正式业务自动化测试与隔离测试夹具
├─ docs/
│  ├─ phase-1.md … phase-5.md         阶段说明与验收记录
│  ├─ deployment.md                 生产配置、迁移、备份恢复与部署等待项
│  ├─ cloudflare.md                 Workers + Turso准备及本地预览
│  └─ reference/
│     ├─ product-v1/                 V1.0产品设计、HTML原型、记分台参考图
│     └─ planning/                   原策划书参考文件及任务说明
├─ artifacts/                        本地生成物和历史检查归档
│  ├─ planning/                      4v4策划书DOCX/PDF、制作过程与旧脚本
│  ├─ schedule/                      8队对阵表XLSX、对阵图PNG/SVG及制作过程
│  ├─ design/                        网站概念图与需求阅读图片
│  ├─ reviews/
│  │  ├─ phase-1/                    阶段1检查
│  │  ├─ phase-2/                    阶段2公开页面截图及检查
│  │  ├─ phase-3/                    阶段3记分台截图及检查
│  │  ├─ phase-4/                    阶段4管理员手机截图及检查
│  │  ├─ phase-5/                    阶段5隔离联调结果（无新截图包）
│  │  ├─ phase-3-ui/                 UI精修、开发模式启动检查
│  │  └─ court-busy/                 同场地开赛限制截图及检查
│  └─ checks/                        其他临时定向检查脚本
├─ data/                             本地数据库、测试库、备份（不提交）
├─ .env.example                      环境配置示例
├─ .env / .env.local                 本机配置与密钥（不提交）
├─ node_modules/                     安装的依赖（自动生成）
└─ .next/                            开发和构建产物（自动生成）
```

日常开发主要查看`src/`、`prisma/`、`scripts/`和`tests/`；查规则与设计看`docs/`；找以前交付的策划书、对阵表、截图或压缩包看`artifacts/`。

### 常用资料入口

| 内容 | 位置 |
| --- | --- |
| V1.0产品与交互设计（主要需求参考） | [Markdown需求文档](docs/reference/product-v1/排协4v4赛事网站_V1.0_产品与交互设计.md)，保留[Word原件](docs/reference/product-v1/排协4v4赛事网站_V1.0_产品与交互设计.docx) |
| 移动端HTML原型 | [UI原型](docs/reference/product-v1/排协4v4_V1.0_移动端UI原型.html) |
| 记分台BO1/BO3参考 | [参考图](docs/reference/product-v1/排协4v4_记分台_BO1_BO3_精确UI草图.png) |
| 阶段5联调及环境限制 | [简洁验收说明](docs/phase-5.md) |
| 生产配置与备份恢复 | [部署说明](docs/deployment.md) |
| Cloudflare Workers + Turso | [部署准备、构建与本地预览](docs/cloudflare.md) |
| 修订版比赛策划书 | [Word](artifacts/planning/中国科学技术大学学生排球协会4v4排球比赛策划书_修订版.docx)、[PDF](artifacts/planning/中国科学技术大学学生排球协会4v4排球比赛策划书_修订版.pdf) |
| 8队完整对阵表和对阵图 | [Excel](artifacts/schedule/4v4排球比赛_8队完整对阵表.xlsx)、[PNG](artifacts/schedule/4v4排球比赛_8队完整对阵图.png)、[SVG](artifacts/schedule/4v4排球比赛_8队完整对阵图.svg) |
| 阶段2手机端截图 | [21张截图包](artifacts/reviews/phase-2/阶段2_手机端截图.zip) |
| 阶段3记分台截图 | [记分台截图包](artifacts/reviews/phase-3/阶段3_记分台截图.zip) |
| UI精修与阶段3综合材料 | [Review材料包](artifacts/reviews/phase-3-ui/阶段3_含UI精修_Review材料.zip) |
| 同场地开赛限制 | [截图与测试记录](artifacts/reviews/court-busy/开赛限制_截图与测试.zip) |

`artifacts/`保留各次制作/检查时的文件，包括当时的脚本、结果、截图与压缩包。它是本地归档，已从Git、TypeScript和ESLint中排除，不参与网站部署；项目交接如需历史材料，请另外带上该目录。历史脚本可能依赖当时的测试库或制作环境，当前维护及验证入口以`package.json`、`scripts/`和`tests/`为准。

移动前后的文件内容已核对，归档压缩包和原始日志保留原样，其内部路径可能仍为生成时的旧位置；当前目录和可用链接以本README为准。参考资料已从下载/附件目录复制存档，原始文件仍保留。`D:\排协比赛`中的其他赛事统计、名单和裁判文档不属于本项目，仍在原位置；不再向那里写入4v4项目文件。

数据库和环境配置仍在原有`data/`及根目录中，不随材料整理改动；不要将实际数据库、令牌或密钥打入验收材料包。

## 安装与运行

建议Node.js 24 LTS（最低22.18）。需求优先级为：用户最新明确指令 > 已确认产品需求及后续决策 > UI原型；历史Review记录不覆盖后续决定。

### 首次安装与初始化

以下完整流程仅用于新建的、尚无赛事的独立数据库。已有赛事不要重复执行`init`；迁移命令仅在首次建库或版本更新需要迁移时执行。

Windows重新安装依赖前，先在运行本网站的终端按`Ctrl+C`停止服务。运行中的服务会占用libSQL原生文件，使`npm ci`报`EPERM ... index.node`。依赖安装成功后再执行后续命令；如果安装失败，先处理首个错误，不要继续迁移或启动。

```powershell
cd D:\排协网站\volley-4v4
npm ci
if (-not (Test-Path .env) -and -not (Test-Path .env.local)) { Copy-Item .env.example .env }
npm run db:generate
npm run db:migrate
npm run staff:access -- admin
npm run dev
```

安全保存命令输出的初始管理员访问码，打开`http://localhost:4315/manage`登录，选择8队或10队生成固定赛程，登记抽签队名后确认发布。管理员凭据可在空库创建；初始化后再从“设置”创建两片场地的访问码。初始化不会生成演示队名或比分，也不提供清空、删除或重复初始化功能。

原本地维护命令`npm run tournament -- init 8`（或`init 10`）仍可用，但它是网页初始化的替代方式，**两种方式只能选择一种，已有赛事不要再次运行**。已有数据库可用`npm run tournament -- inspect`只读查看；新检出工程连接已有赛事库时，仅安装依赖、配置连接并按需迁移，跳过初始化。

已有阶段3工程升级时，先停止本网站并备份独立数据库，再执行一次`npm run db:migrate`；本次新迁移仅调整管理员凭据的赛前关联，保留已有访问码散列、会话版本、比赛及成绩。日常启动无需重复迁移。

### 日常启动（已有赛事）

在新的PowerShell窗口执行，使用根目录已有的环境配置：

```powershell
cd D:\排协网站\volley-4v4
npm run dev
```

独立网站入口：`http://localhost:4315/`；只读接口：`/api/schedule`。日常启动不运行`init`、不重新生成赛程，也不必重复安装依赖或执行迁移；`predev`会自动生成数据库客户端。若此前在同一终端预览测试库，先按后文说明清除临时环境变量，或另开终端。

### 验证与生产构建

按改动范围选择必要检查，无需在每次启动时执行全部命令：

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm start
```

`build`只生成客户端并构建，不自动迁移或初始化。生产使用独立的持久数据库，必须显式配置`FOUR_V_FOUR_DATABASE_URL`；使用libSQL时另配置`FOUR_V_FOUR_AUTH_TOKEN`。SQLite文件部署须挂载持久磁盘。迁移只作用于此网站数据库。

完整模型说明、赛程逻辑、测试范围及文件清单见 [阶段1 Review](docs/phase-1.md)。

公开页面、接口、截图及测试说明见 [阶段2 Review](docs/phase-2.md)。未发布的默认赛事只显示待发布提示，页面不会自动填入示例队名或比分。

需要查看有比赛数据的界面时，单独生成测试库，再在同一个PowerShell窗口启动（先停止已运行的本网站服务）：

```powershell
npm run db:generate
$reviewSetup = node --experimental-strip-types scripts/prepare-review.ts 8 live | ConvertFrom-Json
$env:FOUR_V_FOUR_DATABASE_URL = $reviewSetup.databaseUrl
npm run dev
```

将`8 live`替换为`8 interval`、`8 cross`、`8 final-pending`、`8 final-published`或`10 live`等，可查看空档、交叉赛或最终公布状态。每次创建新的`data/review/`测试文件，拒绝覆盖现有文件，不修改默认赛事库。测试时通过真实数据库及相同只读接口加载数据；测试数据不在UI组件中。

结束测试后按`Ctrl+C`，恢复默认本地配置可执行`Remove-Item Env:FOUR_V_FOUR_DATABASE_URL -ErrorAction SilentlyContinue`，再启动网站；`.env`仍保留原默认数据库配置。本地初始化过的赛事无需重复执行`init 8`。

若不使用`.env`文件，也可以在当前PowerShell窗口设置数据库位置（`$env:`开头的`$`不能省略）：

```powershell
$env:FOUR_V_FOUR_DATABASE_URL = 'file:./data/four-v-four.db'
```

出现`prisma`无法识别或缺少`dotenv`时，先检查`npm ci`是否成功结束。本项目使用本地依赖，无需全局安装Prisma，也无需为本次文件占用问题使用管理员终端。初始化只需执行一次，已有赛事时用`npm run tournament -- inspect`查看，不能重复初始化覆盖。

阶段3功能、写接口、并发与断网测试及实际文件清单见 [阶段3 Review](docs/phase-3.md)。需要查看记分台，可在新的终端生成隔离测试库（先停止此工程原有服务，或另选端口）：

```powershell
cd D:\排协网站\volley-4v4
npm run db:generate
$reviewSetup = node --experimental-strip-types scripts/prepare-review.ts 8 upcoming --scoring | ConvertFrom-Json
$env:FOUR_V_FOUR_DATABASE_URL = $reviewSetup.databaseUrl
$env:DOTENV_CONFIG_PATH = $reviewSetup.environmentFile
node --require dotenv/config node_modules/next/dist/bin/next dev -p 4315
```

打开`http://localhost:4315/manage`。测试访问码：主场地`ReviewMain2026`、副场地`ReviewSide2026`、管理员`ReviewAdmin2026`。这些固定码只写入新建测试库。将`8 upcoming`换为`8 cross-upcoming`或`10 cross-upcoming`可直接核对BO3；这些场景中的小组赛及交叉确认来自测试夹具。管理员现在可在同一入口管理赛事，点击“记分与成绩修正”进入原有记分界面。

每片场地同时只能有一场进行中比赛。开始其他场次时会提示正在进行的比赛编号；服务器也会在同一写事务中拒绝第二场开赛，包括管理员或两台设备同时操作。原场完成并提交整场后才释放场地；两片场地独立。以前已双开的测试记录不会自动撤销，可继续核对和提交已有比赛。

开发模式使用现有`dotenv/config`预加载测试配置。不要把`--env-file`传给`next dev`所在的Node进程：当前Next版本会将其转发进子进程的`NODE_OPTIONS`，造成`--env-file= is not allowed in NODE_OPTIONS`。结束测试后在当前窗口移除`FOUR_V_FOUR_DATABASE_URL`及`DOTENV_CONFIG_PATH`两个临时环境变量，或关闭测试终端；不要复制测试环境文件覆盖实际赛事配置。

手机局域网试用：手机与电脑连接同一可互访网络，开发服务使用`node --require dotenv/config node_modules/next/dist/bin/next dev -p 4315 --hostname 0.0.0.0`启动，手机打开`http://电脑的无线网卡IPv4地址:4315/`，管理入口为`/manage`。`next.config.ts`会在启动时将本机非回环IPv4地址加入开发资源白名单，避免IP访问一直停在“正在读取赛事”；切换Wi-Fi或热点后需重启开发服务并使用新IP。此配置只用于开发资源访问，不改变业务接口权限或生产HTTPS要求；若手机仍无法连接，检查Windows防火墙和无线网络的设备隔离。

管理员“设置”中的“记分员密码”允许管理员直接输入并保存两片场地的新密码，不再随机生成访问码，也不提供修改管理员密码的网页入口。管理员现有密码保持不变；记分员密码保存后，只有对应记分员的旧密码及旧会话失效，管理员继续保持登录。不同身份不能使用相同密码；密码仍加密存储，不进入操作日志或管理数据响应。初始化与应急恢复仍沿用本地`staff:access`命令，默认库不会自动注入测试数据。

阶段4功能、接口、迁移及测试说明见[阶段4 Review](docs/phase-4.md)；管理员手机截图见[截图包](artifacts/reviews/phase-4/阶段4_管理员手机截图.zip)。管理页采用手动刷新，避免后台刷新覆盖正在编辑的配置；正式发布时服务端仍检查最新配置与成绩版本。

生产环境需HTTPS、独立数据库、至少32字符的独立`FOUR_V_FOUR_SESSION_SECRET`，并设置`FOUR_V_FOUR_SITE_ORIGIN`为实际站点地址。单独运行本地生产预览时，测试环境文件的`FOUR_V_FOUR_ALLOW_LOCAL_HTTP=1`只对本机地址放宽Secure Cookie要求，不适用于局域网HTTP部署。

云端专用空库具备后，在`.env.cloud-test.local`配置独立连接与令牌，再运行`npm run test:cloud -- --empty-dedicated-test-database`。脚本拒绝任何非空目标，复用现有迁移器，验证迁移、读写、回滚、幂等及重连。此检查尚未执行，不能视为云端联调通过。

部署前只读检查：`npm run check:production`。已有库备份：`npm run db:backup -- data/backups/新的文件名.db`；恢复需先将`FOUR_V_FOUR_DATABASE_URL`指向一个全新文件，再运行`npm run db:restore -- 备份文件.db`。两者都拒绝覆盖，不会自动切换网站连接。生产维护终端先设`NODE_ENV=production`，与网站读取同一组生产环境配置；详细步骤和恢复后撤销旧会话要求见[部署说明](docs/deployment.md)。这些命令不应在本地联调时指向真实赛事库。
