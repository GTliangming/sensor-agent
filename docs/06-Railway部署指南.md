# Railway Docker 部署

后端部署到 Railway，前端继续使用 GitHub Pages。Railway 自动提供 HTTPS，Gunicorn 使用平台注入的 `PORT`，只启动 1 个 worker 和 4 个线程。

这版先验证公网部署，默认不挂载数据卷。SQLite、FAISS 索引和上传文件位于 `/app/data`，容器被替换或重新部署后需要重新上传资料。

## 1. 创建 GitHub 服务

1. 登录 [Railway](https://railway.com/)，连接 GitHub，并确认账号获得完整试用网络权限。受限试用可能无法调用 DeepSeek、SiliconFlow。
2. 选择 **New Project → Deploy from GitHub repo**，选择 `GTliangming/sensor-agent`。
3. 打开新建服务的 **Settings → Source**，确认分支为 `main`，将 **Root Directory 设置为 `/backend`**。
4. Railway 会在该目录自动识别 `Dockerfile`，构建上下文也是 `backend/`。若首次自动部署在设置根目录前已失败，配置完成后重新部署即可。

不要把 Root Directory 留空：仓库根目录同时包含前后端，后端镜像中的 `COPY requirements.txt` 需要以 `backend/` 为构建上下文。

## 2. 配置服务

| 设置 | 值 |
|---|---|
| Source Branch | `main` |
| Root Directory | `/backend` |
| Builder | Dockerfile（自动识别） |
| Dockerfile | `Dockerfile`，相对于 `/backend` |
| Build Command | 留空，使用 Dockerfile |
| Start Command | 留空，使用 Dockerfile 的 CMD |
| Healthcheck Path | `/api/health` |
| Healthcheck Timeout | `120` 秒 |
| Replicas | `1` |
| Restart Policy | On Failure，最多 3 次重试（如界面提供该选项） |

FAISS 的锁只能协调单个进程，不要增加 Gunicorn workers、replicas 或多区域副本。无需添加数据库服务、Redis、Milvus或 GPU。

本项目使用 Railway 的 Dockerfile 自动检测与控制台设置。官方已弃用新服务的 `railway.json` / `railway.toml` Config as Code，所以不添加这些文件；若以后要用 CLI 管理项目，可采用新的 Infrastructure as Code。

## 3. 填写环境变量

打开服务 **Variables → Raw Editor**，粘贴 `backend/.env.railway.example` 的内容，替换两个密钥占位符。也可以逐项添加：

| Key | Value |
|---|---|
| `DEEPSEEK_API_KEY` | 本地 `.env` 中的真实 DeepSeek 密钥 |
| `SILICONFLOW_API_KEY` | 本地 `.env` 中的真实 SiliconFlow 密钥 |
| `DEEPSEEK_MODEL` | `deepseek-flash` |
| `CORS_ORIGINS` | `https://gtliangming.github.io` |
| `FLASK_DEBUG` | `0` |
| `DATA_DIR` | `/app/data` |
| `EMBEDDING_MODEL` | `BAAI/bge-m3` |
| `EMBEDDING_DIM` | `1024` |

- 密钥只填在 Railway，不提交到 Git，也不要发到聊天中。
- `CORS_ORIGINS` 不包含 `/sensor-agent/` 路径。
- 无需手动设置 `PORT`。Railway 注入的值会覆盖 Docker 的本地默认值 `8080`，Gunicorn 会监听 `0.0.0.0:$PORT`。
- 不需要填 `RAILWAY_DOCKERFILE_PATH`；设置 `/backend` 后已经能检测到 `Dockerfile`。
- 不要直接导入整个本地 `.env`，避免把本地端口、debug 和本地 CORS 配置带到线上。

保存并应用更改，等待构建和部署成功。构建日志应提示正在使用 Dockerfile，部署日志应显示 Gunicorn 使用 `gthread`，监听平台端口。

## 4. 生成公网域名并验证

打开 **Settings → Networking → Public Networking → Generate Domain**。目标端口使用实际 `PORT`；如果界面需要固定目标端口且没有自动识别，可以显式添加 `PORT=8080` 并将目标端口设为 `8080`，重新部署。

复制平台实际分配的 `https://….up.railway.app` 地址，访问：

```text
https://实际服务域名.up.railway.app/api/health
```

正常返回：

```json
{"status": "ok"}
```

再验证跨域预检：

```bash
curl -i -X OPTIONS 'https://实际服务域名.up.railway.app/api/chat' \
  -H 'Origin: https://gtliangming.github.io' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

响应应包含 `Access-Control-Allow-Origin: https://gtliangming.github.io`。健康检查成功只能证明应用启动，外部 API 的密钥和网络权限还需要通过实际上传、问答验证。

## 5. 更新 GitHub Pages 前端

把 `frontend/.env.production.example` 复制为 `frontend/.env.production`，将其中地址替换为实际 Railway HTTPS 地址：

```dotenv
VITE_API_BASE=https://实际服务域名.up.railway.app
```

不包含 `/api`，不加末尾 `/`。在 `frontend/` 执行：

```bash
npm run deploy
```

等待 GitHub Pages 发布完成，再打开 `https://gtliangming.github.io/sensor-agent/`。`VITE_API_BASE` 是前端构建时的配置，只在 Railway 添加它不会改变已经发布的前端。

验收顺序：查看列表 → 上传小文档 → 处理到 done → 提问并收到流式回答 → 确认删除。浏览器 Network 中请求应指向 Railway 的 HTTPS 地址。

## 6. 额度与数据限制

- 当前官方规则：新账号 30 天、5 美元试用额度，用完或到期后转为每月 1 美元免费额度。额度不够维持整月时，服务可能暂停；以控制台的实际套餐和用量为准。
- 试用账号的 GitHub 验证决定完整／受限出站网络权限，受限账号可能无法访问模型 API。
- 本配置不创建付费附加服务、不挂载数据卷。运行服务仍消耗额度，DeepSeek、SiliconFlow 的 API 费用另外计算。
- 不挂载持久卷时，不应依赖容器文件跨重新部署保留；本机数据不会自动迁移。
- 先用小文档验证。免费资源内存有限，大 Excel 会整本加载，允许上传 100 MB 不代表服务有足够内存处理它；必要时设置更小的 `MAX_UPLOAD_MB`。
- 上传处理在后台线程中运行，处理完成前不要手动重启或部署。
- 当前没有账号认证，先使用可公开测试资料。

如果后续需要保留数据，可以单独设计 Railway Volume 的挂载和权限。镜像使用 UID 10001 的非 root 用户，新挂载卷需要对该用户可写；不要未检查权限就挂载 `/app/data`。

## 7. 本地 Docker 验证（可选）

在仓库根目录执行：

```bash
docker build -t sensor-agent-backend ./backend
docker run --rm -p 8080:8080 \
  --env-file backend/.env \
  -e PORT=8080 -e FLASK_DEBUG=0 \
  -e CORS_ORIGINS=https://gtliangming.github.io \
  sensor-agent-backend
```

访问 `http://127.0.0.1:8080/api/health`。真实 `.env`、本地 `data/` 和虚拟环境被 `.dockerignore` 排除，不会打入镜像。这个验证命令不挂载卷，删除容器后数据丢失。

官方参考：[Dockerfiles](https://docs.railway.com/guides/dockerfiles)、[Monorepo](https://docs.railway.com/guides/monorepo)、[免费试用](https://docs.railway.com/pricing/free-trial)、[Infrastructure as Code](https://docs.railway.com/infrastructure-as-code)。
