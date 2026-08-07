from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# uvicorn 실행 위치에 무관하게 backend/.env 를 로드한다
_ENV_FILE = Path(__file__).parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")

    # A.X-K1 (SKT) — 요약·의도분석·리랭킹·채팅 primary (DecisionLog 2026-08-05)
    axk1_api_key: str = ""
    axk1_base_url: str = "https://awf-gw.adot.ai"
    axk1_model: str = "A.X-K1"

    # LG EXAONE (FriendliAI serverless, OpenAI 호환) — 클러스터링 primary.
    # dedicated endpoint는 웜 상태에서도 ~60초/호출로 부적합해 serverless 채택(DecisionLog 2026-08-05).
    friendli_api_key: str = ""
    friendli_base_url: str = "https://api.friendli.ai/serverless/v1"
    exaone_model: str = "LGAI-EXAONE/K-EXAONE-236B-A23B"

    # Upstage — embedding 전용 (채팅 경로는 A.X-K1 ↔ EXAONE 상호 폴백으로 대체)
    upstage_api_key: str = ""
    upstage_base_url: str = "https://api.upstage.ai/v1"
    embedding_model: str = "embedding-query"       # 검색 쿼리 임베딩
    embedding_passage_model: str = "embedding-passage"  # 저장 문서(요약) 임베딩

    # 데이터스토어
    database_url: str = "postgresql+asyncpg://orbit:orbit@localhost:5432/orbit"
    qdrant_url: str = "http://localhost:6333"
    # 0.28 = 검색 골든셋 실측(eval/run_retrieval_eval.py, 2026-08-05) 기준
    # 음성 질의 최고점(0.265)과 정답 최저점(0.289) 사이의 분리 구간 중앙값
    search_score_threshold: float = Field(default=0.28, ge=0.0, le=1.0)

    # 자연어 열린 탭 이동. 세션 검색과 문서 길이/분포가 달라 별도 실제 골든셋으로 조정한다.
    tab_action_intent_score_floor: float = Field(default=0.14, ge=-1.0, le=1.0)
    tab_action_intent_margin: float = Field(default=0.02, ge=0.0, le=2.0)
    tab_action_match_score_floor: float = Field(default=0.20, ge=-1.0, le=1.0)
    tab_action_match_margin: float = Field(default=0.06, ge=0.0, le=2.0)

    # Ask 통합 의도 라우터. 자동 실행인 탭 이동은 별도 floor/margin을 모두 통과해야 한다.
    # 검색 의도가 모호하면 retrieval_margin 아래에서 search_memory로 안전하게 fallback한다.
    assistant_route_navigation_floor: float = Field(default=0.14, ge=-1.0, le=1.0)
    assistant_route_navigation_margin: float = Field(default=0.02, ge=0.0, le=2.0)
    assistant_route_retrieval_margin: float = Field(default=0.015, ge=0.0, le=2.0)

    # Auto Session 동기화 (M3 sync_pipeline에서 사용 — docs/implementation-roadmap.md M1-1)
    sync_interval_minutes: int = Field(default=0, ge=0)  # 0 = 주기 동기화 off
    sync_event_threshold: int = Field(default=30, ge=1)  # 개수 트리거 기준
    sync_max_events_per_batch: int = Field(default=150, ge=1)  # 배치당 claim 상한

    # 서브클러스터링/append 게이팅 (DecisionLog 2026-08-06 "그룹 간 과잉 append").
    # subcluster_threshold: 골든셋 임베딩 실측 결과 안전 밴드 [0.30, 0.32]의 중앙값 0.31.
    #   <0.30이면 이질 주제가 병합(under-split), >0.32면 단일 주제가 과분할.
    subcluster_threshold: float = Field(default=0.31, ge=0.0, le=1.0)  # 낮을수록 덜 쪼갬
    # append_score_floor/max_age_days: 라이브 Qdrant 점수 미측정 상태의 보수적 잠정값 —
    #   실데이터 재세션화로 튜닝 필요(검색 positive-floor 0.289보다 소폭 위).
    append_score_floor: float = Field(default=0.35, ge=0.0, le=1.0)  # 검색 0.28보다 높게
    append_max_age_days: int = Field(default=3, ge=0)  # 후보 recency 7일보다 타이트

    # 세션 병합 제안 (merge P1, docs/merge-design.md §3.2). append_score_floor(0.35)보다 높게 잡아
    #   "거의 같은 주제"만 후보로. 0.52 = 도그푸딩 실데이터 튜닝(2026-08-07, 18세션 153쌍, 읽기 전용 측정).
    #   골든셋만으론 0.56이 나왔으나 실 세션 요약은 코사인이 더 낮게 분포(정답 낭만인프라↔인프라모니터링 0.533,
    #   merge-design §1 명시 케이스)해 0.56이면 놓침. 키워드 게이트 통과 쌍의 실데이터 분리 구간
    #   [0.44 최상위 음성, 0.533 최하위 정답] 사이 0.52 채택.
    merge_suggest_floor: float = Field(default=0.52, ge=0.0, le=1.0)
    merge_suggest_max_pairs: int = Field(default=50, ge=1)  # 제안 응답 상한(과다 방지)

    # 자동 병합 (opt-in, 기본 OFF). 문서화된 "자동 파괴 금지" 원칙(merge-design §2, AGENTS §11)을
    #   깨는 기능이므로 명시적으로 켜야 하고, 켜져도 "명백한 중복"만 배치 후 자동 병합한다:
    #   코사인 >= auto_merge_floor(제안 floor 0.52보다 훨씬 높게) AND 제목 토큰 자카드 >= auto_merge_title_jaccard.
    #   모든 자동 병합은 로그로 남기고 unmerge로 되돌릴 수 있다.
    auto_merge_enabled: bool = False
    # 코사인 floor는 보조 안전장치, 실제 게이트는 제목 자카드(near-identical title). 0.80이면 실데이터의
    #   제목 완전 동일 중복(예: 가비아 0.847)이 대상이 되고, 제목이 다른 쌍(제주항공권 검색↔예약)은 자카드에서 걸린다.
    auto_merge_floor: float = Field(default=0.80, ge=0.0, le=1.0)
    auto_merge_title_jaccard: float = Field(default=0.8, ge=0.0, le=1.0)


settings = Settings()
