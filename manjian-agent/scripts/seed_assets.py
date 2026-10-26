"""CLI：把种子素材导入当前配置的 SQLite 库。

用法： ../.venv/bin/python -m scripts.seed_assets [--force]
"""
from __future__ import annotations

import sys

from app.config import get_settings
from app.repositories.sqlite import TaskRepository
from app.services.assets.asset_seed import seed_demo_assets


def main() -> None:
    force = "--force" in sys.argv
    settings = get_settings()
    repo = TaskRepository(settings.db_file)
    n = seed_demo_assets(repo, force=force)
    print(f"seeded {n} assets into {settings.db_file} (force={force}); total now {repo.count_assets()}")


if __name__ == "__main__":
    main()
