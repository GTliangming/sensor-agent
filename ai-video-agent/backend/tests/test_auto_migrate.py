"""启动时自动建表：没手动执行 alembic 也能得到完整的表和出厂配置。"""
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session

from app.core.config import get_settings


def test_auto_migrate_creates_all_tables_and_seed_data(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/fresh.db"
    monkeypatch.setattr(get_settings(), "database_url", url)  # migrations/env.py 读取这个地址

    from app.db.migrate import upgrade_to_head
    upgrade_to_head()

    engine = create_engine(url)
    tables = set(inspect(engine).get_table_names())
    assert {"business_lines", "accounts", "prompt_templates", "productions", "production_artifacts",
            "production_reviews", "video_tasks", "video_task_events", "video_task_attempts", "uploaded_files",
            "alembic_version"} <= tables

    from app.models import Account, BusinessLine, PromptTemplate
    from app.seed import ensure_defaults
    with Session(engine) as db:
        ensure_defaults(db)
        assert db.scalar(select(BusinessLine.name)) == "视频号"
        account = db.scalar(select(Account))
        assert account.params["seed"] == 683072603085674
        assert len(db.scalars(select(PromptTemplate)).all()) == 9
    engine.dispose()
