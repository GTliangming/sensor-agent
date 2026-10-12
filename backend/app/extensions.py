"""Flask 扩展实例：在此处声明，在 create_app() 中 init_app 绑定。

这样做是为了避免循环导入——扩展对象先创建、晚绑定。
"""

from flask_cors import CORS

cors = CORS()
