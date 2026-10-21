# 排协4v4独立网站 阶段1 Review

## 项目范围

独立工程：`D:\排协网站\volley-4v4`。与同级`volley-board`没有代码导入、共享数据库、共同路由或部署依赖。

网站入口为`/`，不是旧站下的`/4v4`；本地使用4315端口。阶段1只有筹备说明和只读赛程接口`GET /api/schedule`。完整公众页面、访问码登录、实时记分、排名及管理页面等待本次Review后继续。

本轮早先对旧站的7个已跟踪文件的改动已撤回，新增阶段1文件已迁至本目录，旧站原有概念图、数据和功能保留。新工程自己的依赖、锁文件、数据库、环境变量、客户端与构建产物均独立，运行不需要启动旧站。

## 数据模型

| 实体 | 主要内容与约束 |
| --- | --- |
| Tournament | 单赛事，8/10队，固定计分参数、赛程发布、开始标记、规则及短公告。配置版本、小组成绩版本、全赛事成绩版本分开。 |
| Team | 抽签编号、分组、组内序号、队名。编号不是小组排名；比赛开始后抽签关系锁定，队名允许纠正；没有个人信息。 |
| Court | 主场地243cm、副场地224cm，以整数厘米保存。 |
| Match | 编号、阶段、BO1/BO3、场地与独立队列、参赛来源、已解析队伍、比分版本及提交时间。状态仅未开始/进行中/已结束。 |
| SetScore | 原始逐局比分、人工确认、排除标志及原因。第三局因前两局修正成2:0而失效时可保留记录，阶段3实现自动重算及编辑交互。 |
| ScoreAction | 唯一请求ID、操作者、动作、请求内容、前后值及版本，为阶段3幂等与乐观锁预留基础。当前没有记分写接口。 |
| Approval | 交叉/最终确认快照、依据成绩版本、确认人和时间、失效时间；同类仅一个有效快照，保留历史。阶段4实现完整发布业务。 |
| Credential | 管理员或场地记分员、访问码散列、授权场地、凭据版本；阶段3实现登录、重置及服务端鉴权。 |
| AuditLog | 配置、队名及赛程发布的操作者、对象、时间和前后值；后续记录成绩修正。 |

比分只做非负整数完整性约束，不按25/15分阈值自动结束或警告。外键、编号、队列、局号、请求ID等有数据库约束。迁移中的CHECK、部分唯一索引和结构锁触发器属于模型规范，后续迁移应保留。预留字段不代表记分同步和审批功能已经完成。

## 固定赛程生成

`src/lib/four-v-four/schedule.ts`为独立纯函数，严格采用V1.0设计文档第7节模板，不依赖页面、数据库或时钟。

| 模式 | 小组赛 | 交叉赛 | 总场次 | 每队小组赛网高分配 |
| --- | --- | --- | --- | --- |
| 8队 | 两组各4队，共12场 | 6场 | 18场 | 主副场地分别1场与2场，不限哪片为2场 |
| 10队 | 两组各5队，共20场 | 7场 | 27场 | 主副场地各2场 |

- 各组任意两队恰好交手一次。生成后验证场数、编号、漏赛、重复、合法队伍、规则及场地队列。
- 模板两列是独立场地顺序，不是同步开赛轮次；不生成开赛时刻、预计时间或倒计时。比赛编号是稳定引用，按`courtId + sequence`决定本场地顺序。
- 半决赛1：A组第1对B组第2；半决赛2：B组第1对A组第2。胜者进入冠亚军赛，负者进入季军赛。其他排位赛为各组同名次对阵。
- 初始分配：5/6名赛主场地，7/8名赛副场地；10队增加的9/10名赛在主场地接续。主场地随后依次半决赛1、半决赛2、季军赛、冠亚军赛。
- 先完成其他排位赛是现场执行要求，不做跨场地同步锁或同队冲突检测。
- 小组赛保存`team:A1`等来源，交叉赛为`rank:A:1`等占位；冠亚/季军分别引用半决赛胜/负者，初始化不猜测实际对手。
- 生成验证器仅约束赛前模板。后续管理员调整场地与队列时不重新要求网高均衡，也不增加均衡提示。

