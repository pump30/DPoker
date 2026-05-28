# DPoker 接手文档

> 跨电脑/跨会话切换开发时阅读此文件即可。1 分钟读完上手。

## 项目是什么

自部署在 NAS 上的德州扑克朋友局应用，给 9 人以下小圈子用。Docker 一键起，
含注册/邀请码、自定义盲注/买入/run-it-twice 默认值、独有的"鱿鱼模式"
积分玩法。

完整设计：`docs/superpowers/specs/2026-05-28-dpoker-design.md`（13 节，
读 §1-§6 + §12 即理解全部规则）。

## 快速上手

```bash
git clone https://github.com/pump30/DPoker.git
cd DPoker
git checkout main
npm install

# 配置环境
cp .env.example .env
# 编辑 .env，把 JWT_SECRET=REPLACE_ME_... 换成：
# openssl rand -hex 32

npm test     # 应该 161 个测试全过
npm run lint # 应该干净
```

跑前端：

```bash
npm run dev:server    # 后端 :3000
npm run dev:client    # 前端 :5173（另一终端）
```

生成首批邀请码：

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('./data/dpoker.db');
const code = Array.from({length:8},()=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]).join('');
db.prepare('INSERT INTO invites(code,created_by,used_by,created_at,used_at) VALUES (?,NULL,NULL,?,NULL)').run(code, Date.now());
console.log('Invite code:', code);
"
```

## 已完成阶段

| Stage | Tag | Tests | 状态 |
|---|---|---|---|
| 1 | `stage-1-complete` | 44 | ✅ 浏览器端到端验证过 |
| 2 | `stage-2-complete` | 109 | ✅ 9 个纯函数游戏引擎模块 |
| 3 | `stage-3-complete` | 161 | ✅ 完整状态机 reducer |

每个 tag 是干净可 checkout 的发布点：

```bash
git checkout stage-1-complete   # 含 Docker 镜像，浏览器可玩注册登录
git checkout stage-2-complete   # 加上纯函数引擎
git checkout stage-3-complete   # 加上完整状态机（含鱿鱼模式）
git checkout main               # = stage-3 + taste-skill 安装
```

### Stage 1：项目骨架 + 注册登录

- monorepo + TypeScript + Vite + React + Express + better-sqlite3
- SQLite 迁移 runner（WAL + 事务）
- 三个 repo：UserRepo、InviteRepo（原子 claim）、SessionRepo
- bcrypt + JWT auth runtime
- HTTP API：register / login / invite，含 zod 严格校验
- React + Zustand 前端：Login 页 + persist 登录状态
- Docker + docker-compose

### Stage 2：游戏引擎纯函数

`src/server/game/`：

- `deck.ts` — 确定性 Fisher-Yates 洗牌（拒绝采样消除模 bias）
- `deck-commit.ts` — commit-reveal 审计（spec §12.10）
- `hand-evaluator.ts` — 包装 pokersolver
- `betting.ts` — 下注合法性、min-raise、partial-all-in 不重开行动
- `pot.ts` — 分层边池切分 + chip conservation invariant
- `runout.ts` — 一次/两次发牌（sequential cursor）
- `runout-vote.ts` — All-in 投票一票否决
- `squid-round.ts` — 鱿鱼模式 distribute / settle / reset
- `squid-stats.ts` — 多维度积分（VPIP/PFR/胜率/最大底池等）

### Stage 3：状态机 reducer

`src/server/game/`：

- `seat.ts` — 座位环 + dead button 旋转 + heads-up first-to-act
- `blinds.ts` — 盲注收取 + per-street bet collection
- `betting.ts` 扩展：getNextActor / isBettingRoundClosed / startNewStreet
- `pot.ts` 扩展：awardPots（splitIntoPots + compareWinners 编排）
- `table-state.ts` — **完整 reducer**：(state, event) → newState
  - LOBBY → WAITING → HAND_STARTING → preflop/flop/turn/river → SHOWDOWN
  - 全 26 种事件（CREATE_TABLE/SIT_DOWN/START_GAME/PLAYER_ACTION/...）
  - All-in 投票 + 多板 runout
  - 鱿鱼模式 hook（roster 变化重置）
  - 完整 chip conservation 测试（heads-up 全街检查 + preflop fold）

`src/shared/`：

- `game-types.ts` — Card / Stage / Action / Pot
- `table-types.ts` — TableConfig / TableState / SeatedPlayer / Hand / SquidPanel

## 还没做（Stage 4+）

按优先级：

1. **事件溯源持久化**（spec §12.12）
   - SQLite `event_log` 表：(table_id, seq, type, payload, created_at)
   - 进程启动时 replay 恢复所有 running 桌
   - reducer 已经设计成纯函数 + event injection，加持久化是机械工作
2. **Socket.IO 集成**
   - `src/server/ws/socket.gateway.ts`：连接 + 鉴权 + 加入房间
   - `src/server/ws/table.handler.ts`：把 socket events 翻译成 TableEvent
   - 客户端单播 hole cards、广播 public state
   - Event seq 序列号 + RESYNC 流程（reviewer Stage 3 报告里建议）
3. **HTTP 路由**：create-table / list / join-by-shortcode
4. **前端 UI**：
   - Lobby：桌列表 + 创建桌（含 squidMode 配置）
   - Table：圆桌渲染 + ActionBar + 手牌私密显示
   - RunoutVoteModal：All-in 弹窗 + 倒计时
   - SquidPanel：鱿鱼模式可视化
   - 响应式：手机竖屏 / 电脑横屏
5. **多手游戏循环**：当前一手结束后 hand=null，下一手由调用方触发
   BEGIN_HAND；需要在 socket 层加自动循环
6. **行动超时定时器**：TIMEOUT 事件已实现，需要 socket 层的 setTimeout

## 设计决策（已敲定，别再问）

- **房主权限只有 4 个**：开桌+设参数（创建时）/ 邀请码 / 开始 / 暂停 / 关桌。
  房主**不能**调整玩家筹码、踢人、提前结束某手、查看他人手牌
- **All-in 发牌**：每手现场投票，**任何一人选 1 就发 1 次**（一票否决）
- **鱿鱼模式**：每手赢一只鱿鱼，N-1 只发完后无鱿鱼那个倒霉蛋按
  `pointsPerCatch` 给每个有鱿鱼的人付积分。**不淘汰**，可重买，单桌一榜，
  人数变化重置
- **筹码体系**：纯娱乐局，每局单独结算，不跨局留存
- **身份**：注册账号 + guest 临时模式都支持，需要邀请码
- **设备**：手机 + 电脑都要（响应式）
- **聊天**：完全不要
- **防作弊**：只保障手牌不泄露
- **架构**：单容器单进程 + SQLite + Socket.IO + Reducer + 事件 log

## 工作约定

- 用中文讨论，技术名词保留英文；代码和 commit 用英文
- 实施前用 `superpowers:brainstorming` + `superpowers:writing-plans` 流程，
  不要直接 coding
- 复杂 plan 用 `superpowers:subagent-driven-development`，每个 task 派
  fresh subagent + 两轮 review（spec compliance + code quality）
- 每步 TDD：红 → 绿 → commit
- 每个 stage 完成后跑 final code review
- TDD 测试期望值要自己核算，不要让 implementer 凑数据

## 已知风险

- `.env` 不在 git 里，新机器需要重建。`.env.example` 的占位符在
  production 模式会被 `loadConfig` 拒绝（spec §13）
- Stage 3 review 提到的 minor tech debt 已在 stage-3 plan 末尾记录，
  Stage 4 接手时一并处理
- 安装的 `Leonxlnx/taste-skill` 13 个 skill 在 `.agents/`（gitignored），
  新机器要 `npx skills add Leonxlnx/taste-skill` 重新装

## 给新会话的初始 prompt

```
我在 https://github.com/pump30/DPoker.git 这个 repo 已经做完 Stage 1-3，
请读 HANDOFF.md 接手项目，然后我们继续 Stage 4。
```

跟我说"准备好了"，我会基于 HANDOFF.md 的"还没做"章节带你 brainstorm
Stage 4 范围。
