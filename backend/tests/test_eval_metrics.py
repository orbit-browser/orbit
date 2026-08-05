from eval.metrics import (
    NOISE,
    EventOutcome,
    ScenarioDecision,
    assignment_accuracy,
    build_cluster_label_map,
    decide_new_vs_existing,
    new_vs_existing_accuracy,
    noise_exclusion_rate,
    remap_predictions,
    session_coverage,
    session_purity,
)


def _o(event_id: str, predicted_key: str | None, expected_key: str) -> EventOutcome:
    return EventOutcome(event_id=event_id, predicted_key=predicted_key, expected_key=expected_key)


# ── build_cluster_label_map / remap_predictions ──────────────────────────


def test_build_cluster_label_map_uses_majority_label_per_cluster():
    outcomes = [
        _o("e1", "new::0", "gpu_research"),
        _o("e2", "new::0", "gpu_research"),
        _o("e3", "new::0", "gpu_research"),
    ]
    assert build_cluster_label_map(outcomes) == {"new::0": "gpu_research"}


def test_build_cluster_label_map_excludes_noise_and_hold_clusters():
    outcomes = [_o("e1", NOISE, NOISE), _o("e2", None, "gpu_research")]
    assert build_cluster_label_map(outcomes) == {}


def test_remap_predictions_rewrites_create_labels_to_majority_expected_label():
    outcomes = [
        _o("e1", "new::0", "gpu_research"),
        _o("e2", "new::0", "gpu_research"),
        _o("e3", "new::0", "noise"),  # 소수 라벨 — 다수결에서 밀림
    ]
    remapped = remap_predictions(outcomes)
    assert [o.predicted_key for o in remapped] == ["gpu_research", "gpu_research", "gpu_research"]


def test_remap_predictions_leaves_noise_and_hold_untouched():
    outcomes = [_o("e1", NOISE, NOISE), _o("e2", None, "gpu_research")]
    remapped = remap_predictions(outcomes)
    assert remapped[0].predicted_key == NOISE
    assert remapped[1].predicted_key is None


# ── assignment_accuracy ──────────────────────────────────────────────


def test_assignment_accuracy_perfect_append_match():
    outcomes = [
        _o("e1", "trip_planning", "trip_planning"),
        _o("e2", "trip_planning", "trip_planning"),
    ]
    assert assignment_accuracy(outcomes) == 1.0


def test_assignment_accuracy_handles_create_via_majority_remap():
    # e1~e3는 새로 만든 세션(new::0)에 배정됐고 정답 라벨은 모두 gpu_research → 리매핑 후 100%
    outcomes = [
        _o("e1", "new::0", "gpu_research"),
        _o("e2", "new::0", "gpu_research"),
        _o("e3", "new::0", "gpu_research"),
        _o("e4", NOISE, NOISE),
    ]
    assert assignment_accuracy(outcomes) == 1.0


def test_assignment_accuracy_partial_mismatch():
    # new::0 클러스터의 다수결 라벨은 gpu_research(e1,e3) — 소수 라벨로 섞여 들어간
    # e2(travel_prep)는 리매핑 후에도 정답과 어긋나 오답으로 집계된다.
    outcomes = [
        _o("e1", "new::0", "gpu_research"),
        _o("e2", "new::0", "travel_prep"),
        _o("e3", "new::0", "gpu_research"),
    ]
    assert assignment_accuracy(outcomes) == 2 / 3


def test_assignment_accuracy_none_when_all_noise():
    outcomes = [_o("e1", NOISE, NOISE)]
    assert assignment_accuracy(outcomes) is None


def test_assignment_accuracy_hold_never_matches():
    outcomes = [_o("e1", None, "gpu_research")]
    assert assignment_accuracy(outcomes) == 0.0


# ── session_purity ──────────────────────────────────────────────


