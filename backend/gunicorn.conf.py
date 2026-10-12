"""生产入口：单进程维护 FAISS，线程支持聊天和进度流。"""

import os

bind = f"0.0.0.0:{int(os.getenv('PORT', '10000'))}"
workers = 1
worker_class = "gthread"
threads = 4
timeout = 120
graceful_timeout = 30
errorlog = "-"
capture_output = True
