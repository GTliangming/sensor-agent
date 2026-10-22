
.PHONY: dev agent server web up down logs go-test agent-test web-build

# 本地开发：分别在三个终端执行 make agent / make server / make web
agent:
	cd agent-python && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

server:
	cd backend-go && go run ./cmd/server

web:
	cd web && npm run dev

# 测试
go-test:
	cd backend-go && go test ./...

agent-test:
	cd agent-python && uv run pytest

web-build:
	cd web && npm run build

# Docker 部署命令暂时保留，不作为日常启动方式
up:
	docker compose --env-file .env -f deploy/docker-compose.yml up --build

down:
	docker compose --env-file .env -f deploy/docker-compose.yml down

logs:
	docker compose --env-file .env -f deploy/docker-compose.yml logs -f --tail=200
