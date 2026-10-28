"""本地调试启动入口。

直接在 PyCharm 中右键此文件 Debug / Run 即可，完美支持断点调试。
"""
import os
import sys
from pathlib import Path

# 将 backend 目录加入 Python 搜索路径
ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"
sys.path.insert(0, str(BACKEND_DIR))
os.chdir(str(BACKEND_DIR))

if __name__ == "__main__":
    import asyncio

    import uvicorn

    # 注意：调试模式下 reload=False，防止 fork 子进程导致断点失效。
    #
    # 不使用 uvicorn.run(...)，因为其内部 Server.run() 会调用
    # asyncio.run(serve(), loop_factory=...)。PyCharm 调试器会用
    # pydevd_nest_asyncio 把 asyncio.run 替换成不接受 loop_factory 参数的版本，
    # 从而抛出 TypeError。这里直接驱动 server.serve() 协程，绕开 loop_factory。
    config = uvicorn.Config("app.main:app", host="127.0.0.1", port=8000, reload=False)
    server = uvicorn.Server(config)
    asyncio.run(server.serve())
