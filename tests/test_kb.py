from agent.kb import LocalBM25KB


def test_demo_query_finds_pantura_flood_first():
    kb = LocalBM25KB()
    hits = kb.search("banjir Pantura Brebes, Semarang to Jakarta trucks delayed 48-72 hours")
    assert hits[0].id == "P-001"
    assert "safety stock" in hits[0].excerpt.lower()


def test_similar_cases_retrievable():
    kb = LocalBM25KB()
    assert kb.search("toll road closure")[0].id == "P-002"
    assert kb.search("port strike container")[0].id == "P-003"
    assert len(kb.docs) == 20
