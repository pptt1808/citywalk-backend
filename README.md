# citywalk-pulse-backend

CityWalk Pulse 的后端服务骨架，面向“动态约束 + 非确定性环境”的城市探索 Agent。

## 技术栈
- Node.js + TypeScript
- Express
- Zod（请求参数校验）

## 已实现骨架
- `GET /api/health`：健康检查
- `POST /api/plan`：城市漫步规划接口（真实地图、天气、LLM 与降级链路）
- `GET/POST/PATCH/DELETE /api/skills`：登录用户的 Agent Skill 配置与版本化同步
- `POST /api/evaluation/trace`：评测专用 Trace 接口，支持 `conversation_id` / `turn_index` 的多轮调用；生产环境用 `x-evaluation-key` 鉴权
- `GET /api/evaluation/capabilities`：评测协议能力发现
- `DELETE /api/evaluation/conversations/:conversationId`：清理隔离评测会话的记忆与历史
- Agent 分层：
  - `src/agents/urbanPulseAgent.ts`：核心规划与自我修正逻辑入口
  - `src/tools/mapTool.ts`：高德 POI 2.0、地理编码与路径规划适配层
  - `src/tools/weatherTool.ts`：和风天气适配层
  - `src/services/placeDiscoveryService.ts`：CityWalk 地点发现、公开证据融合与高德匹配

## LLM 工程约定
- **前缀缓存（KV cache）友好**：所有 LLM 调用为一次性 JSON 调用，静态 system prompt 在前；user payload 内易变字段（时间戳、请求 ID 等）必须放在 JSON 最后，避免打穿服务端前缀缓存（见 `src/llm/llmRouter.ts` 顶部约定注释）。
- **用量可观测**：每次 LLM 调用记录 `usage` 日志，含 `cache_hit` / `cache_miss` token 数，用于度量缓存命中率与成本。
- **可选提供方**：`LLM_PRIMARY_PROVIDER` 可切换主 LLM 提供方；`dot` 走小红书 dots3（点点）的 OpenAI 兼容端点（`DOT_BASE_URL`/`DOT_MODEL`，默认 `dots3-note-prev`）。只有显式以 `"dot"` 覆盖选择时才使用，不会影响默认 DeepSeek 路径。文案编写对照实验见 `npm run experiment:social-copy-dot`。
- **结果缓存**：`enrichPois` 按 POI（城市+类目+名称+地址）缓存富化结果 24h，多轮改路线只富化新增点；无 API Key 时缓存命中仍可返回。
- **进程内缓存有界**：`src/utils/cache.ts` 的 `MemoryCache` 上限 500 条，写满时先清过期条目再按 LRU 驱逐，避免长尾 key 驻留内存。

## 目录结构
```text
src/
  app.ts
  server.ts
  config/
    env.ts
  routes/
    index.ts
    health.ts
    plan.ts
    agent.ts                 # /api/agent/*（trace、SSE 流）
  controllers/
    planController.ts
  services/
    plannerService.ts
  agents/
    urbanPulseAgent.ts
  graph/
    citywalkGraph.ts         
  llm/
    llmRouter.ts
  tools/
    mapTool.ts
    weatherTool.ts
  types/
    plan.ts
  utils/
    stateEventWire.ts        # SSE 载荷截断
public/                      
scripts/
  run-agent-cases.ts
  agent-state-cli.ts         # F-04 终端可视化
frontend/
android/                    # Kotlin + Jetpack Compose 移动端
```

## 本地启动
1. 安装依赖
   ```bash
   npm install
   ```

