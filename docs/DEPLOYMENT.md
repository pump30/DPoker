# DPoker 生产部署

本方案让 DPoker 仅监听服务器的 `127.0.0.1`，由同一 Compose 网络中的
Cloudflare Tunnel 发布到自定义域名。SQLite 数据保存在 Docker 命名卷中；应用以
非 root 用户运行，根文件系统只读。仓库不保存 JWT 密钥、Tunnel 凭据或实际域名。

## 1. 服务器准备

需要 Linux 服务器、Git、Docker Engine 和 Docker Compose v2。克隆仓库后进入项目目录：

```bash
git clone <REPOSITORY_URL> dpoker
cd dpoker
cp .env.example .env
JWT_SECRET=$(openssl rand -hex 32)
sed -i "s|REPLACE_ME_RUN_OPENSSL_RAND_HEX_32_THIS_VALUE_IS_NOT_SECURE|${JWT_SECRET}|" .env
unset JWT_SECRET
chmod 600 .env
```

`.env` 已被 Git 忽略。不要提交或发送它。`JWT_SECRET` 一旦投入使用便应保持稳定；
更换它会让现有登录令牌失效。

## 2. 先启动并验证应用

```bash
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
curl --fail --silent http://127.0.0.1:3000/health
```

最后一条应返回 `{"ok":true}`，`docker compose ps` 应显示 `healthy`。默认仅在
`127.0.0.1:3000` 监听；如果服务器本机端口冲突，可在 `.env` 修改 `HOST_PORT`。
不要为 Tunnel 把 `BIND_ADDRESS` 改成 `0.0.0.0`。

## 3. 创建 Cloudflare Tunnel

以下步骤需在 Cloudflare 控制台完成，仓库不预填域名或凭据：

1. 在 Zero Trust → Networks → Tunnels 创建一个 Cloudflared Tunnel。
2. 下载该 Tunnel 的 credentials JSON，保存为
   `deploy/cloudflared/credentials.json`，执行 `chmod 600`。
3. 复制模板并填写控制台显示的 Tunnel UUID 和自己的完整域名：

   ```bash
   cp deploy/cloudflared/config.yml.example deploy/cloudflared/config.yml
   sudo chown 65532:65532 deploy/cloudflared/config.yml deploy/cloudflared/credentials.json
   chmod 600 deploy/cloudflared/config.yml deploy/cloudflared/credentials.json
   ```

4. 在 Cloudflare DNS 为该域名创建 CNAME，目标为
   `<TUNNEL_UUID>.cfargotunnel.com`，并启用代理。也可用控制台 Tunnel 的 Public
   Hostname 页面完成同一映射。
5. 检查模板中 `service: http://dpoker:3000` 不变，然后启动：

   ```bash
   docker compose -f docker-compose.yml \
     -f deploy/cloudflared/docker-compose.tunnel.yml config --quiet
   docker compose -f docker-compose.yml \
     -f deploy/cloudflared/docker-compose.tunnel.yml up -d --build --wait
   docker compose -f docker-compose.yml \
     -f deploy/cloudflared/docker-compose.tunnel.yml ps
   ```

   正式环境建议把 `.env` 中的 `CLOUDFLARED_IMAGE` 改为已验证的版本标签或
   镜像 digest，避免 `latest` 在下次部署时静默变化。

浏览 `https://<自己的域名>/health`，应看到 `{"ok":true}`。无需开放 3000 入站端口；
服务器只需允许 Cloudflared 的出站 HTTPS/QUIC 流量。

## 4. 数据、备份与恢复

数据卷名默认为 `dpoker-data`。SQLite 使用 WAL，在线备份必须使用 SQLite backup
API，不能只复制单个 `.db` 文件。

```bash
mkdir -p backups
docker compose exec -T dpoker node -e \
  "const D=require('better-sqlite3');const s=new D('/data/dpoker.db');s.backup('/data/backup.db').then(()=>s.close())"
docker compose cp dpoker:/data/backup.db ./backups/dpoker-$(date +%Y%m%d-%H%M%S).db
docker compose exec -T dpoker rm /data/backup.db
```

将 `backups/` 复制到另一台机器或受控备份存储。恢复前停机，并先备份当前卷：

```bash
docker compose down
docker run --rm -v dpoker-data:/data -v "${PWD}/backups:/backup:ro" alpine \
  sh -c 'cp /backup/<BACKUP_FILE>.db /data/dpoker.db && chown 1000:1000 /data/dpoker.db'
docker compose up -d --wait
```

`docker compose down` 不删除命名卷；不要使用 `down -v`，除非明确要清空数据。

## 5. 升级和回滚

升级前先备份，然后：

```bash
git pull --ff-only
docker compose -f docker-compose.yml \
  -f deploy/cloudflared/docker-compose.tunnel.yml up -d --build --wait
docker compose ps
```

回滚应用代码时，检出已知可用的 Git 提交并重新构建。数据库迁移会自动执行；若新版本
包含不可逆迁移，应用回滚前同时恢复对应备份。查看故障信息：

```bash
docker compose logs --tail=200 dpoker cloudflared
docker inspect --format '{{json .State.Health}}' dpoker
```

## 6. 安全检查清单

- `.env`、`config.yml`、`credentials.json` 权限为 `600` 且未被 Git 跟踪。
- `JWT_SECRET` 至少 32 字符且不是示例占位符。
- 服务器防火墙未对公网开放 3000；Cloudflare TLS 模式为 Full (strict)。
- `docker compose ps` 中 DPoker 为 `healthy`，两个服务均设置自动重启。
- 备份在另一处存储，并至少实际恢复验证过一次。
