"""统一响应包装：成功 {code, message, data}；失败 {code, message, details}。"""
from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    code: str = "OK"
    message: str = "success"
    data: T | None = None


def ok(data: object = None, message: str = "success") -> dict:
    """返回可被 response_model 校验的字典。"""
    return {"code": "OK", "message": message, "data": data}
