# DPoker 设计文档

> 自部署在家庭 NAS 上的德州扑克朋友局应用，支持注册/邀请、单桌运行、自定义参数、All-in 实时投票、鱿鱼模式积分玩法。

- **状态**：设计已确认，等待审阅后转入实现计划
- **创建日期**：2026-05-28
- **目标用户**：项目作者及其朋友圈子（≤ 9 人）

---

## 1. 目标与范围

### 1.1 目标

- 在家庭 NAS 上以单容器形式部署一个**自主可控**的德州扑克游戏服务，供朋友局使用
- 支持注册账号 + 邀请码机制，避免陌生人乱入
- 房主可在创建桌子时**自定义全部关键参数**：盲注、买入上下限、reload 规则、桌位、行动超时、All-in 默认发牌次数、鱿鱼模式开关
- 提供**鱿鱼模式**这一独有玩法（详见 §6）
- 同时支持手机和电脑浏览器访问

### 1.2 非目标

- 不做语音、不做聊天、不做表情交互（朋友局可外部沟通）
- 不做跨桌跨天积分系统、不做永久排行榜、不做赛事/锦标赛
- 不做严格防作弊（仅保障手牌私密）
- 不做多桌并行（同一时刻支持多桌运行可，但 UI 与体验为单桌优先）
- 不做服务端横向扩展、不做高可用方案

### 1.3 成功标准

- 朋友通过浏览器访问 NAS 域名 → 注册/登录 → 输入邀请码进桌 → 流畅完成一整局德州
- All-in 时全员收到投票弹窗，按"一票否决一次发牌"规则正确执行
- 鱿鱼模式按 §6 规则正确发放与结算
- 玩家在手机和电脑上的操作和显示均无障碍

---

## 2. 整体架构

### 2.1 部署形态

单 Docker 容器，单 Node.js 进程内承载：
- HTTP API（Express）
- WebSocket（Socket.IO）
- React 前端静态文件托管
- 嵌入式 SQLite 数据库（文件挂载到 NAS 卷）

