# Render 免费版 Docker 部署

这套配置部署 Flask 后端，前端继续使用 GitHub Pages。Render 自动提供 HTTPS，SQLite、FAISS 索引和上传文件使用容器内的临时目录。

## 1. 将部署配置推送到 GitHub

Render 从 `GTliangming/sensor-agent` 仓库的 `main` 分支构建。需要先提交并推送以下配置：

- `render.yaml`：免费 Docker Web Service、健康检查、跨域和环境变量。
- `backend/Dockerfile`、`.dockerignore`：Python 3.12 镜像，排除密钥、本地虚拟环境和数据。
- `backend/gunicorn.conf.py`：监听平台 `PORT`，1 个 worker、4 个线程。
- `backend/requirements.txt`：包含 Gunicorn。

FAISS 索引只在单个进程内同步，暂时不要增加 worker 数量或服务实例数。无需启动 Milvus、Redis，也不需要 GPU；向量化和问答调用远程 API。

## 2. 在 Render 创建服务

1. 登录 [Render 控制台](https://dashboard.render.com/)，授权连接上述 GitHub 仓库。
2. 选择 **New → Blueprint**，选择仓库和 `main` 分支。Render 会读取根目录的 `render.yaml`。
3. 确认服务名 `sensor-agent-api`，套餐为 **Free**，没有付费磁盘或其他服务。
4. 在要求填写的环境变量中填入 `DEEPSEEK_API_KEY` 和 `SILICONFLOW_API_KEY`，分别使用你的真实密钥。密钥只填在 Render，不提交进 Git。
5. 创建服务并查看构建日志。首次构建会下载 Python 依赖，完成后应显示 Gunicorn 启动且服务为 Live。

如果选择 **New → Web Service** 手动创建，配置如下：

| 设置 | 值 |
|---|---|
| Branch | `main` |
| Language / Runtime | Docker |
| Root Directory | 留空 |
| Dockerfile Path | `backend/Dockerfile` |
| Docker Build Context Directory | `backend` |
| Docker Command | 留空，使用镜像默认命令 |
| Instance Type | Free |
| Health Check Path | `/api/health` |

手动创建时还需添加 `render.yaml` 中的环境变量。`CORS_ORIGINS=https://gtliangming.github.io`，不包含 `/sensor-agent/` 路径。`DEEPSEEK_MODEL` 保持 `deepseek-flash`。

## 3. 验证后端

复制 Render 给出的实际地址，例如 `https://sensor-agent-api-xxxx.onrender.com`。以控制台地址为准，服务名不保证对应同名域名。

访问 `https://实际地址/api/health`，正常返回：

```json
{"status": "ok"}
```

在终端验证跨域预检（替换地址）：

```bash
curl -i -X OPTIONS 'https://实际地址/api/chat' \
  -H 'Origin: https://gtliangming.github.io' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

响应应包含 `Access-Control-Allow-Origin: https://gtliangming.github.io`。健康检查成功只能证明应用启动，上传和问答还需实际验证两个外部 API 的密钥及网络连通性。

## 4. 让 GitHub Pages 调用后端

在 `frontend/` 将 `.env.production.example` 复制为 `.env.production`，填写实际 HTTPS 地址：

```dotenv
VITE_API_BASE=https://实际服务地址.onrender.com
```

地址不要带 `/api`，也不要带末尾 `/`。聊天、上传、列表、删除和进度流都会使用这个地址。

在 `frontend/` 执行：

```bash
npm run deploy
```

该命令重新构建并推送 `gh-pages`，等待 GitHub Pages 发布完成后，打开 `https://gtliangming.github.io/sensor-agent/`。`VITE_API_BASE` 是构建时配置，只在 Render 设置它不会改变已发布前端。

依次验证：查看文档列表、上传一份小文档、进度到 done、提问并看到流式回答、确认删除。浏览器 Network 中请求应指向 Render 的 HTTPS 域名。

## 5. 免费版的行为

- 闲置约 15 分钟后休眠，下次访问可能需要约一分钟唤醒。先打开健康检查地址并等到正常，再刷新前端。
- 重启、重新部署或休眠会清掉运行时文件，包括 SQLite、FAISS 和上传文件；需要重新上传。部署不会迁移本机资料。
- 512 MB 内存适合先用小文件验证。当前代码会把 Excel 加载到内存，配置允许 100 MB 上传并不代表免费实例能处理同等大小的文件；若内存不足，可先在 Render 设置较小的 `MAX_UPLOAD_MB`。
- 目前尚未加入账号认证，知道后端地址的人可以调用文档接口。因此先使用可公开的测试资料，不上传需要保密的文档。
- Render 免费额度与 DeepSeek、SiliconFlow API 计费相互独立。
- 上传处理中重启可能中断后台线程，先等处理结束再手动部署。

## 6. 本地 Docker 验证（可选）

安装 Docker 后，在仓库根目录执行：

```bash
docker build -t sensor-agent-backend ./backend
docker run --rm -p 10000:10000 \
  --env-file backend/.env \
  -e PORT=10000 -e FLASK_DEBUG=0 \
  -e CORS_ORIGINS=https://gtliangming.github.io \
  sensor-agent-backend
```

本地 `.env` 通过运行时参数注入，不会打进镜像。该命令不挂载磁盘，停止并删除容器后数据丢失。访问 `http://127.0.0.1:10000/api/health` 验证启动。

后续改用有持久磁盘的环境时，把数据卷挂在 `/app/data`；也可以设置 `DATA_DIR` 为其他可写的挂载目录。

官方参考：[Docker 部署](https://render.com/docs/docker)、[Blueprint 配置](https://render.com/docs/blueprint-spec)、[免费版限制](https://render.com/docs/free)。
