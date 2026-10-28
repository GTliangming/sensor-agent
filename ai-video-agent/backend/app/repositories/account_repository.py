"""业务线与账号类型数据访问。"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, BusinessLine


class AccountRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def add(self, a: Account) -> None:
        self.db.add(a)
        self.db.flush()

    def get(self, account_id: str) -> Account | None:
        return self.db.get(Account, account_id)

    def get_by_slug(self, platform: str, slug: str) -> Account | None:
        return self.db.scalar(select(Account).where(Account.platform == platform, Account.slug == slug))

    def list_all(self, include_inactive: bool = False) -> list[Account]:
        stmt = select(Account).order_by(Account.created_at)
        if not include_inactive:
            stmt = stmt.where(Account.is_active.is_(True))
        return list(self.db.scalars(stmt))

    def list_business_lines(self) -> list[BusinessLine]:
        stmt = select(BusinessLine).where(BusinessLine.is_active.is_(True)).order_by(BusinessLine.sort_order)
        return list(self.db.scalars(stmt))

    def get_business_line(self, key: str) -> BusinessLine | None:
        return self.db.get(BusinessLine, key)
