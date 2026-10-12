"""WSGI 入口。

开发：  python wsgi.py          （或  flask --app wsgi run --port 5000）
生产：  gunicorn "wsgi:app"     （wsgi:app 即本模块里的 app 对象）
"""

from app import create_app
from config import config

app = create_app()

if __name__ == "__main__":
    app.run(host=config.HOST, port=config.PORT, debug=config.DEBUG)