```
┌──────────────────────────────────────────────────────┐
│  Docker 容器（单 Node.js 进程）                       │
│                                                      │
│  ┌───────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Express   │  │ Socket.IO    │  │ React 静态   │  │
│  │ /api/*    │  │ /ws          │  │ 文件 /       │  │
│  └─────┬─────┘  └──────┬───────┘  └──────────────┘  │
│        │               │                             │
│  ┌─────▼───────────────▼──────────────┐             │
│  │  Game Engine（内存状态）            │             │
│  │  纯函数 reduce(state, event)        │             │
│  └────────────────┬────────────────────┘            │
│                   │                                  │
│  ┌────────────────▼─────────────────┐               │
│  │  SQLite（持久化层）               │               │
│  └──────────────────────────────────┘               │
│                                                      │
│  挂载卷: /data → NAS 上的 ./data 目录                 │
└──────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

| 决策 | 选择 | 原因 |
|---|---|---|
| 部署单元 | 单容器单进程 | 朋友局规模 ≤ 9 人，无需水平扩展，运维最简 |
| 数据库 | SQLite (better-sqlite3) | 文件即数据库，备份就是 cp，性能足够 |
| 实时通讯 | Socket.IO | 自动重连、房间机制、跨浏览器和移动端兼容性好 |
| 桌面运行时状态 | 内存 + 事件 log（event sourcing） | 同时落盘事件日志，重启 replay 可恢复手内 |
| 状态管理范式 | Reducer + 事件 log | 纯函数 reduce(state, event) → newState；可单测、可重放、可审计 |
| 崩溃恢复 | 完整 event sourcing 恢复（含手内） | 已选事件 log 架构，复用成本低 |
| 前端静态文件 | Node 同进程托管 | 减少容器数；如有需要可外加 nginx 反代 |

### 2.3 技术栈

- **后端**：Node.js 20+ / TypeScript / Express / Socket.IO / better-sqlite3 / pokersolver / bcrypt / jsonwebtoken / zod
- **前端**：React / TypeScript / Vite / Zustand / socket.io-client
- **构建**：单一 monorepo，前端 `vite build` → `dist/client/`，后端启动时静态托管
- **容器**：Dockerfile（多阶段构建）+ docker-compose.yml

---

## 3. 模块结构

```
src/
├── server/
│   ├── index.ts                    # 进程入口
│   ├── http/
│   │   ├── auth.routes.ts          # 注册/登录/邀请码
│   │   ├── table.routes.ts         # 创建桌、加入桌、列表
│   │   └── leaderboard.routes.ts   # 桌内积分榜
│   ├── ws/
│   │   ├── socket.gateway.ts       # 连接、鉴权、加入房间
│   │   └── table.handler.ts        # 桌内事件分发
│   ├── game/                       # 核心游戏引擎（纯函数）
│   │   ├── deck.ts                 # 洗牌、发牌
│   │   ├── hand-evaluator.ts       # 包装 pokersolver
│   │   ├── betting.ts              # 下注轮逻辑、合法性校验
│   │   ├── pot.ts                  # 主池/边池
│   │   ├── runout.ts               # all-in 时跑一次/两次
│   │   ├── runout-vote.ts          # all-in 投票（一票否决）
│   │   ├── table-state.ts          # 桌面状态机
│   │   ├── squid-round.ts          # 鱿鱼模式本轮状态
│   │   └── squid-stats.ts          # 多维度积分统计
│   ├── domain/
│   │   ├── user.ts
│   │   ├── table-config.ts
│   │   ├── seat.ts
│   │   └── hand-history.ts
│   ├── store/                      # 持久化层
│   │   ├── db.ts                   # better-sqlite3 实例 + WAL
│   │   ├── user.repo.ts
│   │   ├── invite.repo.ts
│   │   ├── hand-history.repo.ts
│   │   ├── table-stats.repo.ts
│   │   └── migrations/
│   └── runtime/
│       ├── table-registry.ts       # 内存中所有活动桌
│       └── auth.ts                 # JWT 与 session
├── shared/                         # 前后端共享类型
│   ├── protocol.ts                 # WS 事件名与载荷
│   └── game-types.ts               # Card, Stage, Action ...
└── client/
    ├── App.tsx
    ├── pages/
    │   ├── Login.tsx
    │   ├── Lobby.tsx               # 桌列表 / 创建桌
    │   ├── Table.tsx               # 牌桌主界面
    │   └── Leaderboard.tsx
    ├── game/
    │   ├── socket.ts
    │   └── store.ts                # Zustand
    └── components/
        ├── PokerTable.tsx          # 响应式：手机竖屏 / 电脑横屏
        ├── Seat.tsx
        ├── ActionBar.tsx           # check/call/raise/fold
        ├── RunoutVoteModal.tsx     # all-in 投票弹窗
        └── SquidPanel.tsx          # 鱿鱼模式面板
```

### 3.1 边界原则

- `game/` 全是纯函数 + 不可变状态；输入旧状态 + 事件，输出新状态。**易于单元测试**
- `store/` 是数据库唯一接触点，业务层通过 repo 接口访问
- `shared/protocol.ts` 是前后端契约，类型变更两端编译同步报错
- `runtime/` 只装易变的内存状态（活动桌注册表），单独一层方便重启清理

---

## 4. 数据模型

### 4.1 SQLite Schema

```sql
-- 用户
CREATE TABLE users (
  id            TEXT PRIMARY KEY,         -- uuid
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,            -- bcrypt
  display_name  TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

-- 邀请码
CREATE TABLE invites (
  code          TEXT PRIMARY KEY,
  created_by    TEXT REFERENCES users(id),
  used_by       TEXT REFERENCES users(id),  -- null = 未使用
  created_at    INTEGER NOT NULL,
  used_at       INTEGER
);

-- 会话
CREATE TABLE sessions (
  token         TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id),
  expires_at    INTEGER NOT NULL
);

