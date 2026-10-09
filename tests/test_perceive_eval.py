from agent.perceive_eval import load_testset, score

EXP = {
    "is_disruption": True,
    "cause": "flood",
    "lane": "SMG-JKT",
    "delay_hours_min": 48,
    "delay_hours_max": 72,
    "references": ["4500018231"],
}


def test_exact_match_passes():
    assert score(EXP, {**EXP, "confidence": 0.9}) == []


def test_delay_tolerance_is_12_hours():
    assert score(EXP, {**EXP, "delay_hours_min": 36, "delay_hours_max": 84}) == []
    assert score(EXP, {**EXP, "delay_hours_min": 24}) == ["delay_hours_min"]
    assert score(EXP, {**EXP, "delay_hours_max": None}) == ["delay_hours_max"]


def test_field_failures():
    got = {**EXP, "cause": "road_closure", "lane": None, "references": []}
    assert score(EXP, got) == ["cause", "lane", "references"]


def test_non_disruption_scores_only_the_flag():
    none = {**EXP, "is_disruption": False}
    assert score(none, {"is_disruption": False, "cause": "other"}) == []
    assert score(none, {**EXP}) == ["is_disruption"]


def test_testset_loads():
    assert len(load_testset()) == 20
