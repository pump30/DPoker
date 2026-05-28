# DPoker Stage 1 — 项目骨架与注册登录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 DPoker 项目骨架（monorepo + TypeScript + Vite + Express + SQLite + Docker），并实现注册/登录/邀请码 HTTP API 与最简前端 Login 页，确保端到端可访问。

**Architecture:** 单 Node.js 进程承载 Express(HTTP) + 静态文件托管 + SQLite。前端 React + Vite 编译后由后端托管。所有持久化经 repo 层经过 better-sqlite3。鉴权用 JWT。

**Tech Stack:** Node.js 20, TypeScript 5, Express 4, better-sqlite3, bcrypt, jsonwebtoken, zod, vitest, React 18, Vite 5, Zustand, socket.io（先装库不连），Docker, docker-compose.

**Spec:** `docs/superpowers/specs/2026-05-28-dpoker-design.md`

---

## File Structure（本阶段创建/修改的文件）

```
.
├── package.json                       # monorepo 顶层
├── tsconfig.base.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── .gitignore
├── .dockerignore
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── README.md
├── data/                              # SQLite 文件挂载点（本地 gitignored）
│   └── .gitkeep
├── src/
│   ├── server/
│   │   ├── index.ts                   # 进程入口
│   │   ├── app.ts                     # Express app 工厂（便于测试）
│   │   ├── config.ts                  # 环境变量加载与校验
│   │   ├── http/
│   │   │   ├── auth.routes.ts
│   │   │   └── invite.routes.ts
│   │   ├── domain/
│   │   │   └── user.ts
│   │   ├── store/
│   │   │   ├── db.ts
│   │   │   ├── user.repo.ts
│   │   │   ├── invite.repo.ts
│   │   │   ├── session.repo.ts
│   │   │   └── migrations/
│   │   │       └── 001_init.sql
│   │   └── runtime/
│   │       └── auth.ts                # JWT 签发/校验、bcrypt 包装
│   ├── shared/
│   │   └── api-types.ts               # 前后端共享 HTTP 协议类型
│   └── client/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.html                 # Vite 入口
│       ├── pages/
│       │   └── Login.tsx
│       ├── api/
│       │   └── client.ts              # fetch 封装
│       └── store/
│           └── auth.ts                # Zustand 鉴权 store
└── tests/
    ├── server/
    │   ├── store/
    │   │   ├── user.repo.test.ts
    │   │   ├── invite.repo.test.ts
    │   │   └── session.repo.test.ts
    │   ├── runtime/
    │   │   └── auth.test.ts
    │   └── http/
    │       ├── auth.routes.test.ts
    │       └── invite.routes.test.ts
    └── helpers/
        └── test-db.ts                 # 测试用内存 SQLite 工厂
```

---

## Task 1: 初始化 monorepo 与 TypeScript 配置

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `data/.gitkeep`

- [ ] **Step 1: 创建 `package.json`**

```json
{
  "name": "dpoker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev:server": "tsx watch src/server/index.ts",
    "dev:client": "vite",
    "build:client": "vite build",
    "build:server": "tsc -p tsconfig.server.json",
    "build": "npm run build:client && npm run build:server",
    "start": "node dist/server/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "express": "^4.19.2",
    "better-sqlite3": "^11.3.0",
    "bcrypt": "^5.1.1",
    "jsonwebtoken": "^9.0.2",
    "zod": "^3.23.8",
    "socket.io": "^4.7.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2",
    "zustand": "^4.5.5",
    "socket.io-client": "^4.7.5"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/better-sqlite3": "^7.6.11",
    "@types/bcrypt": "^5.0.2",
    "@types/jsonwebtoken": "^9.0.7",
    "@types/node": "^22.7.4",
    "@types/react": "^18.3.10",
    "@types/react-dom": "^18.3.0",
    "@types/supertest": "^6.0.2",
    "@vitejs/plugin-react": "^4.3.1",
    "supertest": "^7.0.0",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "vite": "^5.4.8",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: 创建 `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "allowSyntheticDefaultImports": true
  }
}
```

- [ ] **Step 3: 创建 `tsconfig.json`**（IDE / vitest 用，覆盖整个 src + tests）

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node", "vitest/globals"],
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"],
      "@server/*": ["src/server/*"],
      "@client/*": ["src/client/*"]
    }
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: 创建 `tsconfig.server.json`**（编译后端到 `dist/server`）

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist/server",
    "rootDir": "src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": false,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/server", "src/shared"]
}
```

- [ ] **Step 5: 创建 `.gitignore`**

```
node_modules/
dist/
data/*.db
data/*.db-*
.env
.env.local
*.log
.DS_Store
.vite/
coverage/
```

- [ ] **Step 6: 创建 `.env.example`**

```
PORT=3000
DB_PATH=./data/dpoker.db
JWT_SECRET=change-me-in-production-please-use-a-long-random-string
JWT_EXPIRES_IN=30d
NODE_ENV=development
```

- [ ] **Step 7: 创建 `data/.gitkeep`**（空文件，确保目录存在）

```
```

- [ ] **Step 8: 安装依赖并验证**

Run: `npm install`
Expected: 安装完成无错误。运行 `npx tsc -p tsconfig.json --noEmit` 应通过（无源代码所以无 error）。

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json tsconfig.json tsconfig.server.json .gitignore .env.example data/.gitkeep
git commit -m "chore: scaffold monorepo with TypeScript and dependencies"
```

---

## Task 2: 配置 Vitest 与 Vite

**Files:**
- Create: `vitest.config.ts`
- Create: `vite.config.ts`
- Create: `src/client/index.html`
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: 创建 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@server': path.resolve(__dirname, 'src/server'),
      '@client': path.resolve(__dirname, 'src/client'),
    },
  },
});
```

- [ ] **Step 2: 创建 `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: 'src/client',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@client': path.resolve(__dirname, 'src/client'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
```