-- 桌子
CREATE TABLE tables (
  id            TEXT PRIMARY KEY,         -- uuid
  short_code    TEXT UNIQUE NOT NULL,     -- 6 位邀请短码
  host_id       TEXT REFERENCES users(id),
  config_json   TEXT NOT NULL,            -- TableConfig 序列化
  status        TEXT NOT NULL,            -- 'lobby' | 'running' | 'paused' | 'closed'
  created_at    INTEGER NOT NULL,
  closed_at     INTEGER
);

-- 手牌历史
CREATE TABLE hand_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id      TEXT REFERENCES tables(id),
  hand_no       INTEGER NOT NULL,
  played_at     INTEGER NOT NULL,
  data_json     TEXT NOT NULL             -- 完整快照
);

-- 桌内积分（多维度统计 + 鱿鱼积分）
CREATE TABLE table_stats (
  table_id      TEXT,
  user_id       TEXT,
  hands_played  INTEGER DEFAULT 0,
  hands_won     INTEGER DEFAULT 0,
  vpip_count    INTEGER DEFAULT 0,        -- 翻前自愿入池次数
  pfr_count     INTEGER DEFAULT 0,        -- 翻前主动加注次数
  showdown_won  INTEGER DEFAULT 0,
  total_buyin   INTEGER DEFAULT 0,
  total_cashout INTEGER DEFAULT 0,
  biggest_pot   INTEGER DEFAULT 0,
  squid_points  INTEGER DEFAULT 0,        -- 鱿鱼模式积分（净值，可正可负）
  PRIMARY KEY (table_id, user_id)
);
```

启用 WAL 模式：`PRAGMA journal_mode=WAL;`

### 4.2 TableConfig 类型

```ts
type TableConfig = {
  name: string;

  // 资金类
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;                    // 例如 50 BB
  maxBuyIn: number;                    // 例如 200 BB
  reloadPolicy: 'anytime' | 'between-hands' | 'never';

  // 桌位 / 节奏类
  maxSeats: number;                    // 2-9
  allowSpectators: boolean;
  actionTimeoutSec: number;            // 默认 30
  timeBankSec: number;                 // 默认 30

  // 玩法类
  defaultRunoutCount: 1 | 2;           // all-in 默认发几次（每手仍可现场投票否决）
  squidMode: boolean;                  // 是否开启鱿鱼模式
  squidPointsPerCatch: number;         // 每只鱿鱼对应积分（squidMode=true 时使用）
};
```

### 4.3 持久化时机

| 数据 | 写入时机 |
|---|---|
| users / invites / sessions | 注册 / 登录 / 邀请操作即时 |
| tables | 房主开桌时 |
| hand_history | 每手结束（showdown 或全员弃牌） |
| table_stats | 每手结束、玩家入座、玩家离座时增量更新 |

---

## 5. 核心游戏状态机

### 5.1 状态图

```
        ┌──────────┐
        │ LOBBY    │  桌刚开，玩家陆续入座
        └────┬─────┘
             │ 房主点击「开始游戏」（≥ 2 人就座）
             ▼
        ┌─────────┐
        │ WAITING │  正式开局态
        └────┬────┘
             │ 人数 ≥ 2 且未暂停
             ▼
        ┌─────────────────┐
        │ HAND_STARTING   │  发庄、收盲注、发底牌
        └────┬────────────┘
             ▼
        ┌─────────┐
        │ PREFLOP │ ──┐
        └────┬────┘   │
        ┌────▼────┐   │  下注轮:
        │  FLOP   │   │  WAITING_FOR_ACTION
        └────┬────┘   │   ↑     ↓ (action)
        ┌────▼────┐   │   └─────┘
        │  TURN   │   │
        └────┬────┘   │
        ┌────▼────┐   │
        │  RIVER  │ ──┤
        └────┬────┘   │
             │        │  任意阶段触发 ALL-IN 且只剩 ≤ 1 人能行动
             ▼        ▼
        ┌─────────────────┐
        │ ALL_IN_VOTE     │  弹窗，所有 all-in 玩家投票一次/两次
        └────┬────────────┘
             ▼
        ┌──────────┐
        │ RUNOUT   │  按投票结果发剩余公共牌
        └────┬─────┘
             ▼
        ┌──────────┐
        │ SHOWDOWN │  比牌、分主池/边池
        └────┬─────┘
             ▼
        ┌─────────────────┐
        │ SQUID_DISTRIBUTE│  仅 squidMode=true 时执行（详见 §6）
        └────┬────────────┘
             ▼
        ┌──────────────┐
        │ HAND_CLEANUP │  写 hand_history、更新 table_stats、移庄
        └────┬─────────┘
             ▼  人 ≥ 2 → 回到 HAND_STARTING
                人 < 2 → 回到 WAITING
