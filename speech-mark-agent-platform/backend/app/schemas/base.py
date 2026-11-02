"""对外 DTO 基类：Python 内部用 snake_case，HTTP 上自动用 camelCase。

前后端约定：前端（TypeScript）按 camelCase 消费字段，后端按 PEP8 写
snake_case 属性，由这里的 alias 机制在边界自动转换，业务代码无需手写映射。

注意：`model_dump()` 默认仍输出字段名（snake_case），需要 camelCase 时必须
显式传 `by_alias=True`；FastAPI 的 response_model 序列化默认就是 by_alias，
所以接口返回值天然是 camelCase。
"""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class APIModel(BaseModel):
    """所有对外 DTO 的基类:Python 侧 snake_case,对外自动 camelCase。"""

    model_config = ConfigDict(
        # 为每个字段生成 camelCase 别名：user_name -> userName、llm_provider -> llmProvider
        # 别名同时用于「解析入参」和「按别名序列化」
        alias_generator=to_camel,
        # 允许直接用字段名（snake_case）构造模型。
        # 不加这行时，入参只认别名，Python 侧 User(user_name="x") 会校验失败
        populate_by_name=True,
        # 支持从任意对象（ORM 实例、dataclass、普通对象）按属性读取并校验：
        # UserDTO.model_validate(user_orm)，省去一段手写转换代码
        from_attributes=True,
    )
