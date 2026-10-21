# 阶段2 Review：公开页面与数据读取

## 范围与独立性

工程仍为`D:\排协网站\volley-4v4`，部署入口为`/`，与同级VolleyBoard业务、依赖、数据和部署相互独立。本阶段未修改schema、迁移SQL或迁移器，未新增基础设施模块。默认赛事库仍是未发布的8队赛事，没有替换成演示数据。

使用提供的V1.0 HTML原型作为页面基线，保留浅色背景、深蓝渐变头部、比分卡片、绿色进行中标签、三项底部导航、阶段与A/B切换、左右淘汰树。没有新增注册、个人中心、球员信息、开赛时刻、倒计时或额外导航。

## 已实现页面与交互

| 页面/入口 | 实际行为 |
| --- | --- |
| `/` | 赛事名称、当前阶段、有内容才显示的公告、双场地看板与我的队伍。尚未开打显示下一场；直播突出比分；空档保留最近实际提交结果和下一场；全部打完保留最后结果及完成提示。两片场地独立计算。 |
| `/schedule` | 小组赛/交叉赛切换，小组赛再切A/B；每组6或10场、真实队伍标签。四强树左侧半决赛、右侧冠亚军和季军两个分支，胜/负者分别连接。树可横向滑动，有明确提示；5/6、7/8、9/10排位赛单列。 |
| `/matches/[code]` | 只读显示双方、比赛阶段、场地网高、三种状态、BO1局内比分、BO3总局分/当前局/历史局分。排除局保留原分数并注明不计成绩。无公开记分或提交按钮。未知编号显示未找到。 |
| `/rankings` | 仅依据已提交小组成绩计算胜负、净胜分、排序。保留真正并列，不随机决定名次。不把即时排序当成已晋级。全部结束但未确认时提示最终名次待公布；有效最终确认后才展示完整名次。 |
| `/rules` | 从菜单进入，显示数据库中可更新的赛事规则文字及有效公告，未配置时显示待发布。 |
| 首页内“我的队伍” | 原生对话框选队，本地保存编号，可切换、取消；跨标签页同步选择变更。只列本队实际已确定的参赛记录，未确认交叉赛不预测对手。没有另建页面或底部入口。 |

菜单管理入口明确标为暂未开放。本阶段没有实现访问码登录、记分台、管理员审批页面或公开写接口。

## 公开数据与接口

所有上述页面共用`GET /api/schedule`，一次读取完整小型单赛事公开快照。8/10队最多27场，无需另建各页面的数据副本。

| 项目 | 约定 |
| --- | --- |
| 方法 | GET；匿名可读；POST等写方法返回405。 |
| 缓存 | 成功和失败均`Cache-Control: no-store`。 |
| 正常响应 | HTTP 200，`publication`为`unconfigured`、`draft`或`published`。 |
| 数据库不可用 | HTTP 503，通用错误；页面显示重试，不伪造空赛程或示例成绩。 |
| 未配置 | `publication: unconfigured`，队伍/比赛数组为空。 |
| 未发布 | `publication: draft`，仅赛事名称、模式、地点、规则及公告；队伍/比赛数组为空。 |
| 已发布 | 赛事信息、队伍、场地、比赛、各组即时排名、交叉/最终发布状态。 |

已发布响应的主要字段：

```text
publication, name, mode, location, rulesText, noticeText
teams[]: drawCode, name, group
courts[]: id, name, netHeightCm
matches[]:
  code, stage, group, placement, courtId, sequence, format, targetPoints, capPoints
  status: NOT_STARTED | LIVE | FINISHED
  home/away: { ref, team: { drawCode, name } | null }
  sets[]: setIndex, homePoints, awayPoints, confirmed, excluded
  winner: drawCode | null
  submittedAt: ISO字符串 | null
groups[]:
  group, complete, unresolved
  rows[]: drawCode, name, group, played, wins, losses,
          pointsFor, pointsAgainst, difference, rank, tied
crossPublished, crossNeedsReview, finalPublished, allFinished
finalStandings[]: rank, drawCode, name
```

`submittedAt`用于按实际提交先后选“上一场”，不作为预定开赛时刻在界面展示。比赛队列依场地独立排序；下一场为本场地最前面的未开始记录，不检测跨场地队伍冲突。

公开接口只序列化白名单，不含凭据散列、访问码、操作者、操作记录、内部审计或原始审批快照。未确认交叉赛即使数据库已填写队伍ID，也不返回具体参赛队伍或其局分。

## 排名与发布边界

只读算法放在`src/lib/four-v-four/public-logic.ts`，不依赖React或数据库。为了让本阶段排名页使用真实成绩，提前实现了只读排名计算，管理端确认及修改流程仍留在后续阶段。

