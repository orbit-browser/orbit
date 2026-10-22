import asyncio
import hashlib
from array import array
from collections import OrderedDict

import httpx
from ..config import settings

# Upstage 임베딩 요청 1회의 입력 개수 상한 — 101개부터 400(`$.input is invalid`)으로 거부된다.
_MAX_BATCH = 100

# 같은 (모델, 문장) 임베딩을 재사용한다. Ask 후속 질문은 같은 세션의 본문 조각을 다시 점수 매기고,
# 라우터는 고정 프로토타입 문장을 매번 임베딩하며, 한 Ask 요청 안에서도 질문을 검색·조각 점수에 두 번 쓴다.
# float32(array)로 담아 4096차원 하나가 16KB다.
# ponytail: 프로세스 메모리 LRU(워커 간 비공유, 재시작 시 비움), 상한 2,000개 ≈ 32MB.
#   더 필요하면 본문 조각 벡터를 Qdrant 별도 컬렉션에 저장하는 방식으로 넓힌다.
_CACHE_MAX = 2000
_cache: OrderedDict[str, array] = OrderedDict()


def _cache_key(model: str, text: str) -> str:
    return hashlib.sha256(f"{model}\x00{text}".encode()).hexdigest()


def _cache_get(key: str) -> list[float] | None:
    vector = _cache.get(key)
    if vector is None:
        return None
    _cache.move_to_end(key)
    return vector.tolist()


def _cache_put(key: str, vector: list[float]) -> None:
    _cache[key] = array("f", vector)
    _cache.move_to_end(key)
    while len(_cache) > _CACHE_MAX:
        _cache.popitem(last=False)


def clear_cache() -> None:
    _cache.clear()


async def embed(text: str, *, model: str | None = None) -> list[float]:
    """Upstage embedding 모델로 4096차원 벡터 생성.

    비대칭 임베딩: 검색 쿼리는 embedding-query, 저장할 문서(요약문)는
    embedding-passage를 써야 검색 품질이 더 좋다 (model 미지정 시 query 모델 기본값).
    """
    model = model or settings.embedding_model
    key = _cache_key(model, text)
    cached = _cache_get(key)
    if cached is not None:
        return cached
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{settings.upstage_base_url}/embeddings",
            headers={"Authorization": f"Bearer {settings.upstage_api_key}"},
            json={"model": model, "input": text},
        )
        resp.raise_for_status()
        data = resp.json()
        vector = data["data"][0]["embedding"]
    _cache_put(key, vector)
    return vector


async def embed_many(texts: list[str], *, model: str | None = None) -> list[list[float]]:
    """여러 텍스트를 한 번의 요청으로 임베딩한다(Upstage 배열 입력, OpenAI 호환).

    서브클러스터링처럼 그룹 내 이벤트별 임베딩이 여럿 필요할 때 HTTP 왕복을 1회로 줄인다.
    입력 순서와 반환 순서를 보장한다(Upstage가 index를 섞어 보낼 경우 대비해 정렬). 빈 입력은 [].
    캐시에 없는 문장만 요청하고, 상한(100개)을 넘으면 나눠서 동시에 요청한다.
    """
    if not texts:
        return []
    model = model or settings.embedding_model
    keys = [_cache_key(model, text) for text in texts]
    vectors: dict[str, list[float]] = {}
    missing: dict[str, str] = {}
    for key, text in zip(keys, texts):
        cached = _cache_get(key)
        if cached is not None:
            vectors[key] = cached
        else:
            missing.setdefault(key, text)

    if missing:
        missing_keys = list(missing)
        missing_texts = [missing[key] for key in missing_keys]
        async with httpx.AsyncClient(timeout=30.0) as client:
            batches = await asyncio.gather(
                *(
                    _embed_batch(client, missing_texts[start : start + _MAX_BATCH], model)
                    for start in range(0, len(missing_texts), _MAX_BATCH)
                )
            )
        for key, vector in zip(missing_keys, [vector for batch in batches for vector in batch]):
            vectors[key] = vector
            _cache_put(key, vector)
    return [vectors[key] for key in keys]


async def _embed_batch(
    client: httpx.AsyncClient, texts: list[str], model: str
) -> list[list[float]]:
    resp = await client.post(
        f"{settings.upstage_base_url}/embeddings",
        headers={"Authorization": f"Bearer {settings.upstage_api_key}"},
        json={"model": model, "input": texts},
    )
    resp.raise_for_status()
    data = resp.json()
    items = sorted(data["data"], key=lambda item: item["index"])
    if len(items) != len(texts):
        raise ValueError("embedding response count does not match inputs")
    return [item["embedding"] for item in items]
