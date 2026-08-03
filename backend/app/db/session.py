from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from ..config import settings
from .migrations import run_migrations
from .models import Base

engine = create_async_engine(settings.database_url, echo=False, pool_pre_ping=True)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def init_db() -> None:
    """앱 시작 시 테이블 생성 (Alembic 도입 전 임시) + 멱등 ALTER 러너로 컬럼 추가 흡수."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 마이그레이션 실패는 부팅 중단 (컬럼 누락 상태로 기동하면 세션 조회 전체가 깨진다)
    async with engine.begin() as conn:
        await run_migrations(conn)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