- 胜场优先；恰好两队同胜场看直接交手，再看全组净胜分及总得分。
- 三队及以上按并列队伍之间胜场、净胜分，再按全组净胜分、总得分；中途只剩两队同指标也不重新启动直接交手比较。
- 全指标相同给相同名次，编号只固定显示先后，不冒充排名依据。小组已结束仍并列时提示依赛前补充规则裁定。
- 直播中的分数不计入正式胜负及排名；提交单场后立即计入，不引入逐场审批。
- 交叉确认按有效记录及`groupResultsRevision`读取。历史成绩变化后，未开始的交叉赛重新隐藏实际对阵；已经开打或完成的保留原对阵并提示待重新确认。
- 正式半决赛提交结果后，未开始冠亚/季军赛可只读解析已知胜/负者。不猜测另一场未提交半决赛的结果，不覆盖已开始比赛双方。
- 最终名次从已提交比赛胜负派生；必须全部比赛完成、交叉确认有效、最终确认版本与`resultsRevision`相同，且确认快照与派生名次一致，才公开完整表。错误/过期/无确认时`finalStandings`为空。

供后续管理端使用的最终快照格式为`{"rankings":[{"rank":1,"drawCode":"实际编号"},...]}`。公开端不读取手工维护的另一套积分榜，也不把原始快照透传给浏览器。本阶段没有用于创建确认的HTTP写接口。

## 更新与断网

顶层SWR统一请求，默认每2秒读取一次；页面重新聚焦或网络恢复时重读，后台隐藏页面不持续轮询。所有页面/卡片共用一份快照，避免每个组件单独轮询。

断网或读取失败时保留已有数据并明确显示“连接中断，当前显示上次读取的数据”，可以重试；首次读取失败则显示错误页内状态。恢复连接后读取服务器当前成绩。这个阶段验证的是公开端跨设备读取，不代表记分写操作、弱网重放或幂等加分已经完成。

## 独立测试数据及运行

数据构造器只在`tests/fixtures/review.ts`，入口为`scripts/prepare-review.ts`，不会被生产UI导入。每次在`data/review/`创建新文件，拒绝覆盖。场景包括`upcoming`、`live`、`interval`、`cross`、`final-pending`、`final-published`，支持8/10队。

```powershell
cd D:\排协网站\volley-4v4
# 首次安装/重装前，先Ctrl+C停止本网站运行进程
npm ci
npm run db:generate
$reviewSetup = node --experimental-strip-types scripts/prepare-review.ts 8 live | ConvertFrom-Json
$env:FOUR_V_FOUR_DATABASE_URL = $reviewSetup.databaseUrl
npm run dev
```

访问`http://localhost:4315/`。查看其他场景先停止服务，把`8 live`替换为目标模式/场景后重新执行生成及启动命令。生产环境不自动生成测试数据。

退出测试后按`Ctrl+C`并执行`Remove-Item Env:FOUR_V_FOUR_DATABASE_URL -ErrorAction SilentlyContinue`，恢复`.env`中的默认数据库配置。不要在网站仍运行时重新安装依赖，Windows会锁定libSQL原生文件。

## 验证结果

2026-10-15，Node 25.9.0，Next.js 16.4.1，Chrome，真实SQLite/libSQL本地文件适配器。

- `npm test`：54/54通过。阶段1的38项全部保留，本阶段增加16项公开数据、看板、排名与发布边界测试。
- `npm run typecheck`、`npm run lint`、`npm run build`通过；公开路由仅为本阶段定义的5类页面、只读接口、站点图标和框架404。
- 浏览器检查使用已有Playwright；Browser插件未提供，尝试IAB时因`failed to write kernel assets (os error 3)`不可用，没有额外安装浏览器依赖。
- 主要页面以375×812检查，首页额外检查320、334（原型屏幕宽度）、390和1280宽度。页面身份、有效内容、无框架错误覆盖层、正常联网时控制台无错误、无全页横向溢出均通过。
- 点击底部导航、A/B与阶段切换、原生队伍对话框/ESC、选队/切队/取消、刷新保存、跨标签取消同步、菜单规则、详情只读均已实际检查。
- 两个独立浏览器上下文读取同一真实测试库，外部修改数据库比分后两边均更新。一个上下文断网时保留旧分并提示，另一个继续更新；恢复网络后读取最新分数。
- 8/10队分别检查小组场数、交叉树、BO3总局分和当前局、最终名次待公布/正式公布；接口匿名写入405、旧站路径404。默认赛事数据库在测试前后SHA-256相同，旧工程`git diff --quiet`通过。

浏览器共25组检查通过：`qa-results.json`记录21组主要流程，`extra-qa-results.json`记录4组补充场景（默认未发布、未初始化、数据库不可用及禁用本地存储）。点击及实际状态变化均有断言，截图为375×812真实浏览器视口。原始检查结果、测试库清单及截图在`D:\排协网站\volley-4v4\artifacts\reviews\phase-2`，测试脚本也在该目录，不作为产品功能或公开路由部署。

## 手机端截图

以下为独立测试库中的模拟赛事，经真实接口渲染，并非正式比赛成绩。

[下载21张主要页面手机端截图](../artifacts/reviews/phase-2/阶段2_手机端截图.zip)。

