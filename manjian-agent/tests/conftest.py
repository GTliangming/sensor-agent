"""测试全局配置：强制使用本地 fake provider 与隔离的临时数据库，杜绝网络调用。"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

# 必须在导入 app.config 之前设置环境变量
_TMP = Path(tempfile.mkdtemp(prefix="manjian_test_"))
os.environ["TEXT_PROVIDER"] = "fake"
os.environ["IMAGE_PROVIDER"] = "fake"
os.environ["TTS_PROVIDER"] = "fake"
os.environ["VIDEO_GEN_PROVIDER"] = "fake"
os.environ["AUDIO_SOURCE"] = "video"
os.environ["MINIMAX_API_KEY"] = ""
os.environ["DB_PATH"] = str(_TMP / "test.db")
os.environ["DATA_DIR"] = str(_TMP)
os.environ["DEEPSEEK_API_KEY"] = ""
os.environ["SILICONFLOW_API_KEY"] = ""

from app.config import get_settings  # noqa: E402
from app.services.task_service import get_task_service  # noqa: E402

get_settings.cache_clear()
get_task_service.cache_clear()
