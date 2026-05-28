# DPoker

自部署在 NAS 上的德州扑克朋友局应用。

## 快速开始

### 开发模式

```bash
npm install
cp .env.example .env  # IMPORTANT: edit JWT_SECRET — do not use the placeholder
npm run dev:server   # 后端 :3000
npm run dev:client   # 前端 :5173
```

### 生产部署（Docker）

```bash
echo "JWT_SECRET=$(openssl rand -base64 32)" > .env
docker compose up -d --build
```

打开 http://localhost:3000

### 创建首批邀请码

进容器：

```bash
docker compose exec dpoker node -e "
const Database = require('better-sqlite3');
const db = new Database('/data/dpoker.db');
const code = Array.from({length:8},()=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random()*32)]).join('');
db.prepare('INSERT INTO invites(code,created_by,used_by,created_at,used_at) VALUES (?,NULL,NULL,?,NULL)').run(code, Date.now());
console.log('Invite code:', code);
"
```

### 备份

```bash
cp -r data data-backup-$(date +%Y%m%d)
```

## 测试

```bash
npm test
```

## 设计文档

`docs/superpowers/specs/2026-05-28-dpoker-design.md`
