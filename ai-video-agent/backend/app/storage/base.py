"""文件存储抽象。数据库只存 storage key（如 videos/xxx.mp4、inputs/xxx.png），二进制放在这里。"""
from abc import ABC, abstractmethod
from pathlib import Path


class Storage(ABC):
    @abstractmethod
    def save_bytes(self, key: str, data: bytes) -> None: ...

    @abstractmethod
    def save_file(self, key: str, path: Path) -> None:
        """把本地文件存进来（不会删除原文件）。"""

    @abstractmethod
    def read_bytes(self, key: str) -> bytes: ...

    @abstractmethod
    def delete(self, key: str) -> None:
        """删除文件；文件不存在时不报错。"""

    @abstractmethod
    def get_url(self, key: str) -> str:
        """返回前端和外部服务（如 AutoDL）访问这个文件用的 URL。"""
