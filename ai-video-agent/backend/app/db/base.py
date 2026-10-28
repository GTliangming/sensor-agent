"""ORM 基类。所有模型都继承 Base，Alembic 通过 Base.metadata 感知表结构。"""
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