[//]: # (2. 配置环境变量)

[//]: # (   ```bash)

[//]: # (   cp .env.example .env)
   ```
3. 启动开发服务
   ```bash
   npm run dev
   ```

默认端口：`3000`

## Android 移动端

原生 Android 客户端已经承担“正在漫步”场景：网页把规划路线发送到手机，手机持续定位、记录沿途图文、动态改路，并在结束后把原始漫步记录同步回网页。手账展示和编辑只保留在网页端，网页不再提供可编辑的实时随身记录入口。

构建、模拟器联调和职责边界见 [`android/README.md`](android/README.md)。Debug APK 输出在 `android/app/build/outputs/apk/debug/app-debug.apk`。

## API 示例
### 健康检查
```bash
curl http://localhost:3000/api/health
```

### 注册登录与用户隔离

规划、历史、收藏和记忆接口现在要求登录。服务端通过 HttpOnly 会话 Cookie 识别用户，不再信任客户端提交的
`userId`；客户端传入的同名字段只用于兼容旧版本，服务端会覆盖为当前登录用户。密码使用 Node 原生 `scrypt`
派生并加盐，生产环境应启用 HTTPS 并设置 `AUTH_COOKIE_SECURE=true`。

```bash
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"username":"citywalker","password":"至少8位密码"}' \
  http://localhost:3000/api/auth/register
curl -b cookies.txt http://localhost:3000/api/auth/me
curl -b cookies.txt -X POST http://localhost:3000/api/auth/logout
```

认证接口：`POST /api/auth/register`、`POST /api/auth/login`、`GET /api/auth/me`、`POST /api/auth/logout`。
登录后的历史接口仍可保留 `userId` 查询参数以兼容旧客户端，但服务端会忽略它：

```text
GET    /api/history?userId=...
GET    /api/history/:id?userId=...
DELETE /api/history/:id?userId=...
DELETE /api/history?userId=...
```

### 生成路线
```bash
curl -X POST http://localhost:3000/api/plan \
  -H "Content-Type: application/json" \
  -d '{
    "city": "南京",
    "startPoint": "新街口",
    "durationMinutes": 180,
    "budget": 100,
    "preferences": ["书店", "咖啡"],
    "styleDescription": "王家卫电影感的夜游，避开网红商业化",
    "discoveryMode": "hidden_gems",
    "temporal": {
      "visitDate": "2026-08-15",
      "startTime": "15:00",
      "timezone": "Asia/Shanghai"
    }
  }'
```

## 下一步开发建议
- 为高德、和风与 Tavily 增加生产告警和额度监控
- 在 `urbanPulseAgent` 中加入更细粒度重规划规则（闭店、排队、突发降雨）
- 增加评估指标输出（预算超支率、时间可行率、调用成功率）

## Agent 记忆系统（v0.5）

记忆实现参考 Mem0 的核心流水线：从用户消息抽取候选事实，再与同一用户的已有记忆协调为
`ADD / UPDATE / DELETE / NONE`，并为每次实际变化保存前后值和原因。记忆不会把 Agent 自动生成的路线
直接当成用户偏好。

记忆分为：

- `semantic`：长期用户画像、类别喜好/厌恶和稳定约束。
- `episodic`：用户明确反馈的真实地点体验。
- `procedural`：以后规划时长期遵循的方式，例如公共交通或室内优先。

规划请求可传入：

```json
{
  "task": "记住我以后优先坐地铁，也喜欢逛书店",
  "userId": "user-123",
  "threadId": "conversation-456"
}
```

### Agent Skill

Skill 不再拼接进 `task`。客户端只传当前启用的 `activeSkillIds`，服务端按登录用户读取启用版本；旧客户端也可以暂时传 `activeSkills` 快照作为迁移兼容。每次规划结果会在 `skillExecutions` 返回结构化执行状态：`applied`、`partially_applied` 或 `skipped`，并列出被当前用户要求覆盖或暂未识别的规则。

```text
GET    /api/skills
POST   /api/skills
PATCH  /api/skills/:id
DELETE /api/skills/:id
```

Skill 指令可以是开放式自然语言，后端会把可识别部分编译为亲子、节奏、休息、无障碍、天气、交通、地点发现和输出要求等结构化规则；无法安全结构化的内容仍会作为隔离的模型指令传入，不会改变本轮意图或伪造用户事实。

相同 `threadId` 保存最近 20 条用户/助手消息，用于理解“换一家”“预算不变”等后续表达；长期记忆按
`userId` 隔离。本轮明确要求始终高于历史记忆。旧客户端不传 `userId` 时保持无记忆模式。

### 开放式路线风格

风格不使用固定枚举。可以直接在 `task` 或 `styleDescription` 中描述任意审美、主题和叙事，例如“适合第一次约会但不要太正式”“大自然探索”“旧工业与霓虹的反差感”。后端会保留原话，并生成开放式 `tags`、`desiredScenes`、`avoidances`、`searchHints` 和 `narrativeArc`，随后贯穿 POI 检索、embedding 语义匹配、候选复核、路线选择和最终说明。也可以由高级客户端传入同结构的 `style` 对象；风格只是软约束，同行人、预算和时间等硬约束优先。

### 出行时间与天气锚点

路线会将“今天、明天下午、周六三点、今晚”等自然语言归一化为 `temporal` 约束，也接受客户端直接传入 `visitDate/startTime/departureAt`。时间采用 `Asia/Shanghai`，在多轮路线修改中继承；有明确出发时刻时，每个站点会返回预计到达和离开时间。

天气不再默认绑定请求发送时间：24 小时内按路线覆盖的逐小时窗口聚合，更远日期在七日范围内使用对应日预报；没有出行日期时标记为 `unknown` 并退出选点决策，超出预报范围时明确说明不可用。天气缓存键包含城市、日期、小时和行程时长。运行回归测试：`npm run test:temporal`。

### CityWalk 地点发现

地点发现与地图核验分层：高德 POI 2.0 提供名称、原始 `type/typecode`、地址、坐标和路线；当路线包含开放式风格或明确要求小众地点时，Tavily 公开网页搜索提供额外候选证据，LLM 只能抽取来源标题/摘要里明确出现的专名。外部候选必须再次匹配到附近高德 POI，才能进入路线，未核验名称不会生成地图图钉。

POI 关键词结果缓存 15 分钟，地理编码缓存 24 小时；相同区域和关键词的重复规划不会持续消耗高德检索额度。

地点选择的内部策略已拆成三个互不冲突的维度：`sourcePolicy` 控制仅地图或网页辅助，`noveltyPreference` 控制经典主流或长尾小众，`avoidOverexposed + exposureScopes` 控制是否避开网红、爆火和游客扎堆地点以及约束作用范围。比如“经典建筑，但餐饮别选网红店”会保留经典地标，只降低过度曝光餐饮的权重；“小众但只要地图有的”则同时保留长尾倾向和地图核验限制。自然语言先经过确定性归一化，再由 LLM 补充开放表达，路线修改也会优先采用本轮明确策略。

`discoveryMode` 继续兼容旧客户端：`reliable`、`balanced` 和 `hidden_gems` 作为策略摘要返回。系统保留稳定的功能类别用于时长、费用和无障碍约束，同时用开放 `subtype`、`tags`、`discoveryReasons` 表达真实业态，不再把所有未知地点归成景点。运行回归测试：`npm run test:places` 和 `npm run test:discovery-policy`。

记忆管理 API：

- `GET /api/memories?userId=...`：查看当前有效记忆。
- `POST /api/memories`：显式添加或更新一条结构化记忆。
- `DELETE /api/memories/:id?userId=...`：软删除一条记忆。
- `GET /api/memories/:id/events?userId=...`：查看记忆变更历史。
- `POST /api/memories/feedback/place`：记录真实地点喜欢/不喜欢反馈。
- `GET /api/memories/vector/status?userId=...`：查看该用户的向量配置、已索引和待回填数量。
- `POST /api/memories/vector/backfill`：按 `userId` 主动回填历史记忆向量，可选 `limit`（1–500）。

本地默认使用 `data/memory.sqlite`，可通过 `MEMORY_DB_PATH` 修改。运行记忆领域测试：

向量由阿里云百炼 `tongyi-embedding-vision-flash` 生成（768 维），以 Float32 BLOB 和内容哈希保存在同一个
SQLite 数据库的 `memory_embeddings` 表中。召回会融合关键词分数、余弦相似度和记忆置信度；记忆更新时
旧向量立即失效，新增/更新时实时生成，历史数据在召回时懒回填，也可以通过管理 API 主动回填。

如果没有配置 `EMBEDDING_API_KEY`、模型暂未开通或接口临时失败，系统会自动降级到关键词召回，记忆的
写入、读取和三层划分仍可正常工作。当前实现对单个用户最多 2000 条候选向量做 SQLite 内精确余弦计算；
当单用户记忆量明显超过该规模时，再迁移到 Qdrant、pgvector 等 ANN 向量索引更合适。

默认 `EMBEDDING_BASE_URL` 使用百炼北京地域公共地址；如果创建工作空间密钥时控制台给出了专属
`API Host`，需要用该地址覆盖此环境变量。不要把真实密钥提交到仓库。

```bash
npm run test:memory
```

## 意图路由与结构化结果（v0.6）

Agent 现在先做顶层意图识别，再决定是否进入路线制作循环。支持：新建/修改/比较/评估路线、地点发现、点到点导航、基础信息、记忆查询、历史路线、偏好反馈、社交文案和普通对话。地点发现和导航只调用对应工具，不会因为提到一个地点就强制生成完整路线。

路线结果的 `summary` 只保留一行摘要；完整信息放在 `routeOverview`（城市、起终点、同行人、总时长/路程/停留、费用、天气、重要约束）以及 `stops`、`routeLegs` 中。前端按“重要信息 → 详细路线 → 路线图”展示，避免散文式回答掩盖约束。

当硬约束、软偏好或数据可验证性无法同时达到最优时，结果会在顶层及 `routeOverview.tradeoffs`
返回同一组结构化说明：`issue` 是冲突/不确定性，`decision` 是当前路线采用的取舍，
`alternatives` 是用户下一轮可选择的优化方向，`userChoiceRequired` 标记是否需要用户确认。
这些说明也会转成可读文字写入 `routeOverview.importantNotes`，避免前端未解析新字段时隐藏关键取舍。

### 收藏路线（直接操作）

收藏不经过 Agent 对话或 LangGraph，前端路线结果页的按钮直接调用：

- `GET /api/favorites?userId=...`：读取用户收藏路线。
- `POST /api/favorites`：提交 `{ userId, historyId }`。服务端按用户读取历史快照后保存，同一路线自动去重；不会信任前端上传的整份路线。
- `DELETE /api/favorites/:id?userId=...`：取消收藏。

收藏快照与历史记录分开保存到 `data/favorite-routes.json`，并在前端历史侧栏的“收藏”页签查看。

### 手账照片生成插画

手账编辑器使用两类火山方舟模型：`ARK_VISION_MODEL` 分析原始照片的主体、焦点和留白，
`ARK_IMAGE_MODEL` 使用 Seedream 将用户选中的原始照片转换成手绘插画。两者可以共用
`ARK_API_KEY`，密钥只保存在后端环境变量中。

- `POST /api/journal/illustrations`：生成一张插画；固定关闭组图，服务端缓存相同照片与提示词。
- `GET /api/journal/illustrations/:id`：读取当前登录用户自己的生成图片。
- `DELETE /api/journal/illustrations/:id`：删除生成图片，原始照片不受影响。

生成结果会立即从平台临时 URL 下载到 `JOURNAL_ASSET_DIR`，元数据保存在
`JOURNAL_ASSET_DB_PATH`。缓存命中不重复调用模型；默认每个用户滚动 24 小时最多生成
`JOURNAL_IMAGE_DAILY_LIMIT=20` 张，并且同一用户只允许一个生成任务并发执行。前端同一跨页最多启用
一张插画，用户可以随时切回原照、重做或删除插画。

### 联调与部署注意事项

- `/api/agent/trace/stream` 使用 SSE；开发代理和生产 Nginx 都必须关闭响应缓冲，并将读取超时设置得高于 `AGENT_REQUEST_TIMEOUT_MS`。
- 后端通过 `SSE_HEARTBEAT_MS` 发送心跳，通过 `EXTERNAL_API_TIMEOUT_MS` 限制高德、天气等外部请求；客户端断开会取消当前规划。
- 生产环境设置 `CORS_ORIGINS`（多个来源用英文逗号分隔）。同源部署可以留空。
- Nginx 配置示例见 `deploy/nginx.citywalk.conf.example`。

### 官方数据源接入边界

- 高德 Web 服务 API：POI 搜索/详情、地理编码、步行/公交路径规划，配置 `AMAP_KEY`；网页地图使用 Web JS Key，Android 原生地图使用与应用包名及签名绑定的 Android Key。
- 和风天气：实时天气、逐小时/逐日预报、空气质量和预警，配置 `QWEATHER_KEY`；建议同时配置控制台提供的专属 `QWEATHER_API_HOST`。
- 国家文物局“全国博物馆名录”可作为博物馆基础名录和资质校验源，但不是实时预约库存接口。
- 场馆开放时间、票价、余票和实名预约需要优先接入场馆官网/官方小程序或地方文旅平台的授权接口；不要把搜索引擎摘要或非授权抓取结果标记成“已确认”。
- 国家公共文化云支持机构认证后申请 AK/SK 做场馆、活动和预约数据对接，适合获得地方公共文化场馆的正式数据权限。
# citywalk-pulse-backend



## Getting started

To make it easy for you to get started with GitLab, here's a list of recommended next steps.

Already a pro? Just edit this README.md and make it your own. Want to make it easy? [Use the template at the bottom](#editing-this-readme)!

## Add your files

- [ ] [Create](https://docs.gitlab.com/ee/user/project/repository/web_editor.html#create-a-file) or [upload](https://docs.gitlab.com/ee/user/project/repository/web_editor.html#upload-a-file) files
- [ ] [Add files using the command line](https://docs.gitlab.com/ee/gitlab-basics/add-file.html#add-a-file-using-the-command-line) or push an existing Git repository with the following command:

```
cd existing_repo
git remote add origin http://172.29.4.49/2026seiii-029-Aigent/citywalk-pulse-backend.git
git branch -M master
git push -uf origin master
```

## Integrate with your tools

- [ ] [Set up project integrations](http://172.29.4.49/2026seiii-029-Aigent/citywalk-pulse-backend/-/settings/integrations)

## Collaborate with your team

- [ ] [Invite team members and collaborators](https://docs.gitlab.com/ee/user/project/members/)
- [ ] [Create a new merge request](https://docs.gitlab.com/ee/user/project/merge_requests/creating_merge_requests.html)
- [ ] [Automatically close issues from merge requests](https://docs.gitlab.com/ee/user/project/issues/managing_issues.html#closing-issues-automatically)
- [ ] [Enable merge request approvals](https://docs.gitlab.com/ee/user/project/merge_requests/approvals/)
- [ ] [Automatically merge when pipeline succeeds](https://docs.gitlab.com/ee/user/project/merge_requests/merge_when_pipeline_succeeds.html)

## Test and Deploy

Use the built-in continuous integration in GitLab.

- [ ] [Get started with GitLab CI/CD](https://docs.gitlab.com/ee/ci/quick_start/index.html)
- [ ] [Analyze your code for known vulnerabilities with Static Application Security Testing(SAST)](https://docs.gitlab.com/ee/user/application_security/sast/)
- [ ] [Deploy to Kubernetes, Amazon EC2, or Amazon ECS using Auto Deploy](https://docs.gitlab.com/ee/topics/autodevops/requirements.html)
- [ ] [Use pull-based deployments for improved Kubernetes management](https://docs.gitlab.com/ee/user/clusters/agent/)
- [ ] [Set up protected environments](https://docs.gitlab.com/ee/ci/environments/protected_environments.html)

***

# Editing this README

When you're ready to make this README your own, just edit this file and use the handy template below (or feel free to structure it however you want - this is just a starting point!). Thank you to [makeareadme.com](https://www.makeareadme.com/) for this template.

## Suggestions for a good README
Every project is different, so consider which of these sections apply to yours. The sections used in the template are suggestions for most open source projects. Also keep in mind that while a README can be too long and detailed, too long is better than too short. If you think your README is too long, consider utilizing another form of documentation rather than cutting out information.

## Name
Choose a self-explaining name for your project.

## Description
Let people know what your project can do specifically. Provide context and add a link to any reference visitors might be unfamiliar with. A list of Features or a Background subsection can also be added here. If there are alternatives to your project, this is a good place to list differentiating factors.

## Badges
On some READMEs, you may see small images that convey metadata, such as whether or not all the tests are passing for the project. You can use Shields to add some to your README. Many services also have instructions for adding a badge.

## Visuals
Depending on what you are making, it can be a good idea to include screenshots or even a video (you'll frequently see GIFs rather than actual videos). Tools like ttygif can help, but check out Asciinema for a more sophisticated method.

## Installation
Within a particular ecosystem, there may be a common way of installing things, such as using Yarn, NuGet, or Homebrew. However, consider the possibility that whoever is reading your README is a novice and would like more guidance. Listing specific steps helps remove ambiguity and gets people to using your project as quickly as possible. If it only runs in a specific context like a particular programming language version or operating system or has dependencies that have to be installed manually, also add a Requirements subsection.

## Usage
Use examples liberally, and show the expected output if you can. It's helpful to have inline the smallest example of usage that you can demonstrate, while providing links to more sophisticated examples if they are too long to reasonably include in the README.

## Support
Tell people where they can go to for help. It can be any combination of an issue tracker, a chat room, an email address, etc.

## Roadmap
If you have ideas for releases in the future, it is a good idea to list them in the README.

## Contributing
State if you are open to contributions and what your requirements are for accepting them.

For people who want to make changes to your project, it's helpful to have some documentation on how to get started. Perhaps there is a script that they should run or some environment variables that they need to set. Make these steps explicit. These instructions could also be useful to your future self.

You can also document commands to lint the code or run tests. These steps help to ensure high code quality and reduce the likelihood that the changes inadvertently break something. Having instructions for running tests is especially helpful if it requires external setup, such as starting a Selenium server for testing in a browser.

## Authors and acknowledgment
Show your appreciation to those who have contributed to the project.

## License
For open source projects, say how it is licensed.

## Project status
If you have run out of energy or time for your project, put a note at the top of the README saying that development has slowed down or stopped completely. Someone may choose to fork your project or volunteer to step in as a maintainer or owner, allowing your project to keep going. You can also make an explicit request for maintainers.
