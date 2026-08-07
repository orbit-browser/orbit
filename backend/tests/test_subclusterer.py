from app.services.subclusterer import subcluster


def test_empty_and_single():
    assert subcluster([], 0.5) == []
    assert subcluster([[1.0, 0.0]], 0.5) == [[0]]


def test_identical_vectors_merge():
    # 코사인 1.0 ≥ threshold → 한 클러스터
    assert subcluster([[1.0, 0.0], [1.0, 0.0]], 0.5) == [[0, 1]]


def test_orthogonal_vectors_split():
    # 코사인 0 < threshold → 분리
    assert subcluster([[1.0, 0.0], [0.0, 1.0]], 0.5) == [[0], [1]]


def test_two_topics_separated():
    # 인덱스 0·2는 여행 축, 1·3은 코딩 축(직교) → 주제별 2개로 분리
    vectors = [
        [1.0, 0.0],   # 0 travel
        [0.0, 1.0],   # 1 coding
        [0.98, 0.02],  # 2 travel
        [0.02, 0.98],  # 3 coding
    ]
    assert subcluster(vectors, 0.5) == [[0, 2], [1, 3]]


def test_near_but_distinct_stays_together_below_threshold_split():
    # 매우 유사(0,1)한 쌍과 직교(2) → [[0,1],[2]], 출력은 min index 순
    vectors = [[1.0, 0.0], [0.99, 0.01], [0.0, 1.0]]
    assert subcluster(vectors, 0.5) == [[0, 1], [2]]


def test_output_sorted_by_min_index():
    # 다른 주제가 인덱스 0에 오더라도 클러스터는 min index 오름차순으로 정렬돼 나온다
    vectors = [[0.0, 1.0], [1.0, 0.0], [0.99, 0.01]]
    assert subcluster(vectors, 0.5) == [[0], [1, 2]]


def test_low_threshold_merges_everything():
    vectors = [[1.0, 0.0], [0.0, 1.0], [0.0, 1.0]]
    result = subcluster(vectors, 0.0)
    assert result == [[0, 1, 2]]


def test_zero_vector_is_isolated():
    # 영벡터는 코사인 0 → threshold 0.5에서 단독 클러스터
    vectors = [[1.0, 0.0], [1.0, 0.0], [0.0, 0.0]]
    assert subcluster(vectors, 0.5) == [[0, 1], [2]]


def test_deterministic_repeat():
    vectors = [[1.0, 0.0], [0.0, 1.0], [0.9, 0.1], [0.1, 0.9]]
    first = subcluster(vectors, 0.5)
    second = subcluster(vectors, 0.5)
    assert first == second
