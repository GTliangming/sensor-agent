"""启动时自动建表/升级：等价于在 backend 目录执行 `alembic upgrade head`。

本地开发默认开启，省去手动建表（忘记建表会导致业务线、账号类型、模板全部为空）。
线上建议 AUTO_MIGRATE=false，由发布流程显式执行迁移。
"""
import logging
from pathlib import Path

from alembic import command
from alembic.config import Config

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"


def upgrade_to_head() -> None:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    # 数据库地址由 migrations/env.py 从 DATABASE_URL 读取
    command.upgrade(cfg, "head")
    logger.info("database is at head")