```

另存在两个全局态：
- `PAUSED`：房主暂停后，本手结束才生效
- `CLOSED`：桌子关闭，状态机停止

### 5.2 关键事件

**Client → Server**：

```ts
{ type: 'PLAYER_ACTION', tableId, action: 'fold'|'check'|'call'|'raise'|'all-in', amount? }
{ type: 'START_GAME', tableId }                  // 房主专属
{ type: 'PAUSE_GAME', tableId }                  // 房主专属
{ type: 'RESUME_GAME', tableId }                 // 房主专属
{ type: 'CLOSE_TABLE', tableId }                 // 房主专属
{ type: 'RUNOUT_VOTE', tableId, choice: 1|2 }    // all-in 玩家投票
{ type: 'BUY_IN', tableId, amount }
{ type: 'SIT_DOWN', tableId, seatIdx }
{ type: 'STAND_UP', tableId }
```

**Server → Client（房间广播）**：

```ts
{ type: 'TABLE_STATE', publicState }             // 公共信息
{ type: 'PRIVATE_HOLE_CARDS', cards }            // 单播
{ type: 'RUNOUT_VOTE_REQUEST', deadlineMs }      // 单播给所有 all-in 玩家
{ type: 'RUNOUT_DECIDED', count: 1|2 }
{ type: 'HAND_RESULT', winners, pots, revealed }
{ type: 'SQUID_ROUND_UPDATE', state }            // 见 §6
{ type: 'SQUID_ROUND_SETTLED', loserId, payouts }
{ type: 'ACTION_REJECTED', reason }
```

### 5.3 校验责任

服务端对每个 `PLAYER_ACTION` 校验：当前是否轮到该玩家、动作合法性、金额合法（最小加注 = 上一加注 + 大盲、不超过自己筹码）。校验失败回 `ACTION_REJECTED`，状态不变。

### 5.4 行动超时

`WAITING_FOR_ACTION` 设置定时器：
- `actionTimeoutSec` 用完且玩家有 time bank → 自动进入 time bank
- time bank 也用完 → 自动 fold（如可 check 则 check）
- 玩家断线视为离座但保留位置 N 手；超过则强制弃牌座位回收

### 5.5 All-in 投票（一票否决）

进入 `ALL_IN_VOTE` 时：
1. 服务端冻结牌堆，向**所有还在牌的玩家**（all-in 或未弃牌的全下方）单播 `RUNOUT_VOTE_REQUEST` 含倒计时（默认 5 秒）
2. 客户端弹窗，每人选 `1` 或 `2`
3. **只要有一个人选 1，最终就是 1**；超时未选按桌面 `defaultRunoutCount` 计入
4. 投票汇总后广播 `RUNOUT_DECIDED`，进入 `RUNOUT` 阶段

### 5.6 房主权限边界

房主**仅有**以下三类权限：
- 开桌时：设定全部 TableConfig 参数
- 桌外：生成邀请码
- 运行时：`START_GAME` / `PAUSE_GAME` / `RESUME_GAME` / `CLOSE_TABLE`

房主**不能**调整玩家筹码、踢人、提前结束某手、查看他人手牌。所有玩家在牌桌内地位平等。

### 5.7 崩溃恢复语义

- 进程重启 → `runtime/table-registry` 内存清空，**从事件 log replay 恢复所有 RUNNING 状态的桌**
- 重启期间断开的玩家 socket 重连后，从事件 log 接续，行为如同短断线
- 详见 §12.12 事件溯源与崩溃恢复

---

## 6. 鱿鱼模式

### 6.1 玩法规则

**配置**：

- 房主开桌时勾选 `squidMode` 开关
- 房主设定 `squidPointsPerCatch`（每只鱿鱼对应的积分值，例如 10）

**一轮的运行**：

1. **桌内人数 N，本轮鱿鱼总数 = N - 1**
2. 每手按正常德州规则进行
3. 一手结束时：
   - **唯一赢家** 且 **本轮还没拿过鱿鱼** → 拿走 1 只
   - **赢家本轮已拿过** → 鱿鱼留到下一手
   - **平分底池**（多人共赢）→ 谁都不拿，鱿鱼留到下一手
4. 持续打到 N-1 只全部分发完（即 N-1 个不同玩家各拿到 1 只）
5. 此时**剩下唯一空手玩家** → 给其他每个有鱿鱼的人付 `squidPointsPerCatch` 积分（即输家共付 `squidPointsPerCatch × (N-1)`）
6. 一轮结束 → 鱿鱼清零，重新开始下一轮

**中途人数变化**：

- 任何玩家加入或离开 → 本轮立即作废，所有鱿鱼清零，重置为新一轮

### 6.2 与底层引擎的关系

- 鱿鱼模式只是在 `SHOWDOWN → HAND_CLEANUP` 之间多一个 `SQUID_DISTRIBUTE` 钩子
- **不影响**牌局规则、下注、All-in、reload
- **鱿鱼积分独立于筹码**，只算积分不影响桌内筹码

### 6.3 数据结构

```ts
type SquidRoundState = {
  totalSquids: number;              // = 当前在座玩家数 - 1
  pointsPerSquid: number;
  holders: Map<userId, number>;     // 每人持有数（本规则只会是 0 或 1）
  pendingCarryOver: number;         // 上手未分发、留到下手的数量
};
```

### 6.4 分发伪代码

```
function distributeSquid(round, handResult):
  toAward = 1 + round.pendingCarryOver

  if handResult.isSplit OR handResult.winners.length > 1:
    round.pendingCarryOver = toAward
    return

  winner = handResult.winners[0]
  if round.holders.get(winner) >= 1:
    round.pendingCarryOver = toAward
    return

  round.holders.set(winner, 1)
  round.pendingCarryOver = toAward - 1

  if 已分发数 == round.totalSquids:
    settleRound(round)
