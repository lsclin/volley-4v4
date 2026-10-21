# 高新区继往开来排球赛 · 部署交接说明

服务器、域名、HTTPS和正式部署由协助部署的学长负责。本文保留项目运行所需的信息，具体部署方式由部署人员根据服务器环境安排，不再单独开展部署准备阶段。

## 项目运行方式

- Next.js + TypeScript，建议Node.js 24 LTS，最低22.18。
- 默认使用独立SQLite数据库；使用SQLite时，运行单个应用实例，并将数据库保存在持久磁盘上。
- 网站端口为4315；公开入口为`/`，管理员和两片场地记分员统一从`/manage`登录。
- 在目标系统安装依赖并构建，不直接复制Windows的`node_modules/`或`.next/`到Linux。

```sh
npm ci
npm run build
npm start -- --hostname 127.0.0.1
```

上述启动方式由服务器上的HTTPS反向代理对外提供访问；进程守护、证书和域名解析由部署人员配置。反向代理不要缓存`/api/`及工作人员页面，并正确转发Host和协议。

## 服务器环境配置

配置可使用服务器环境变量或根目录`.env.production.local`，参考`.env.example`；实际密钥不提交Git。

| 配置项 | 说明 |
| --- | --- |
| `FOUR_V_FOUR_DATABASE_URL` | 独立数据库地址，SQLite使用持久磁盘绝对路径，例如`file:/srv/volley-4v4-data/event.db` |
| `FOUR_V_FOUR_SESSION_SECRET` | 至少32字符的独立随机密钥，重启时保持一致 |
| `FOUR_V_FOUR_SITE_ORIGIN` | 实际HTTPS站点地址，例如`https://volleyball.example.com`，不带路径 |
| `FOUR_V_FOUR_AUTH_TOKEN` | 仅使用远程libSQL数据库时需要，本地SQLite不需要 |
| `NODE_ENV` | 执行生产维护命令时设置为`production`；`npm start`自动使用生产模式 |

生产环境不设置`FOUR_V_FOUR_ALLOW_LOCAL_HTTP=1`。数据库、备份和环境配置放在非公开目录，不使用`NEXT_PUBLIC_`变量存储密钥。生产维护命令读取顺序为进程变量、`.env.production.local`、`.env.local`、`.env.production`、`.env`。

## 数据库与访问码

GitHub中包含数据库模型和迁移文件，**不包含本地赛事数据库、当前访问码、环境密钥或测试数据库文件**。

- **使用新空库**：配置好生产环境后运行`npm run db:migrate`，再运行`npm run staff:access -- admin`创建管理员访问码。登录`/manage`选择8队或10队、录入队名、设置两片场地记分员密码并发布赛程。
- **保留现有赛事**：通过私下渠道交接数据库备份；已有库先备份，版本更新需要时运行迁移，不能重复初始化。队伍、比分及访问码随数据库保留，访问码本身以盐化散列保存。
- 不接入或修改旧VolleyBoard的数据库、环境配置或部署。

## 已有维护工具

以下命令使用与网站一致的生产环境配置；维护数据库前暂停记分和服务，备份文件名必须为新文件。

```sh
npm run check:production
npm run db:backup -- data/backups/before-update.db
```

`check:production`只检查配置，不会修改数据库。恢复时先将`FOUR_V_FOUR_DATABASE_URL`指向一个全新文件，再运行`npm run db:restore -- 备份文件.db`；工具拒绝覆盖，不自动切换网站连接。恢复后核对成绩，使用`npm run staff:access -- all`更换访问码以撤销旧会话，并核对设备待同步记录，再由部署人员切换服务。

## 交接状态

现有业务已完成本地联调；目标服务器、真实HTTPS和手机现场网络尚未验收，不能将本地测试等同于线上验收。历史依赖审计待处理项保留在[阶段5记录](phase-5.md)，由部署人员结合实际环境处理。

如果部署人员选择Cloudflare Workers，可参考仓库已有的[Cloudflare说明](cloudflare.md)；该方式需要独立远程数据库，不能直接使用服务器SQLite文件。现有远程Turso/libSQL兼容性尚未实测。
