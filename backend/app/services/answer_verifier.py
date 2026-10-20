"""Ask 답변의 비슷한 대상 혼동 검증.

답변 모델은 질문한 대상과 비슷한 다른 대상의 값을 가져오곤 한다(청량리 출발 막차를 묻는데 서울역 출발 열차 시각,
서울시 사업 접수일을 묻는데 국토부 사업 날짜). 프롬프트 규칙·답변 모델 교체로는 줄지 않아, 답변이 끝난 뒤 같은
근거로 값마다 답변이 말한 대상·기록 원문·원문의 대상을 적게 해, 기록에서는 다른 대상의 값인 것을 경고로 돌려준다.
걸린 답을 다시 쓰게 하면 원래 값으로 돌아가거나 앞뒤가 맞지 않아 고쳐 쓰지 않는다(docs/DecisionLog.md 2026-10-20).
"""

import asyncio
import logging
import re

from pydantic import BaseModel, ValidationError

from ..ai.json_utils import extract_json
from ..ai.llm import chat_completion_with_meta
from ..config import settings
from ..schemas.ask import AskVerificationIssue

# 답변(`done`) 뒤 검증을 기다리는 상한. 넘기면 경고 없이 끝낸다.
VERIFY_TIMEOUT_S = 15.0
MAX_ISSUES = 3
# 값마다 원문을 옮겨 적어 요약형 답변은 응답이 길다. 1,000토큰에서는 합성 평가 답변의 19%가 잘려 파싱되지 않았고,
# 2,500토큰에서 가장 긴 답변이 9.7초에 끝났다(검증은 done 뒤라 답변을 기다리게 하지 않는다).
VERIFY_MAX_TOKENS = 2500
# 첫 문장에서 못 찾았다고 답한 경우는 값을 단정하지 않으므로 검증하지 않는다.
_REFUSAL = re.compile(r"찾지 못|확인되지 않|나와 있지 않|적혀 있지 않|기록에 없")
_FIRST_SENTENCE = re.compile(r"^.*?(?:[.!?](?:\s|$)|\n|$)", re.S)
# 프롬프트가 계산값을 빼라고 해도 가끔 넣는다. 계산 결과가 우연히 다른 대상의 값과 같으면(지원 기간 차이 12개월 =
# 지자체 예시 12개월) 혼동으로 잘못 걸린다.
_COMPUTED_SUBJECT = re.compile(r"차이|합계|합산|총합|평균")
logger = logging.getLogger(__name__)

VERIFY_SYSTEM_PROMPT = """\
당신은 Orbit AI 답변의 검증기입니다. 사용자 질문, 탐색 기록 발췌, 다른 모델이 쓴 답변이 주어집니다.
답변이 어떤 값을 한 대상의 값이라고 말했는데, 기록에서는 그 값이 비슷한 다른 대상(다른 역·지역·기관·사업·페이지·글·제품·모델·연도)의 값인 경우를 찾으세요.

답변에 나온 핵심 값(숫자·날짜·시간·가격·비율·이름)마다 다음을 적으세요.
- value: 답변의 값
- answer_subject: 답변이 그 값을 무엇의 값이라고 했는지. 답변이 대상을 생략했으면 질문의 대상이고, "거기서", "그중" 같은 지시어는 이전 대화로 풀어 적으세요.
- quote: 기록에서 그 값이 나온 부분을 그대로 옮긴 것(표는 그 행 전체). 같은 값이 여러 곳에 있으면 answer_subject에 대해 적힌 부분을 고르세요. 기록에 없으면 빈 문자열.
- record_subject: quote가 말하는 대상과 조건(예: "서울역 출발 KTX 847", "블로그 실측 글의 HPA 설정")
- same: record_subject가 answer_subject와 같은 대상·조건이면 true, 다르면 false

판단 기준:
- 이름이 줄임말이면 같은 대상입니다(예: "드리미 L40s"와 "드리미 L40s Pro Ultra").
- 비교·여러 부분 질문에서 답변이 다른 대상의 값을 그 대상의 이름과 함께 말했으면 그 대상이 answer_subject입니다.
- 답변이 계산한 값(차이·합계·평균·비교 결과)은 claims에 넣지 말고, 계산에 쓴 기록의 값만 확인하세요.
- 날짜가 오늘 기준으로 지났는지는 따지지 마세요. 사용자는 예전에 본 기록을 묻습니다.
- 말투, 표현, 단위 띄어쓰기, 생략은 따지지 마세요.
- 답변이 "기록에서 찾지 못했어요"처럼 값을 말하지 않으면 claims는 빈 배열입니다.

JSON 객체 하나만 출력하세요:
{"claims": [{"value": "", "answer_subject": "", "quote": "", "record_subject": "", "same": true}]}"""