## 持久化与公开边界

- 独立schema：`prisma/four-v-four/schema.prisma`；独立客户端：`src/generated/four-v-four`；迁移：`prisma/four-v-four/migrations`。
- 本地默认`file:./data/four-v-four.db`；生产必须显式配置`FOUR_V_FOUR_DATABASE_URL`，libSQL另用`FOUR_V_FOUR_AUTH_TOKEN`。
- 迁移器支持SQLite与libSQL，事务执行SQL，记录版本及SHA-256，重复执行跳过。拒绝旧库同址、已知旧库路径、非本网站数据表和未经登记的已有结构。
- 初始化、队名修改、配置修改、发布使用事务并写审计。过期配置版本整体回滚。
- 所有队名登记完成后才能发布小组赛程。当前仅通过服务器本地命令管理，没有公开写接口。
- 未发布时公开接口不返回队伍、比赛；未确认交叉赛只返回来源占位。小组成绩变化使原确认失效时，未开始的交叉赛暂不公开原实际队名，已经按原确认开打或结束的比赛保留原对阵并标记待复核，不改写比赛实体。
- 阶段1不输出最终名次，也不返回凭据、审计或批准快照。

## 运行与部署

建议Node.js 24 LTS，最低22.18；本次验证环境为现有Node.js 25.9.0。命令优先使用进程环境变量，然后读取本工程`.env.local`及`.env`。

```powershell
cd D:\排协网站\volley-4v4
npm ci
$env:FOUR_V_FOUR_DATABASE_URL = 'file:./data/four-v-four.db'
npm run db:generate
npm run db:migrate
npm run tournament -- init 8
npm run tournament -- inspect
npm run dev
```

访问`http://localhost:4315/`。10队在空的独立数据库执行`init 10`；已初始化数据库拒绝覆盖，阶段1不提供清空或模式转换命令。2026-10-15恢复本地安装后，按用户已尝试的命令将本地开发库初始化为8队、18场的未发布赛事，没有写入正式队名或比分；两种模式均在测试沙箱真实初始化验证。已有赛事无需再次执行`init 8`。

队名文件是JSON对象，例如`{"A1":"实际队名"}`，可分批登记。下面的版本号必须取自`inspect`的当前`revision`，每次修改加1，过期请求拒绝：

```powershell
npm run tournament -- teams 队名.json 0
npm run tournament -- config 设置.json 1
npm run tournament -- publish 2
```

设置文件仅支持`name`和`rulesText`。`publish`只发布小组赛程，不替代交叉对阵或最终名次确认。

部署是独立Node服务：安装依赖、生成客户端、对本工程独立数据库迁移、`npm run build`、`npm start`。采用标准Next.js Node服务构建，`build`不会自动迁移或初始化。生产使用独立Turso/libSQL数据库，或为SQLite挂载持久磁盘并备份，不能把正式数据放在临时磁盘。完整生产部署和现场联调在阶段5验收。

## 测试与Review边界

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

38项测试：21项纯赛程检查、17项真实数据库集成检查。覆盖8/10队数量、完整性与均衡；场地队列及晋级来源；错误模式、重复和漏赛拒绝；真实迁移、持久化与重连；重复迁移及旧库哨兵内容保全；过期版本回滚；结构锁定、公开投影；非负比分、非标准阈值可保存、排除局保留；请求ID、版本、访问码场地及有效确认快照约束。

2026-10-15在本独立目录重新执行：`npm test`为38/38通过、0失败；`npm run typecheck`、`npm run lint`、`npm run build`均通过，代码检查无警告。生产路由仅有`/`、`/api/schedule`、图标及框架404页。迁移重复执行成功，首次验证时开发库`inspect`为`null`，恢复安装后已初始化8队。旧工程`git diff --quiet`通过，原有未跟踪概念图目录保留。