| 主要页面/状态 | 文件 |
| --- | --- |
| 首页两片场地直播 | [home-live.png](../artifacts/reviews/phase-2/home-live.png) |
| 首页方案A空档 | [home-interval.png](../artifacts/reviews/phase-2/home-interval.png) |
| A/B小组赛 | [schedule-a.png](../artifacts/reviews/phase-2/schedule-a.png)、[schedule-b.png](../artifacts/reviews/phase-2/schedule-b.png) |
| 交叉树待公布及右侧分支 | [bracket-pending.png](../artifacts/reviews/phase-2/bracket-pending.png)、[bracket-pending-right.png](../artifacts/reviews/phase-2/bracket-pending-right.png) |
| 交叉赛已确认 | [bracket-published.png](../artifacts/reviews/phase-2/bracket-published.png) |
| BO1/BO3详情 | [detail-bo1.png](../artifacts/reviews/phase-2/detail-bo1.png)、[detail-bo3.png](../artifacts/reviews/phase-2/detail-bo3.png) |
| 历史局已排除 | [detail-excluded-set.png](../artifacts/reviews/phase-2/detail-excluded-set.png) |
| 即时排名、最终待公布、已公布 | [rankings-live.png](../artifacts/reviews/phase-2/rankings-live.png)、[rankings-final-pending.png](../artifacts/reviews/phase-2/rankings-final-pending.png)、[rankings-final.png](../artifacts/reviews/phase-2/rankings-final.png) |
| 我的队伍选择及本队赛程 | [my-team-select.png](../artifacts/reviews/phase-2/my-team-select.png)、[my-team.png](../artifacts/reviews/phase-2/my-team.png) |
| 规则 | [rules.png](../artifacts/reviews/phase-2/rules.png) |
| 10队小组/交叉/最终 | [schedule-ten.png](../artifacts/reviews/phase-2/schedule-ten.png)、[bracket-ten.png](../artifacts/reviews/phase-2/bracket-ten.png)、[rankings-ten-final.png](../artifacts/reviews/phase-2/rankings-ten-final.png) |

## 原型核对及有意差异

参考：用户提供的移动端HTML，浏览器原始尺寸截图为同一输出目录`reference-1.png`至`reference-4.png`。已逐项核对头部与深蓝渐变、白底蓝边卡片与圆角、醒目红色直播比分、绿色文字状态、三项底部导航、阶段/A-B切换、左右连接与滑动提示。以原型宽度334及常用375宽度实际截图检查，未加入原型外业务栏目。

有意差异：不复制手机外壳、假系统时间或信号图标；实际内容可纵向滚动；小字号按手机阅读适当放大；赛事全称取数据库真实值；队伍标签依据设计文档补齐；树节点使用上下两行队伍避免胜/负者占位被窄列切碎。树中超长队名省略显示，完整文字保留可访问名称并在详情完整显示。管理入口在本阶段明确禁用，等待阶段3。

首屏文案按功能核对，保留赛事/阶段、场地、当前/上一场、下一场、等待开始和我的队伍；没有添加营销文案、假比赛时刻或额外导航。测试示例与原型示例比分不要求相同，以数据库真实记录为准。

## 依赖与剩余边界

此前的Next.js严重项已通过升级到同一大版本的16.4.1处理，eslint-config-next同步升级并通过构建。官方Windows漏洞说明：[Vercel安全公告](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36)。本轮npm审计无严重项，仍有开发工具/依赖链告警，不宣称所有依赖问题均清零，也没有强制降级Prisma或盲目执行force修复。

用户确认暂无专用Turso测试库，先完成本地公开页面；本阶段未连接真实云端，不能把本地SQLite通过等同云端兼容性通过。真实记分联调前需在专用空云库验证：当前迁移及重复迁移、CHECK/索引/触发器、Prisma读写与事务回滚、重连读取、8/10队初始化和公开轮询。只使用新站独立库及令牌，不借用旧站配置。不为此扩展迁移器。

尚未实现：访问码鉴权、逐分加减及写入幂等、待同步操作重放、历史成绩编辑、管理员交叉/最终确认写操作。这些功能应在本阶段Review后继续。浏览器检查使用Chrome，真机Safari/安卓弱网及现场容量仍待后续联调。

## 实际文件改动

- `src/app/layout.tsx`、`globals.css`、`page.tsx`：公开外壳、导航、样式与首页；新增`schedule/page.tsx`、`rankings/page.tsx`、`matches/[code]/page.tsx`、`rules/page.tsx`。
- `src/components/public/`：共享数据上下文、外壳、比赛卡片、首页、我的队伍、赛程树、排名、比赛详情、规则组件。
- `src/lib/four-v-four/public-types.ts`、`public-logic.ts`：公开数据契约、比分展示、看板与只读排名算法。
- `src/lib/four-v-four/repository.ts`：扩展公开白名单、逐局成绩、发布边界及派生名次；现有只读接口继续调用该函数。
- `tests/four-v-four/public.test.ts`、`tests/fixtures/review.ts`：新增自动化检查及隔离测试数据。
- `scripts/prepare-review.ts`、`package.json`：测试库入口及脚本；`package-lock.json`：独立依赖锁与Next升级。
- `AGENTS.md`、`README.md`、`docs/phase-2.md`：授权阶段、运行/隔离测试与本Review说明。

没有修改旧工程、正式默认赛事数据、迁移器、数据库结构及迁移SQL。阶段2结束后停下等待Review。