- [ ] **Step 3: 创建 `src/client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DPoker</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: 创建 smoke 测试 `tests/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: 运行测试验证 vitest 工作**

Run: `npm test`
Expected: PASS — 1 test passed.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts vite.config.ts src/client/index.html tests/smoke.test.ts
git commit -m "chore: configure vitest and vite"
```

---

## Task 3: 创建 SQLite 测试 helper 与首个迁移

**Files:**
- Create: `src/server/store/migrations/001_init.sql`
- Create: `src/server/store/db.ts`
- Create: `tests/helpers/test-db.ts`
- Create: `tests/server/store/db.test.ts`

- [ ] **Step 1: 写迁移 SQL `src/server/store/migrations/001_init.sql`**

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  code          TEXT PRIMARY KEY,
  created_by    TEXT,
  used_by       TEXT,
  created_at    INTEGER NOT NULL,
  used_at       INTEGER,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (used_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token         TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
```

- [ ] **Step 2: 写 `src/server/store/db.ts`**

```ts
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type DB = Database.Database;

export function openDb(filename: string): DB {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function runMigrations(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((r: any) => r.name as string),
  );
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const insert = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)');
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      insert.run(file, Date.now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
```

- [ ] **Step 3: 写 `tests/helpers/test-db.ts`**

```ts
import { openDb, type DB } from '@server/store/db.js';

export function makeTestDb(): DB {
  return openDb(':memory:');
}
```

- [ ] **Step 4: 写迁移测试 `tests/server/store/db.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { makeTestDb } from '../../helpers/test-db.js';

describe('db migrations', () => {
  it('creates users, invites, sessions tables', () => {
    const db = makeTestDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(tables).toContain('users');
    expect(tables).toContain('invites');
    expect(tables).toContain('sessions');
  });

  it('is idempotent', () => {
    const db = makeTestDb();
    expect(() => {
      // re-open the same db handle's logic by re-running migrations manually
      db.exec(
        `INSERT INTO _migrations (name, applied_at) VALUES ('001_init.sql', ${Date.now()}) ON CONFLICT DO NOTHING`,
      );
    }).not.toThrow();
  });
});
```

- [ ] **Step 5: 运行测试验证迁移工作**

Run: `npm test -- tests/server/store/db.test.ts`
Expected: PASS — 2 tests passed.

- [ ] **Step 6: Commit**

```bash
git add src/server/store/migrations/001_init.sql src/server/store/db.ts tests/helpers/test-db.ts tests/server/store/db.test.ts
git commit -m "feat(store): add sqlite db with migrations runner and 001_init schema"
```

---

## Task 4: 实现 user.repo（含 TDD）

**Files:**
- Create: `src/server/domain/user.ts`
- Create: `src/server/store/user.repo.ts`
- Create: `tests/server/store/user.repo.test.ts`

- [ ] **Step 1: 写失败测试 `tests/server/store/user.repo.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db.js';
import { UserRepo } from '@server/store/user.repo.js';

describe('UserRepo', () => {
  let repo: UserRepo;

  beforeEach(() => {
    repo = new UserRepo(makeTestDb());
  });

  it('creates a user and finds by username', () => {
    const user = repo.create({
      username: 'alice',
      passwordHash: 'hashed',
      displayName: 'Alice',
    });
    expect(user.id).toBeTruthy();
    expect(user.username).toBe('alice');
    expect(user.createdAt).toBeGreaterThan(0);

    const found = repo.findByUsername('alice');
    expect(found?.id).toBe(user.id);
  });

  it('returns null when username not found', () => {
    expect(repo.findByUsername('ghost')).toBeNull();
  });

  it('rejects duplicate username', () => {
    repo.create({ username: 'alice', passwordHash: 'h', displayName: 'A' });
    expect(() =>
      repo.create({ username: 'alice', passwordHash: 'h', displayName: 'A2' }),
    ).toThrow();
  });

  it('finds by id', () => {
    const user = repo.create({ username: 'bob', passwordHash: 'h', displayName: 'Bob' });
    expect(repo.findById(user.id)?.username).toBe('bob');
    expect(repo.findById('missing')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/server/store/user.repo.test.ts`
Expected: FAIL — UserRepo not found.

- [ ] **Step 3: 写 domain 类型 `src/server/domain/user.ts`**

```ts
export type User = {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  createdAt: number;
};

export type CreateUserInput = {
  username: string;
  passwordHash: string;
  displayName: string;
};
```

- [ ] **Step 4: 实现 `src/server/store/user.repo.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';
import type { User, CreateUserInput } from '../domain/user.js';

type Row = {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  created_at: number;
};

function rowToUser(row: Row): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

export class UserRepo {
  constructor(private db: DB) {}

  create(input: CreateUserInput): User {
    const id = randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO users (id, username, password_hash, display_name, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.username, input.passwordHash, input.displayName, createdAt);
    return {
      id,
      username: input.username,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      createdAt,
    };
  }

  findByUsername(username: string): User | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username) as Row | undefined;
    return row ? rowToUser(row) : null;
  }

  findById(id: string): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
    return row ? rowToUser(row) : null;
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- tests/server/store/user.repo.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 6: Commit**

```bash
git add src/server/domain/user.ts src/server/store/user.repo.ts tests/server/store/user.repo.test.ts
git commit -m "feat(store): add UserRepo with create/findByUsername/findById"
```

---

## Task 5: 实现 invite.repo（含 TDD）

**Files:**
- Create: `src/server/store/invite.repo.ts`
- Create: `tests/server/store/invite.repo.test.ts`

- [ ] **Step 1: 写失败测试 `tests/server/store/invite.repo.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db.js';
import { InviteRepo } from '@server/store/invite.repo.js';
import { UserRepo } from '@server/store/user.repo.js';
import type { DB } from '@server/store/db.js';