```

### 6.5 结算伪代码

```
function settleRound(round):
  loser = 唯一持有 0 只的玩家
  for each holder where count >= 1:
    table_stats[holder].squid_points += pointsPerSquid
  table_stats[loser].squid_points -= pointsPerSquid * round.totalSquids
  resetRound()  // 清空 holders/pendingCarryOver；totalSquids 按当前人数重算
```

### 6.6 协议事件

- `SQUID_ROUND_UPDATE`：本轮鱿鱼分布快照，每手结束 + 人数变化时推送
- `SQUID_ROUND_SETTLED`：本轮结算结果（含输家、付分明细），触发前端动画

### 6.7 UI 显示

- 桌面顶部："本轮鱿鱼: 🦑🦑🦑⬜⬜"（已分发/总数）
- 每个座位旁：玩家本轮持有鱿鱼数（0 或 1）
- 积分榜单独一栏 **"鱿鱼积分"**（累计净分），与多维度统计并列

---

## 7. 注册与身份

### 7.1 三种身份

| 身份 | 注册流程 | 持久化 | 用途 |
|---|---|---|---|
| 注册用户 | 用户名 + 密码 + 邀请码 | 全部统计 + 跨桌身份 | 长期玩家 |
| Guest | 临时昵称 + 桌子短码 | 仅当前桌 table_stats，关桌即失 | 临时来玩一两手 |
| 房主 | 注册用户中创建桌子者 | 同注册用户 | 控制桌生命周期 |

### 7.2 邀请码

- 任何注册用户可生成（小圈子内可信，初版不限制）
- 注册时强制使用一个未用过的邀请码；用过即作废
- 首次部署 admin 通过 CLI 或环境变量预置首批邀请码

### 7.3 鉴权

- HTTP API：`Authorization: Bearer <jwt>`
- WebSocket：连接握手时携带 token，校验后绑定 userId
- Token 有效期 30 天，支持登出失效

---

## 8. 前端体验

### 8.1 路由

- `/login` 登录 / 注册
- `/lobby` 桌子列表（自己创建的 + 输入短码加入）
- `/table/:id` 牌桌界面
- `/table/:id/leaderboard` 桌内积分榜（含鱿鱼积分）

### 8.2 响应式策略

- 手机竖屏：圆桌纵向布局，自己在底部固定，其他玩家围绕；ActionBar 固定底部
- 电脑横屏：传统椭圆桌，玩家围一圈；ActionBar 在桌面下方
- 关键断点 768px

### 8.3 关键交互

- **All-in 投票弹窗**：进入 `ALL_IN_VOTE` 后立即弹出，含倒计时进度条；点选后立刻提交
- **鱿鱼面板**：squidMode 开启时常驻顶部；本轮结算时全屏动画提示输家与得分变化
- **行动按钮**：`fold` / `check or call` / `raise`（含金额滑杆与预设金额按钮 1/2 pot, pot, all-in）

---

## 9. 部署

### 9.1 Dockerfile（多阶段）

```dockerfile
# Stage 1: build
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build       # 构建前端 + 后端 TS

