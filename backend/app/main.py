import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.search import router as search_router
from .api.sessions import recover_pending_sessions
from .api.sessions import router as sessions_router
from .db.session import init_db
from .db.vector import init_collection


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await init_collection()
    await recover_pending_sessions()
    yield


app = FastAPI(title="Orbit API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions_router)
app.include_router(search_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