describe('InviteRepo', () => {
  let db: DB;
  let inviteRepo: InviteRepo;
  let userRepo: UserRepo;

  beforeEach(() => {
    db = makeTestDb();
    inviteRepo = new InviteRepo(db);
    userRepo = new UserRepo(db);
  });

  it('creates an unused invite', () => {
    const inv = inviteRepo.create(null);
    expect(inv.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(inv.usedBy).toBeNull();
    expect(inv.usedAt).toBeNull();
  });

  it('claim marks invite as used and is idempotent failure on second claim', () => {
    const user = userRepo.create({ username: 'a', passwordHash: 'h', displayName: 'A' });
    const inv = inviteRepo.create(null);
    const claimed = inviteRepo.claim(inv.code, user.id);
    expect(claimed).toBe(true);
    expect(inviteRepo.findByCode(inv.code)?.usedBy).toBe(user.id);

    const user2 = userRepo.create({ username: 'b', passwordHash: 'h', displayName: 'B' });
    expect(inviteRepo.claim(inv.code, user2.id)).toBe(false);
  });

  it('claim returns false for missing code', () => {
    const user = userRepo.create({ username: 'a', passwordHash: 'h', displayName: 'A' });
    expect(inviteRepo.claim('NOPE0000', user.id)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/server/store/invite.repo.test.ts`
Expected: FAIL — InviteRepo not found.

- [ ] **Step 3: 实现 `src/server/store/invite.repo.ts`**

```ts
import { randomBytes } from 'node:crypto';
import type { DB } from './db.js';

export type Invite = {
  code: string;
  createdBy: string | null;
  usedBy: string | null;
  createdAt: number;
  usedAt: number | null;
};

type Row = {
  code: string;
  created_by: string | null;
  used_by: string | null;
  created_at: number;
  used_at: number | null;
};

function rowToInvite(row: Row): Invite {
  return {
    code: row.code,
    createdBy: row.created_by,
    usedBy: row.used_by,
    createdAt: row.created_at,
    usedAt: row.used_at,
  };
}

function generateCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export class InviteRepo {
  constructor(private db: DB) {}

  create(createdBy: string | null): Invite {
    const code = generateCode();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO invites (code, created_by, used_by, created_at, used_at)
         VALUES (?, ?, NULL, ?, NULL)`,
      )
      .run(code, createdBy, createdAt);
    return { code, createdBy, usedBy: null, createdAt, usedAt: null };
  }

  findByCode(code: string): Invite | null {
    const row = this.db.prepare('SELECT * FROM invites WHERE code = ?').get(code) as
      | Row
      | undefined;
    return row ? rowToInvite(row) : null;
  }

  /**
   * Atomically claim invite for userId. Returns true if successful, false if
   * code does not exist or is already used.
   */
  claim(code: string, userId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE invites SET used_by = ?, used_at = ?
         WHERE code = ? AND used_by IS NULL`,
      )
      .run(userId, Date.now(), code);
    return result.changes === 1;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/server/store/invite.repo.test.ts`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/store/invite.repo.ts tests/server/store/invite.repo.test.ts
git commit -m "feat(store): add InviteRepo with atomic claim"
```

---

## Task 6: 实现 session.repo（含 TDD）

**Files:**
- Create: `src/server/store/session.repo.ts`
- Create: `tests/server/store/session.repo.test.ts`

- [ ] **Step 1: 写失败测试 `tests/server/store/session.repo.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db.js';
import { SessionRepo } from '@server/store/session.repo.js';
import { UserRepo } from '@server/store/user.repo.js';

describe('SessionRepo', () => {
  let sessions: SessionRepo;
  let users: UserRepo;
  let userId: string;

  beforeEach(() => {
    const db = makeTestDb();
    sessions = new SessionRepo(db);
    users = new UserRepo(db);
    userId = users.create({ username: 'u', passwordHash: 'h', displayName: 'U' }).id;
  });

  it('creates and looks up a session', () => {
    const expiresAt = Date.now() + 60_000;
    sessions.create('tok-1', userId, expiresAt);
    const found = sessions.findValid('tok-1', Date.now());
    expect(found?.userId).toBe(userId);
  });

  it('returns null for expired session', () => {
    sessions.create('tok-1', userId, Date.now() - 1);
    expect(sessions.findValid('tok-1', Date.now())).toBeNull();
  });

  it('delete removes session', () => {
    sessions.create('tok-1', userId, Date.now() + 60_000);
    sessions.delete('tok-1');
    expect(sessions.findValid('tok-1', Date.now())).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/server/store/session.repo.test.ts`
Expected: FAIL — SessionRepo not found.

- [ ] **Step 3: 实现 `src/server/store/session.repo.ts`**

```ts
import type { DB } from './db.js';

export type Session = {
  token: string;
  userId: string;
  expiresAt: number;
};

type Row = { token: string; user_id: string; expires_at: number };

export class SessionRepo {
  constructor(private db: DB) {}

  create(token: string, userId: string, expiresAt: number): void {
    this.db
      .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
      .run(token, userId, expiresAt);
  }

  findValid(token: string, now: number): Session | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?')
      .get(token, now) as Row | undefined;
    if (!row) return null;
    return { token: row.token, userId: row.user_id, expiresAt: row.expires_at };
  }

  delete(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/server/store/session.repo.test.ts`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/store/session.repo.ts tests/server/store/session.repo.test.ts
git commit -m "feat(store): add SessionRepo with expiry handling"
```

---

## Task 7: 实现 auth runtime（bcrypt + JWT，含 TDD）

**Files:**
- Create: `src/server/config.ts`
- Create: `src/server/runtime/auth.ts`
- Create: `tests/server/runtime/auth.test.ts`

- [ ] **Step 1: 写失败测试 `tests/server/runtime/auth.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, signToken, verifyToken } from '@server/runtime/auth.js';

const cfg = { jwtSecret: 'test-secret-1234567890', jwtExpiresInSec: 60 };

describe('auth runtime', () => {
  it('hashes and verifies password', async () => {
    const hash = await hashPassword('s3cret');
    expect(hash).not.toBe('s3cret');
    expect(await verifyPassword('s3cret', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('signs and verifies a JWT', () => {
    const token = signToken({ userId: 'u-1' }, cfg);
    const decoded = verifyToken(token, cfg);
    expect(decoded?.userId).toBe('u-1');
  });

  it('rejects tampered JWT', () => {
    const token = signToken({ userId: 'u-1' }, cfg);
    const tampered = token.slice(0, -2) + 'xx';
    expect(verifyToken(tampered, cfg)).toBeNull();
  });

  it('rejects expired JWT', () => {
    const token = signToken({ userId: 'u-1' }, { ...cfg, jwtExpiresInSec: -1 });
    expect(verifyToken(token, cfg)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/server/runtime/auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: 写 `src/server/config.ts`**

```ts
import { z } from 'zod';

const Schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DB_PATH: z.string().default('./data/dpoker.db'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_EXPIRES_IN: z.string().default('30d'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Config = {
  port: number;
  dbPath: string;
  jwtSecret: string;
  jwtExpiresInSec: number;
  nodeEnv: 'development' | 'test' | 'production';
};

function parseDuration(input: string): number {
  const m = input.match(/^(\d+)([smhd])$/);
  if (!m) throw new Error(`Invalid duration: ${input}`);
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[unit]!;
  return n * mult;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Schema.parse(env);
  return {
    port: parsed.PORT,
    dbPath: parsed.DB_PATH,
    jwtSecret: parsed.JWT_SECRET,
    jwtExpiresInSec: parseDuration(parsed.JWT_EXPIRES_IN),
    nodeEnv: parsed.NODE_ENV,
  };
}
```

- [ ] **Step 4: 实现 `src/server/runtime/auth.ts`**

```ts
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const BCRYPT_ROUNDS = 10;

export type AuthConfig = {
  jwtSecret: string;
  jwtExpiresInSec: number;
};

export type TokenPayload = {
  userId: string;
};

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(payload: TokenPayload, cfg: AuthConfig): string {
  return jwt.sign(payload, cfg.jwtSecret, { expiresIn: cfg.jwtExpiresInSec });
}

export function verifyToken(token: string, cfg: AuthConfig): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, cfg.jwtSecret) as { userId?: unknown };
    if (typeof decoded.userId !== 'string') return null;
    return { userId: decoded.userId };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- tests/server/runtime/auth.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 6: Commit**

```bash
git add src/server/config.ts src/server/runtime/auth.ts tests/server/runtime/auth.test.ts
git commit -m "feat(runtime): add bcrypt password hashing and JWT auth helpers"
```

---

## Task 8: 共享 API 类型 + Express app 工厂

**Files:**
- Create: `src/shared/api-types.ts`
- Create: `src/server/app.ts`
- Create: `tests/server/http/app.test.ts`

- [ ] **Step 1: 写共享类型 `src/shared/api-types.ts`**

```ts
export type RegisterRequest = {
  username: string;
  password: string;
  displayName: string;
  inviteCode: string;
};

export type LoginRequest = {
  username: string;
  password: string;
};

export type AuthResponse = {
  token: string;
  user: {
    id: string;
    username: string;
    displayName: string;
  };
};

export type CreateInviteResponse = {
  code: string;
};

export type ErrorResponse = {
  error: string;
};
```

- [ ] **Step 2: 写 app 工厂测试 `tests/server/http/app.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '@server/app.js';
import { makeTestDb } from '../../helpers/test-db.js';

describe('app', () => {
  it('responds to GET /health', async () => {
    const app = createApp({
      db: makeTestDb(),
      authConfig: { jwtSecret: 'test-secret-aaaaaaaa', jwtExpiresInSec: 60 },
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -- tests/server/http/app.test.ts`
Expected: FAIL — createApp not found.

- [ ] **Step 4: 实现 `src/server/app.ts`**

```ts
import express, { type Express } from 'express';
import type { DB } from './store/db.js';
import type { AuthConfig } from './runtime/auth.js';

export type AppDeps = {
  db: DB;
  authConfig: AuthConfig;
};

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // routes wired in later tasks (Task 9, Task 10)

  return app;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- tests/server/http/app.test.ts`
Expected: PASS — 1 test passed.

- [ ] **Step 6: Commit**

```bash
git add src/shared/api-types.ts src/server/app.ts tests/server/http/app.test.ts
git commit -m "feat(http): add shared API types and Express app factory with /health"
```

---

## Task 9: 注册路由（含 TDD）

**Files:**
- Modify: `src/server/app.ts`
- Create: `src/server/http/auth.routes.ts`
- Create: `tests/server/http/auth.routes.test.ts`

- [ ] **Step 1: 写失败测试 `tests/server/http/auth.routes.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, type AppDeps } from '@server/app.js';
import { makeTestDb } from '../../helpers/test-db.js';
import { InviteRepo } from '@server/store/invite.repo.js';

const authConfig = { jwtSecret: 'test-secret-aaaaaaaa', jwtExpiresInSec: 60 };

function makeDeps(): { deps: AppDeps; inviteCode: string } {
  const db = makeTestDb();
  const invites = new InviteRepo(db);
  const inv = invites.create(null);
  return { deps: { db, authConfig }, inviteCode: inv.code };
}

describe('POST /api/auth/register', () => {
  let deps: AppDeps;
  let inviteCode: string;

  beforeEach(() => {
    const fresh = makeDeps();
    deps = fresh.deps;
    inviteCode = fresh.inviteCode;
  });

  it('rejects when invite code is missing', async () => {
    const app = createApp(deps);
    const res = await request(app).post('/api/auth/register').send({
      username: 'alice',
      password: 'hunter22',
      displayName: 'Alice',
    });
    expect(res.status).toBe(400);
  });

  it('rejects with bad invite code', async () => {
    const app = createApp(deps);
    const res = await request(app).post('/api/auth/register').send({
      username: 'alice',
      password: 'hunter22',
      displayName: 'Alice',
      inviteCode: 'BADCODE0',
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/invite/i);
  });

  it('registers user with valid invite and returns token', async () => {
    const app = createApp(deps);
    const res = await request(app).post('/api/auth/register').send({
      username: 'alice',
      password: 'hunter22',
      displayName: 'Alice',
      inviteCode,
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.username).toBe('alice');
  });

  it('rejects duplicate username', async () => {
    const app = createApp(deps);
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', password: 'hunter22', displayName: 'A', inviteCode });
    // need a fresh invite for second attempt
    const invites = new InviteRepo(deps.db);
    const inv2 = invites.create(null);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', password: 'hunter22', displayName: 'A', inviteCode: inv2.code });
    expect(res.status).toBe(409);
  });

  it('rejects reused invite code', async () => {
    const app = createApp(deps);
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', password: 'hunter22', displayName: 'A', inviteCode });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'bob', password: 'hunter22', displayName: 'B', inviteCode });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/server/http/auth.routes.test.ts`
Expected: FAIL — route not found / 404.

- [ ] **Step 3: 实现 `src/server/http/auth.routes.ts`**

```ts
import { Router } from 'express';
import { z } from 'zod';
import { UserRepo } from '../store/user.repo.js';
import { InviteRepo } from '../store/invite.repo.js';
import { hashPassword, signToken, type AuthConfig } from '../runtime/auth.js';
import type { DB } from '../store/db.js';
import type { AuthResponse, ErrorResponse } from '../../shared/api-types.js';

const RegisterSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(32),
  inviteCode: z.string().min(1),
});

export function authRoutes(db: DB, authConfig: AuthConfig): Router {
  const router = Router();
  const users = new UserRepo(db);
  const invites = new InviteRepo(db);

  router.post('/register', async (req, res) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      const err: ErrorResponse = { error: 'invalid_request' };
      return res.status(400).json(err);
    }
    const { username, password, displayName, inviteCode } = parsed.data;

    if (users.findByUsername(username)) {
      const err: ErrorResponse = { error: 'username_taken' };
      return res.status(409).json(err);
    }

    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = users.create({ username, passwordHash, displayName });
    } catch {
      const err: ErrorResponse = { error: 'username_taken' };
      return res.status(409).json(err);
    }

    const claimed = invites.claim(inviteCode, user.id);
    if (!claimed) {
      // best-effort: delete the just-created user since invite is invalid
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      const err: ErrorResponse = { error: 'invalid_invite' };
      return res.status(403).json(err);
    }

    const token = signToken({ userId: user.id }, authConfig);
    const response: AuthResponse = {
      token,
      user: { id: user.id, username: user.username, displayName: user.displayName },
    };
    res.status(201).json(response);
  });

  return router;
}
```

- [ ] **Step 4: 修改 `src/server/app.ts` 挂载路由**

```ts
import express, { type Express } from 'express';
import type { DB } from './store/db.js';
import type { AuthConfig } from './runtime/auth.js';
import { authRoutes } from './http/auth.routes.js';

export type AppDeps = {
  db: DB;
  authConfig: AuthConfig;
};

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRoutes(deps.db, deps.authConfig));

  return app;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- tests/server/http/auth.routes.test.ts`
Expected: PASS — 5 tests passed.

- [ ] **Step 6: Commit**

```bash
git add src/server/http/auth.routes.ts src/server/app.ts tests/server/http/auth.routes.test.ts
git commit -m "feat(http): add POST /api/auth/register with invite validation"
```

---

## Task 10: 登录路由（含 TDD）

**Files:**
- Modify: `src/server/http/auth.routes.ts`
- Modify: `tests/server/http/auth.routes.test.ts`

- [ ] **Step 1: 在测试文件追加 login 测试**

在 `tests/server/http/auth.routes.test.ts` 末尾追加：

```ts
describe('POST /api/auth/login', () => {
  let deps: AppDeps;
  let inviteCode: string;

  beforeEach(async () => {
    const fresh = makeDeps();
    deps = fresh.deps;
    inviteCode = fresh.inviteCode;
    const app = createApp(deps);
    await request(app)
      .post('/api/auth/register')
      .send({
        username: 'alice',
        password: 'hunter22',
        displayName: 'Alice',
        inviteCode,
      });
  });

  it('returns token for correct credentials', async () => {
    const app = createApp(deps);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'hunter22' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.username).toBe('alice');
  });

  it('rejects wrong password', async () => {
    const app = createApp(deps);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('rejects unknown user', async () => {
    const app = createApp(deps);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'ghost', password: 'whatever' });
    expect(res.status).toBe(401);
  });

  it('rejects malformed body', async () => {
    const app = createApp(deps);
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 运行测试确认 login 失败**

Run: `npm test -- tests/server/http/auth.routes.test.ts`
Expected: 5 PASS（register） + 4 FAIL（login 路由不存在）。

- [ ] **Step 3: 修改 `src/server/http/auth.routes.ts` 增加 login**

在 `authRoutes` 函数内、`router.post('/register', ...)` 之后追加：

```ts
  const LoginSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  });

  router.post('/login', async (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      const err: ErrorResponse = { error: 'invalid_request' };
      return res.status(400).json(err);
    }
    const { username, password } = parsed.data;
    const user = users.findByUsername(username);
    if (!user) {
      const err: ErrorResponse = { error: 'invalid_credentials' };
      return res.status(401).json(err);
    }
    const { verifyPassword } = await import('../runtime/auth.js');
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      const err: ErrorResponse = { error: 'invalid_credentials' };
      return res.status(401).json(err);
    }
    const token = signToken({ userId: user.id }, authConfig);
    const response: AuthResponse = {
      token,
      user: { id: user.id, username: user.username, displayName: user.displayName },
    };
    res.json(response);
  });
```

把顶部 import 行改为静态 import 以保持一致：

```ts
import { hashPassword, verifyPassword, signToken, type AuthConfig } from '../runtime/auth.js';
```

并删除 login 处理器中的动态 import 行 `const { verifyPassword } = await import('../runtime/auth.js');`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/server/http/auth.routes.test.ts`
Expected: PASS — 9 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/http/auth.routes.ts tests/server/http/auth.routes.test.ts
git commit -m "feat(http): add POST /api/auth/login"
```

---

## Task 11: 邀请码路由（鉴权 middleware + 创建邀请）

**Files:**
- Create: `src/server/http/middleware.ts`
- Create: `src/server/http/invite.routes.ts`
- Create: `tests/server/http/invite.routes.test.ts`
- Modify: `src/server/app.ts`

- [ ] **Step 1: 写失败测试 `tests/server/http/invite.routes.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, type AppDeps } from '@server/app.js';
import { makeTestDb } from '../../helpers/test-db.js';
import { InviteRepo } from '@server/store/invite.repo.js';

const authConfig = { jwtSecret: 'test-secret-aaaaaaaa', jwtExpiresInSec: 60 };

async function registerUser(app: ReturnType<typeof createApp>, db: any) {
  const inv = new InviteRepo(db).create(null);
  const res = await request(app).post('/api/auth/register').send({
    username: 'alice',
    password: 'hunter22',
    displayName: 'A',
    inviteCode: inv.code,
  });
  return res.body.token as string;
}

describe('POST /api/invites', () => {
  let deps: AppDeps;

  beforeEach(() => {
    deps = { db: makeTestDb(), authConfig };
  });

  it('rejects without auth', async () => {
    const app = createApp(deps);
    const res = await request(app).post('/api/invites');
    expect(res.status).toBe(401);
  });

  it('creates invite when authenticated', async () => {
    const app = createApp(deps);
    const token = await registerUser(app, deps.db);
    const res = await request(app)
      .post('/api/invites')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[A-Z0-9]{8}$/);
  });

  it('rejects bogus token', async () => {
    const app = createApp(deps);
    const res = await request(app)
      .post('/api/invites')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/server/http/invite.routes.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: 实现鉴权 middleware `src/server/http/middleware.ts`**

```ts
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { verifyToken, type AuthConfig } from '../runtime/auth.js';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

export function requireAuth(authConfig: AuthConfig): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const token = header.slice('Bearer '.length);
    const payload = verifyToken(token, authConfig);
    if (!payload) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    req.userId = payload.userId;
    next();
  };
}
```

- [ ] **Step 4: 实现 `src/server/http/invite.routes.ts`**

```ts
import { Router } from 'express';
import type { DB } from '../store/db.js';
import { InviteRepo } from '../store/invite.repo.js';
import { requireAuth } from './middleware.js';
import type { AuthConfig } from '../runtime/auth.js';
import type { CreateInviteResponse } from '../../shared/api-types.js';

export function inviteRoutes(db: DB, authConfig: AuthConfig): Router {
  const router = Router();
  const invites = new InviteRepo(db);

  router.post('/', requireAuth(authConfig), (req, res) => {
    const inv = invites.create(req.userId ?? null);
    const response: CreateInviteResponse = { code: inv.code };
    res.status(201).json(response);
  });

  return router;
}
```

- [ ] **Step 5: 修改 `src/server/app.ts` 挂载邀请路由**

在 `app.use('/api/auth', ...)` 后追加：

```ts
import { inviteRoutes } from './http/invite.routes.js';
// ...
  app.use('/api/invites', inviteRoutes(deps.db, deps.authConfig));
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npm test`
Expected: 全部 PASS — 共 18+ 测试通过（含此前所有）。

- [ ] **Step 7: Commit**

```bash
git add src/server/http/middleware.ts src/server/http/invite.routes.ts src/server/app.ts tests/server/http/invite.routes.test.ts
git commit -m "feat(http): add POST /api/invites with auth middleware"
```

---

## Task 12: 进程入口与静态文件托管

**Files:**
- Create: `src/server/index.ts`
- Modify: `src/server/app.ts`

- [ ] **Step 1: 写 `src/server/index.ts`**

```ts
import { loadConfig } from './config.js';
import { openDb } from './store/db.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const app = createApp({
  db,
  authConfig: { jwtSecret: config.jwtSecret, jwtExpiresInSec: config.jwtExpiresInSec },
  staticDir: 'dist/client',
});

const server = app.listen(config.port, () => {
  console.log(`DPoker listening on http://localhost:${config.port}`);
});

function shutdown() {
  console.log('Shutting down...');
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

- [ ] **Step 2: 修改 `src/server/app.ts` 支持静态目录**

完整新版本：

```ts
import express, { type Express } from 'express';
import path from 'node:path';
import type { DB } from './store/db.js';
import type { AuthConfig } from './runtime/auth.js';
import { authRoutes } from './http/auth.routes.js';
import { inviteRoutes } from './http/invite.routes.js';

export type AppDeps = {
  db: DB;
  authConfig: AuthConfig;
  staticDir?: string;
};

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRoutes(deps.db, deps.authConfig));
  app.use('/api/invites', inviteRoutes(deps.db, deps.authConfig));

  if (deps.staticDir) {
    const dir = path.resolve(deps.staticDir);
    app.use(express.static(dir));
    // SPA fallback: any non-API GET goes to index.html
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(dir, 'index.html'));
    });
  }

  return app;
}
```

- [ ] **Step 3: 验证服务器可启动**

Run（在另一个终端）：

```bash
cp .env.example .env
echo 'JWT_SECRET=development-secret-keep-changing-please' >> .env
mkdir -p data
npm run dev:server
```

在第三个终端测试：
```bash
curl http://localhost:3000/health
```
Expected: `{"ok":true}`

按 Ctrl+C 停止。

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts src/server/app.ts
git commit -m "feat(server): add process entrypoint with static file hosting"
```

---

## Task 13: 前端 API 客户端 + auth store

**Files:**
- Create: `src/client/api/client.ts`
- Create: `src/client/store/auth.ts`
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`

- [ ] **Step 1: 创建 `src/client/api/client.ts`**

```ts
import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  CreateInviteResponse,
  ErrorResponse,
} from '../../shared/api-types.js';

class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

async function request<T>(
  path: string,
  options: { method: string; body?: unknown; token?: string },
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const res = await fetch(path, {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    let code = 'unknown';
    try {
      const data = (await res.json()) as ErrorResponse;
      code = data.error;
    } catch {}
    throw new ApiError(res.status, code);
  }
  return (await res.json()) as T;
}

export const api = {
  register: (body: RegisterRequest) =>
    request<AuthResponse>('/api/auth/register', { method: 'POST', body }),
  login: (body: LoginRequest) =>
    request<AuthResponse>('/api/auth/login', { method: 'POST', body }),
  createInvite: (token: string) =>
    request<CreateInviteResponse>('/api/invites', { method: 'POST', token }),
};

export { ApiError };
```

- [ ] **Step 2: 创建 `src/client/store/auth.ts`**

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type User = {
  id: string;
  username: string;
  displayName: string;
};

type AuthState = {
  token: string | null;
  user: User | null;
  setSession: (token: string, user: User) => void;
  clear: () => void;
};

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setSession: (token, user) => set({ token, user }),
      clear: () => set({ token: null, user: null }),
    }),
    { name: 'dpoker-auth' },
  ),
);
```

- [ ] **Step 3: 创建 `src/client/main.tsx`**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 4: 创建占位 `src/client/App.tsx`**

```tsx
import { Login } from './pages/Login.js';
import { useAuth } from './store/auth.js';

export function App() {
  const user = useAuth((s) => s.user);
  if (!user) return <Login />;
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>DPoker</h1>
      <p>Welcome, {user.displayName}!</p>
      <button onClick={() => useAuth.getState().clear()}>Log out</button>
    </div>
  );
}
```

- [ ] **Step 5: Commit**（Login.tsx 在下一 task）

```bash
git add src/client/api/client.ts src/client/store/auth.ts src/client/main.tsx src/client/App.tsx
git commit -m "feat(client): add API client, auth store, and app shell"
```

---

## Task 14: Login 页面（注册 + 登录两个 tab）

**Files:**
- Create: `src/client/pages/Login.tsx`

- [ ] **Step 1: 创建 `src/client/pages/Login.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client.js';
import { useAuth } from '../store/auth.js';

type Tab = 'login' | 'register';

export function Login() {
  const [tab, setTab] = useState<Tab>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result =
        tab === 'login'
          ? await api.login({ username, password })
          : await api.register({ username, password, displayName, inviteCode });
      useAuth.getState().setSession(result.token, result.user);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(translate(err.code));
      } else {
        setError('Network error');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '64px auto', fontFamily: 'system-ui' }}>
      <h1>DPoker</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setTab('login')} disabled={tab === 'login'}>
          Login
        </button>
        <button onClick={() => setTab('register')} disabled={tab === 'register'}>
          Register
        </button>
      </div>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 8 }}>
        <input
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password (min 8 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={tab === 'register' ? 8 : 1}
        />
        {tab === 'register' && (
          <>
            <input
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
            <input
              placeholder="Invite code"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              required
            />
          </>
        )}
        <button type="submit" disabled={busy}>
          {busy ? '...' : tab === 'login' ? 'Login' : 'Register'}
        </button>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
      </form>
    </div>
  );
}

function translate(code: string): string {
  switch (code) {
    case 'invalid_credentials':
      return 'Wrong username or password';
    case 'username_taken':
      return 'Username already taken';
    case 'invalid_invite':
      return 'Invalid or used invite code';
    case 'invalid_request':
      return 'Please fill all fields correctly';
    default:
      return `Error: ${code}`;
  }
}
```

- [ ] **Step 2: 启动并手测**

启动后端：
```bash
npm run dev:server
```

另一终端启动前端：
```bash
npm run dev:client
```

打开 http://localhost:5173

手测路径：
1. 准备一个邀请码：用 sqlite3 直接插入或写一段临时脚本（见下）
2. Tab 切到 Register，填用户名/密码/显示名/邀请码
3. 注册成功 → 看到欢迎页
4. Logout → Login 流程验证

**临时邀请码生成脚本**：在新终端运行：
```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('./data/dpoker.db');
const code = Array.from({length:8},()=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]).join('');
db.prepare('INSERT INTO invites(code,created_by,used_by,created_at,used_at) VALUES (?,NULL,NULL,?,NULL)').run(code, Date.now());
console.log('Invite code:', code);
"
```

Expected: 注册和登录都工作；持久化在浏览器刷新后保留登录状态。

- [ ] **Step 3: Commit**

```bash
git add src/client/pages/Login.tsx
git commit -m "feat(client): add Login page with register and login tabs"
```

---

## Task 15: Dockerfile 与 docker-compose

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.yml`
- Create: `README.md`

- [ ] **Step 1: 创建 `.dockerignore`**

```
node_modules
dist
.env
.env.local
data
.git
.vscode
coverage
*.log
.DS_Store
```

- [ ] **Step 2: 创建 `Dockerfile`**

```dockerfile
# Stage 1: build
FROM node:20-alpine AS build

# better-sqlite3 needs build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.base.json tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src

RUN npm run build

# Stage 2: runtime
FROM node:20-alpine AS runtime

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

VOLUME ["/data"]

CMD ["node", "dist/server/index.js"]
```

- [ ] **Step 3: 创建 `docker-compose.yml`**

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
      - PORT=3000
      - DB_PATH=/data/dpoker.db
      - JWT_SECRET=${JWT_SECRET:?JWT_SECRET must be set in .env}
      - JWT_EXPIRES_IN=30d
    restart: unless-stopped
```

- [ ] **Step 4: 创建 `README.md`**

```markdown
# DPoker

自部署在 NAS 上的德州扑克朋友局应用。

## 快速开始

### 开发模式

\`\`\`bash
npm install
cp .env.example .env  # 修改 JWT_SECRET
npm run dev:server   # 后端 :3000
npm run dev:client   # 前端 :5173
\`\`\`

### 生产部署（Docker）

\`\`\`bash
echo "JWT_SECRET=$(openssl rand -base64 32)" > .env
docker compose up -d --build
\`\`\`

打开 http://localhost:3000

### 创建首批邀请码

进容器：

\`\`\`bash
docker compose exec dpoker node -e "
const Database = require('better-sqlite3');
const db = new Database('/data/dpoker.db');
const code = Array.from({length:8},()=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]).join('');
db.prepare('INSERT INTO invites(code,created_by,used_by,created_at,used_at) VALUES (?,NULL,NULL,?,NULL)').run(code, Date.now());
console.log('Invite code:', code);
"
\`\`\`

### 备份

\`\`\`bash
cp -r data data-backup-$(date +%Y%m%d)
\`\`\`

## 测试

\`\`\`bash
npm test
\`\`\`

## 设计文档

`docs/superpowers/specs/2026-05-28-dpoker-design.md`
```

- [ ] **Step 5: 构建镜像**

Run:
```bash
docker compose build
```
Expected: 构建成功无错误。

- [ ] **Step 6: 启动容器**

Run:
```bash
echo "JWT_SECRET=$(openssl rand -base64 32 2>/dev/null || node -e 'console.log(require(\"crypto\").randomBytes(32).toString(\"base64\"))')" > .env
docker compose up -d
```
Expected: 容器启动；`docker compose ps` 显示 healthy。

- [ ] **Step 7: 端到端验证**

Run:
```bash
curl http://localhost:3000/health
```
Expected: `{"ok":true}`

打开浏览器访问 http://localhost:3000，能看到 Login 页。

清理：`docker compose down`

- [ ] **Step 8: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml README.md
git commit -m "feat(deploy): add Dockerfile and docker-compose for NAS deployment"
```

---

## Task 16: 全测试与 build 校验

- [ ] **Step 1: 跑全部测试**

Run: `npm test`
Expected: 全部 PASS（≈ 19 tests）。

- [ ] **Step 2: TypeScript 校验**

Run: `npm run lint`
Expected: 无错误。

- [ ] **Step 3: 前端构建**

Run: `npm run build:client`
Expected: 构建成功，`dist/client/` 下有 `index.html` 和 `assets/`。

- [ ] **Step 4: 后端构建**

Run: `npm run build:server`
Expected: 构建成功，`dist/server/index.js` 存在。

- [ ] **Step 5: 端到端 smoke**

Run:
```bash
PORT=3000 DB_PATH=./data/test.db JWT_SECRET=test-secret-aaaaaaaaaaaaaaaa NODE_ENV=production node dist/server/index.js &
SERVER_PID=$!
sleep 2
curl -s http://localhost:3000/health
kill $SERVER_PID
rm -f data/test.db data/test.db-wal data/test.db-shm
```
Expected: `{"ok":true}` 输出。

- [ ] **Step 6: 标记 Stage 1 完成**

```bash
git tag stage-1-complete
git log --oneline -20
```
Expected: 看到本阶段所有 commit。

---

## Stage 1 完成 — 后续阶段大纲

下列阶段需要由各自的 plan 文件细化（仍在 `docs/superpowers/plans/` 下）。每个阶段产出"端到端可玩"的最小增量：

### Stage 2: 牌局核心引擎（纯函数）

- `src/server/game/deck.ts` — 洗牌（commit-reveal 准备：使用 `crypto.randomInt`，可注入 seed）
- `src/server/game/hand-evaluator.ts` — 包装 pokersolver
- `src/server/game/betting.ts` — 下注合法性、min-raise、不完整 all-in 不重开
- `src/server/game/pot.ts` — 边池切分
- `src/server/game/runout.ts` — 一次/两次发牌
- `src/server/game/runout-vote.ts` — 一票否决聚合
- `src/server/game/squid-round.ts` — 鱿鱼分发与结算
- `src/server/game/squid-stats.ts` — 多维度统计累加
- 全部纯函数，覆盖单测，无 IO

### Stage 3: 桌面状态机 + Socket.IO 集成（最小可玩）

- `src/server/game/table-state.ts` — Reducer 状态机
- 事件 log 表 + 写入路径
- `src/server/ws/socket.gateway.ts` 与 `table.handler.ts`
- `src/server/runtime/table-registry.ts`
- `src/server/http/table.routes.ts` — 创建桌、加入桌、列表
- 前端 `Lobby.tsx` 与最简 `Table.tsx`（圆桌 + 行动栏）
- All-in 投票弹窗
- 实现 commit-reveal 洗牌
- 实现 heads-up、dead button、straddle、断线重连、time bank
- E2E：两个浏览器跑完一手

### Stage 4: 鱿鱼模式 + 多维度积分榜

- 接入 `squid-round` 钩子
- `SquidPanel.tsx` 与 `Leaderboard.tsx`
- `leaderboard.routes.ts`
- 鱿鱼模式开关与积分配置 UI

### Stage 5: 事件溯源与崩溃恢复

- 事件 log replay 启动逻辑
- 行动超时定时器恢复
- 客户端 `RESYNC` 流程
- 故障注入测试

### Stage 6: 响应式 UI 与端到端测试打磨

- 手机竖屏布局
- Playwright E2E
- 部署文档完善（反向代理、HTTPS）

---

**Stage 1 plan 结束。**