同日安装故障已恢复：遗留预览进程加载libSQL原生文件，导致Windows下`npm ci`清理依赖时出现`EPERM`，继而缺少Prisma命令与dotenv。仅停止核实属于本工程的预览进程后，`npm ci`成功安装469个包，重新生成客户端、迁移及38项测试均通过。补充独立`.env`，初始化8队成功；`npm run dev`启动正常，首页和只读接口均返回200，未发布数据保持隐藏。检查后关闭测试服务，释放4315端口及原生文件。README已补充Windows重装步骤及PowerShell变量语法。

本次恢复安装的`npm audit`另报告16条依赖告警（4中、11高、1严重，严重项位于Next.js依赖）；这是未处理的依赖安全事项，与安装文件占用原因不同。没有执行自动强制升级或降级，应在公开部署前完成依赖修复与回归验证。

浏览器检查使用本机Chrome及已有Playwright，原因记录为`Browser plugin not available`，未安装额外浏览器依赖。测试入口为`http://localhost:4315/`，分别检查375×812和1280×800。路径是打开首页→显示筹备说明→刷新→说明仍正常显示；阶段1没有需要点击的业务控件。页面标题、有效内容、无框架错误覆盖层、无横向溢出及无控制台错误均通过。图标404已修复，生产启动无standalone配置警告。原型中完整导航及卡片布局留待阶段2，本阶段仅保留独立筹备入口。

HTTP检查：只读接口返回200及`no-store`，未配置时不返回队名或比赛；匿名POST返回405；`/4v4`、`/api/home`、`/api/admin/login`、`/schedule`均返回404，未接入旧站路由。截图及浏览器检查记录在`D:\排协网站\volley-4v4\artifacts\reviews\phase-1\standalone-375.png`、`standalone-1280.png`、`standalone-checks.json`，测试脚本在同一目录，未加入产品源码。

测试父进程创建独立临时沙箱，子进程退出后清理，兼容Windows SQLite文件占用。不会使用真实赛事数据作为测试目标。

尚未实现或宣称验收：现场逐分同步、记分员服务端权限、弱网重放、多设备并发记分、排名计算、两次确认的管理交互。唯一索引和版本字段只是实现基础，不能单独证明完整记分业务已经幂等。本轮数据库集成测试使用本地SQLite，未连接真实云端libSQL服务；浏览器检查使用Chrome，其他浏览器及手机真机留待后续联调。

后续遵守确认的两处边界：第三局失效时保留但排除、整场提交前可回改且提交后仅管理员可改；多队并列不递归重启直接交手排序。

## 实际文件清单

- `package.json`、`package-lock.json`：独立依赖、脚本、版本锁。
- `next.config.ts`、`tsconfig.json`、`postcss.config.mjs`、`eslint.config.mjs`、`.gitignore`、`.env.example`：独立工程配置。
- `AGENTS.md`、`README.md`：边界与运行说明。
- `prisma.config.ts`、`prisma/four-v-four/schema.prisma`、初始迁移SQL：数据模型。
- `src/lib/four-v-four/{types,schedule,database-url,database,migrate,repository}.ts`：业务基础与数据服务。
- `scripts/four-v-four-admin.ts`、`scripts/four-v-four-migrate.ts`、`scripts/test-four-v-four.mjs`：本地管理、迁移、测试入口。
- `tests/four-v-four/{schedule,database}.test.ts`：自动化测试。
- `src/app/{layout.tsx,globals.css,page.tsx,icon.svg}`：独立外壳、筹备入口及站点图标。
- `src/app/api/schedule/route.ts`：公开只读接口。
- `docs/phase-1.md`：本Review说明。

`data/`、`node_modules/`、`src/generated/`、`.next/`仅为本网站本地产物，不纳入Git、不与旧站共享。阶段1 Review后再实施阶段2。
