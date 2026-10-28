"""本地磁盘存储。文件通过 /api/v1/files/{key} 访问（见 api/routes/files.py）。"""
import shutil
from pathlib import Path

from app.storage.base import Storage


class LocalStorage(Storage):
    def __init__(self, root: str | Path, public_base_url: str) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.public_base_url = public_base_url.rstrip("/")

    def resolve(self, key: str) -> Path:
        """key 对应的磁盘路径；拒绝跳出存储根目录的 key（如 ../ 或绝对路径）。"""
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError(f"非法的存储 key: {key}")
        return path

    def exists(self, key: str) -> bool:
        try:
            return self.resolve(key).is_file()
        except ValueError:
            return False

    def save_bytes(self, key: str, data: bytes) -> None:
        path = self.resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def save_file(self, key: str, path: Path) -> None:
        dest = self.resolve(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, dest)

    def read_bytes(self, key: str) -> bytes:
        return self.resolve(key).read_bytes()

    def delete(self, key: str) -> None:
        self.resolve(key).unlink(missing_ok=True)

    def get_url(self, key: str) -> str:
        return f"{self.public_base_url}/api/v1/files/{key}"