def test_session_purity_single_pure_cluster_is_one():
    outcomes = [
        _o("e1", "new::0", "gpu_research"),
        _o("e2", "new::0", "gpu_research"),
    ]
    assert session_purity(outcomes) == 1.0


def test_session_purity_mixed_cluster_ratio():
    outcomes = [
        _o("e1", "new::0", "gpu_research"),
        _o("e2", "new::0", "gpu_research"),
        _o("e3", "new::0", "travel_prep"),
    ]
    assert session_purity(outcomes) == 2 / 3


def test_session_purity_averages_across_multiple_clusters_unweighted():
    outcomes = [
        # cluster A: 100% pure (2 events)
        _o("e1", "A", "gpu_research"),
        _o("e2", "A", "gpu_research"),
        # cluster B: 50% pure (2 events)
        _o("e3", "B", "travel_prep"),
        _o("e4", "B", "coding_study"),
    ]
    assert session_purity(outcomes) == (1.0 + 0.5) / 2


def test_session_purity_none_when_no_predicted_clusters():
    outcomes = [_o("e1", NOISE, NOISE), _o("e2", None, "gpu_research")]
    assert session_purity(outcomes) is None


# ── session_coverage ──────────────────────────────────────────────


def test_session_coverage_full_when_every_expected_label_has_a_cluster():
    outcomes = [
        _o("e1", "A", "travel_prep"),
        _o("e2", "B", "coding_study"),
    ]
    assert session_coverage(outcomes) == 1.0


def test_session_coverage_partial_when_one_expected_label_has_no_cluster():
    outcomes = [
        _o("e1", "A", "travel_prep"),
        _o("e2", None, "coding_study"),  # hold로 남아 어떤 클러스터에도 대응되지 못함
    ]
    assert session_coverage(outcomes) == 0.5


def test_session_coverage_none_when_no_expected_labels():
    outcomes = [_o("e1", NOISE, NOISE)]
    assert session_coverage(outcomes) is None


# ── noise_exclusion_rate ──────────────────────────────────────────────


def test_noise_exclusion_rate_all_excluded():
    outcomes = [_o("e1", NOISE, NOISE), _o("e2", NOISE, NOISE)]
    assert noise_exclusion_rate(outcomes) == 1.0


def test_noise_exclusion_rate_partial():
    outcomes = [_o("e1", NOISE, NOISE), _o("e2", "new::0", NOISE)]
    assert noise_exclusion_rate(outcomes) == 0.5


def test_noise_exclusion_rate_none_when_no_noise_events():
    outcomes = [_o("e1", "A", "gpu_research")]
    assert noise_exclusion_rate(outcomes) is None


# ── decide_new_vs_existing / new_vs_existing_accuracy ────────────────────


def test_decide_new_vs_existing_prefers_existing_when_append_present():
    assert decide_new_vs_existing(["append", "create"]) == "existing"


def test_decide_new_vs_existing_is_new_when_only_create():
    assert decide_new_vs_existing(["create", "create"]) == "new"


def test_decide_new_vs_existing_defaults_to_new_when_no_signal():
    assert decide_new_vs_existing(["hold", "discard"]) == "new"


def test_decide_new_vs_existing_empty_actions_defaults_to_new():
    assert decide_new_vs_existing([]) == "new"


def test_new_vs_existing_accuracy_all_match():
    decisions = [
        ScenarioDecision(scenario_name="s1", expected="new", predicted="new"),
        ScenarioDecision(scenario_name="s2", expected="existing", predicted="existing"),
    ]
    assert new_vs_existing_accuracy(decisions) == 1.0


def test_new_vs_existing_accuracy_partial_mismatch():
    decisions = [
        ScenarioDecision(scenario_name="s1", expected="new", predicted="existing"),
        ScenarioDecision(scenario_name="s2", expected="existing", predicted="existing"),
    ]
    assert new_vs_existing_accuracy(decisions) == 0.5


def test_new_vs_existing_accuracy_none_when_empty():
    assert new_vs_existing_accuracy([]) is None
