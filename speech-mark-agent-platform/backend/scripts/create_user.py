"""命令行脚本：创建 Agent 平台用户，可选同时绑定 Go 标注平台账号。

因为还没有注册接口，初始用户（尤其管理员）通过本脚本落库。
用法示例（在 backend/ 目录下）：
    uv run python scripts/create_user.py --username admin --password 12345678 --role admin
    uv run python scripts/create_user.py --username u1 --password 12345678 \
        --go-user-id 10086 --go-username zhangsan

进程退出码：0 成功，1 失败（供脚本/CI 判断）。
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# 允许从 backend/ 根目录直接执行脚本：把 backend/ 加入 import 搜索路径，
# 这样下面的 `from app....` 才能找到包（parents[1] 即脚本目录的上一级 = backend/）。
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.security import hash_password
from app.db.init_db import init_db
from app.db.models import User, UserPlatformBinding
from app.db.session import SessionLocal

# 可选角色集合，同时作为 --role 的取值白名单
ROLES = ("admin", "project_admin", "group_admin", "reviewer", "annotator")


def parse_args() -> argparse.Namespace:
    """定义并解析命令行参数。"""
    parser = argparse.ArgumentParser(description="创建 Agent 平台用户")
    parser.add_argument("--username", required=True, help="登录名")
    parser.add_argument("--password", required=True, help="密码，至少 8 位")
    parser.add_argument("--role", default="annotator", choices=ROLES)
    parser.add_argument("--display-name", default="", help="展示名，默认同用户名")
    parser.add_argument("--go-user-id", default=None, help="Go 平台 mark_user.user_id")
    parser.add_argument("--go-username", default=None, help="Go 平台用户名，可选")
    return parser.parse_args()


async def main() -> int:
    """创建用户主流程；返回进程退出码（0 成功 / 1 失败）。"""
    args = parse_args()

    # 最基本的密码强度校验（仅长度）；更复杂的规则按需再加
    if len(args.password) < 8:
        print("密码至少 8 位", file=sys.stderr)
        return 1

    # 确保建表已完成（首次在空库上运行时尤其需要）
    await init_db()

    async with SessionLocal() as session:
        # 预检用户名是否已存在，提前给出友好提示（唯一约束是最终兜底）
        existing = (
            await session.execute(
                select(User).where(User.username == args.username)
            )
        ).scalar_one_or_none()
        if existing is not None:
            print(f"用户名已存在: {args.username}", file=sys.stderr)
            return 1

        # 密码只存哈希；display_name 为空时回退用用户名
        user = User(
            username=args.username,
            password_hash=hash_password(args.password),
            display_name=args.display_name or args.username,
            role=args.role,
            status="active",
        )
        session.add(user)
        # flush 把 INSERT 发到数据库以生成 user.id（但不提交），供下面绑定引用外键
        await session.flush()

        # 仅当传了 --go-user-id 才创建平台绑定
        if args.go_user_id:
            # 该 Go 账号是否已被别人绑定（go_user_id 唯一）
            bound = (
                await session.execute(
                    select(UserPlatformBinding).where(
                        UserPlatformBinding.go_user_id == args.go_user_id
                    )
                )
            ).scalar_one_or_none()
            if bound is not None:
                # 已绑定则整体回滚，连同上面新建的 user 一起撤销，避免留下半成品
                print(f"Go 用户已绑定: {args.go_user_id}", file=sys.stderr)
                await session.rollback()
                return 1

            session.add(
                UserPlatformBinding(
                    agent_user_id=user.id,
                    go_user_id=args.go_user_id,
                    go_username=args.go_username,
                    status="active",
                )
            )

        try:
            # 一次性提交 user（+可选 binding），保证两者要么都成功要么都不留
            await session.commit()
        except IntegrityError as exc:
            # 兜底并发/约束冲突（如同名用户被并发创建）
            await session.rollback()
            print(f"创建失败: {exc.orig}", file=sys.stderr)
            return 1

        print(f"created user id={user.id} username={user.username} role={user.role}")
        if args.go_user_id:
            print(f"bound go_user_id={args.go_user_id}")
        return 0


if __name__ == "__main__":
    # asyncio.run 驱动异步主流程，并把返回码交给 SystemExit 作为进程退出码
    raise SystemExit(asyncio.run(main()))