# Stage 2: runtime
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json .
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
```

### 9.2 docker-compose.yml

```yaml
services:
  dpoker:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
    environment:
      - NODE_ENV=production
      - JWT_SECRET=${JWT_SECRET}
      - DB_PATH=/data/dpoker.db
    restart: unless-stopped
```

### 9.3 备份策略

- 备份 = 复制 NAS 上 `./data/` 目录
- SQLite WAL 模式下，可在线热备：`VACUUM INTO`

---

## 10. 测试策略

### 10.1 单元测试

- `game/` 全部纯函数逐个覆盖：发牌、下注合法性、底池切分、牌型比较、All-in 投票汇总、鱿鱼分发与结算
- 重点覆盖边界：split pot、多人 all-in 形成多个边池、all-in 投票超时

### 10.2 集成测试

- 模拟 N 个 socket 客户端完整跑一手：preflop→flop→turn→river→showdown
- 模拟 all-in 触发投票流程
- 模拟鱿鱼模式一整轮直到结算
- 模拟人数变化触发本轮重置

### 10.3 端到端测试

- Playwright 跑两个浏览器实例完整对战；验证手机断点和电脑断点

---

## 11. 风险与未决事项

| 风险 | 缓解 |
|---|---|
| 进程重启时手内崩溃恢复的状态机错误 | 事件 log replay 受严格单测覆盖；replay 失败的桌降级为关桌处理（参考 §12.12） |
| pokersolver 库异常或不维护 | 逻辑封装在 `hand-evaluator.ts` 一处，方便替换 |
| NAS 网络外部访问 | 由用户自行配置反向代理 / 端口转发 / 内网穿透；本应用不负责 |
| 时钟漂移影响超时判定 | 服务端单一时钟权威，超时使用绝对时间戳广播给客户端，客户端只显示倒计时 |
| Heads-up 盲注规则写错 | 对 §12.3 标准 heads-up 规则单独覆盖测试 |
| 事件 log 表无限增长 | 桌子 CLOSED 后 N 天清理；保留聚合后的 hand_history 与 table_stats |

---

## 12. 规则与工程细节补充

本节集中说明对照主流开源实现后明确的边角规则与工程约束。

### 12.1 断线与重连

- **短断线（≤ 30 秒）**：座位保留、手牌保留、超时计时器照常走。重连后无缝继续
- **长断线（> 30 秒）**：本手当前阶段自动 fold（如可 check 则 check），保留座位 N 手不参与
- **超时阈值 N**：默认 3 手，可在 TableConfig 中调整
- **N 手内未回**：座位回收，玩家剩余筹码冻结进 `pending_cashout`（重新坐下时返还）
- 客户端重连必须携带 `sessionToken`，不依赖 `socket.id`；服务端按 userId + tableId 做映射，重新订阅房间 + 推送当前 publicState（含 `lastEventSeq`）

### 12.2 行动超时与 Time Bank

- **基础时长**：`actionTimeoutSec`（默认 30 秒），每手每个行动起始时刻计算
- **Time Bank**：玩家入桌时获得 `timeBankSec`（默认 60 秒）的总池
- 基础时间用完后，客户端弹出"启用 time bank"按钮，点击后切到 time bank 倒计时；time bank 池逐秒扣减（仅当前回合扣减 = 实际使用秒数）
- Time bank 池子在桌内累积/扣减，每手开始时按 `timeBankRefillPerHand` 回血（默认 0，初版关闭回血）
- **超时统一规则**：基础时间 + time bank 都耗尽时 → 自动 check（如可），否则自动 fold
- **时间广播**：服务端将"截止时刻 deadlineMs（绝对 epoch 毫秒）"广播给客户端；客户端只用于显示，不参与判定

### 12.3 Heads-up（2 人对决）规则

严格按赌场标准实现：

- **Pre-flop**：button 同时是小盲，对手是大盲；**button 先行动**
- **Post-flop**：大盲先行动（即非 button 先行动）
- 对应代码：`betting.ts` 中下注顺序计算函数对 N=2 走专门分支
- 此规则必须有专门的单元测试覆盖（开源项目常见错误）

### 12.4 中途入坐与离座

- **入坐**：默认等到自己自然轮到 BB 位才入局；坐下后状态为 `WAITING_FOR_BB`
- **离座**：标记 `sitOutNextHand`，本手照常进行；本手结束后正式离座，剩余筹码留在座位（重坐时自动取回）
- 玩家若在 `WAITING_FOR_BB` 状态下站起再回来，视同未入局，不必补盲
- 玩家若已入局后离座，再回来落座时若距离上次离开 < `bbRotationsBeforeAvoidanceCheck`（默认 1 轮 BB），需补缴错过的大盲后入局，防止"逃避大盲"

### 12.5 Dead Button 规则

- 采用赌场标准 Dead Button：当原 BB 位玩家离开时，button 仍按顺序推进，可能出现 button 落在空座的情况
- 对应代码：`table-state.ts` 中庄家位推进函数维护"虚拟 button"——记录 button 应在的逻辑位置，渲染时若落在空座则显示为 dead button
- 单元测试覆盖：玩家离开 BB 位 / SB 位 / button 位三种场景下的下一手庄家位推进

### 12.6 Straddle（翻前加盲）

- UTG 玩家可在拿牌前主动声明 straddle，下注 2× BB，**临时成为最后行动者**
- 支持 single straddle（仅 UTG）；初版**不支持** double/Mississippi straddle
- 客户端在 `HAND_STARTING` 阶段轮到 UTG 收 BB 之前弹出"是否 straddle?"按钮，3 秒内未选则按 no
- 服务端校验 straddle 仅来自 UTG，且玩家筹码 ≥ 2× BB

### 12.7 边池切分（Side Pot）

经典分层算法：

```
sortedContribs = 按贡献额升序排列玩家投入额（去重）
prevLevel = 0
for level in sortedContribs:
  layerAmount = (level - prevLevel) * 该层及更高层的玩家数
  pot = { amount: layerAmount, eligibleIds: 投入 >= level 的所有玩家 }
  pots.push(pot)
  prevLevel = level