class _Claim(BaseModel):
    value: str
    answer_subject: str = ""
    quote: str = ""
    record_subject: str = ""
    same: bool = True


class _Verification(BaseModel):
    claims: list[_Claim] = []


def _normalize(text: str) -> str:
    return re.sub(r"[\s,]", "", text)


def is_refusal(answer: str) -> bool:
    first = _FIRST_SENTENCE.match(answer.strip())
    return bool(_REFUSAL.search(first.group(0) if first else answer))


def mismatched_claims(raw: str) -> list[AskVerificationIssue]:
    """검증 응답에서 기록 원문에 그 값이 있으면서 대상이 다른 값만 고른다. 원문 없는 값(기록에 없음)은 검증기가
    긴 근거에서 원문을 못 찾은 경우와 구분되지 않아 쓰지 않는다."""
    result = _Verification.model_validate(extract_json(raw))
    issues: dict[str, AskVerificationIssue] = {}
    for claim in result.claims:
        if claim.same or not claim.record_subject.strip() or _COMPUTED_SUBJECT.search(claim.answer_subject):
            continue
        # 혼동은 그 값이 기록에 다른 대상의 값으로 실제로 적혀 있을 때다. 인용에 값이 없으면 검증기가 계산값
        # (차이·합계)이나 엉뚱한 원문을 고른 것이라 쓰지 않는다.
        if not _normalize(claim.value) or _normalize(claim.value) not in _normalize(claim.quote):
            continue
        issues.setdefault(
            claim.value.strip(),
            AskVerificationIssue(
                value=claim.value.strip(),
                answer_subject=claim.answer_subject.strip(),
                record_subject=claim.record_subject.strip(),
            ),
        )
    return list(issues.values())[:MAX_ISSUES]


async def find_conflations(prompt: str, answer: str) -> list[AskVerificationIssue]:
    """답변 프롬프트(질문·근거)와 답변으로 혼동된 값을 찾는다. 실패하면 빈 목록 — 검증이 답변을 막지 않는다."""
    if not answer.strip() or is_refusal(answer):
        return []
    try:
        raw, model = await asyncio.wait_for(
            chat_completion_with_meta(
                VERIFY_SYSTEM_PROMPT,
                f"{prompt}\n\n검증할 답변:\n{answer}",
                temperature=0.0,
                max_tokens=VERIFY_MAX_TOKENS,
            ),
            timeout=VERIFY_TIMEOUT_S,
        )
    except Exception:
        logger.warning("Ask answer verification call failed; skipping", exc_info=True)
        return []
    # 폴백 모델(EXAONE)은 같은 프롬프트 실측에서 혼동 3건 중 1~2건만 잡고 맞는 답도 걸러 결과를 쓰지 않는다.
    if model != settings.axk1_model:
        logger.warning("Ask answer verification ran on fallback model %s; ignoring result", model)
        return []
    try:
        return mismatched_claims(raw)
    except (ValueError, ValidationError):
        logger.warning("Ask answer verification returned malformed JSON; skipping")
        return []