```

边角规则：
- 弃牌玩家的筹码仍归入对应层级 pot，但其 id **不在 eligibleIds**
- 多人同 all-in 同额时合并入同一 pot
- showdown 时按 pot 顺序结算：每个 pot 仅在其 eligibleIds 中比较手牌

`pot.ts` 必须有测试用例覆盖：单人 all-in / 多人不同额 all-in / 弃牌玩家筹码归集 / split pot 多人共赢。

### 12.8 加注合法性

- **最小加注**：`minRaise = 上一次加注的增量`（不是总下注额）。无前置加注时 `minRaise = bigBlind`
- **不完整 all-in 加注**：玩家 all-in 但金额 `< minRaise` 时，只构成 call + 不完整加注；**不重新打开**已行动玩家的行动权
- **min-raise 推进**：每次合法加注后，`minRaise` 更新为该次加注的增量
- 服务端 `betting.ts` 维护 `lastRaiseAmount` 与 `actionReopened` 标志

### 12.9 Run It Twice 触发条件

- 仅当**至少一方已 all-in 且当前阶段在 river 之前**（即仍有 turn 或 river 待发）才触发投票
- River 已发完后的 all-in（边池小变化）不触发
- 投票主体：所有未弃牌玩家中**已 all-in 或自动跟进的玩家**
- 一票否决规则不变（任一人选 1 即 1）

### 12.10 Commit-Reveal 洗牌审计

每手开始时执行：

1. 服务端用 `crypto.randomBytes(32)` 生成 `serverSeed`
2. 计算 `commitHash = sha256(serverSeed)`
3. 广播 `HAND_DEAL_COMMIT { handNo, commitHash }` 给所有玩家
4. 用 `serverSeed` 作为洗牌种子（Fisher-Yates + `crypto.randomInt`），开始发牌
5. 手牌结束 SHOWDOWN 后广播 `HAND_DEAL_REVEAL { handNo, serverSeed, finalDeck }`
6. 客户端可验证：`sha256(serverSeed) === commitHash`，且按 seed 重放洗牌得到 `finalDeck`

事件 log 同时记录 commit 与 reveal，hand_history 落盘 `serverSeed` 字段供事后审计。

### 12.11 事件序列号与状态同步

- 服务端为每个桌维护单调递增的 `eventSeq`
- 所有广播事件携带 `{ tableId, seq, payload }`
- 客户端记录已收到的最大 `lastSeq`
- 重连时客户端发 `RESYNC { tableId, lastSeq }`，服务端补发缺失事件（如超过 log 保留窗口则推送当前完整 publicState 替代）

### 12.12 事件溯源与崩溃恢复

#### 事件 log 表

```sql
CREATE TABLE event_log (
  table_id    TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL,         -- JSON
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (table_id, seq)
);
CREATE INDEX idx_event_log_table ON event_log(table_id, seq);
```

#### 写入策略

- 每个 reducer 的输入事件都写入 `event_log`
- 同一事务内写 event_log + 更新派生表（hand_history / table_stats）
- WAL 模式下同步写入性能足够（朋友局规模 < 100 events/秒）

#### Replay 策略

启动时：
1. 查询所有 `status IN ('lobby','running','paused')` 的桌
2. 对每张桌按 `seq` 升序加载所有 event
3. 用纯函数 `reduce(initialState, events)` 重建当前状态
4. 注册到 `table-registry`
5. Replay 失败的桌（状态机 throw）→ 自动标记 `closed`，记录 admin 日志

#### Replay 边界

- 进行中的行动超时定时器在重启后**重新启动**，截止时刻按 event 中的 `deadlineMs` 计算（已过则立即触发超时事件）
- 客户端重连后通过 `RESYNC` 流程拿到当前状态

#### 清理策略

- 桌 `closed` 后 7 天清理对应 `event_log` 记录（聚合数据 hand_history / table_stats 永久保留）
- 通过定时任务执行，初版可手动触发

---



## 13. 实现顺序建议（待 writing-plans 细化）

1. 项目骨架 + Docker + SQLite 初始化
2. 注册 / 登录 / 邀请码 HTTP API
3. 牌局核心引擎（纯函数，先不接 IO）
4. 桌面状态机 + Socket.IO 集成
5. 前端登录、Lobby、空桌渲染
6. 单手完整流程（含 All-in 投票）
7. 鱿鱼模式
8. 多维度积分榜
9. 响应式适配 + 端到端测试
10. Docker 镜像打包 + NAS 部署文档

---

**设计文档结束。**
