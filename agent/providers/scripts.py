"""Scripted LLM behaviour for the golden demo path (FakeProvider).

Each script reads the request (signals, tool results, context JSON) like the model would
and answers through the same tools. It never computes numbers: delays come from the
signal text ("2-3 hari" -> 48-72 h is interpretation), everything else is copied from tool
results or the context.
"""

from __future__ import annotations

import json
import re
from typing import Any

from agent.providers.base import LLMRequest
from agent.providers.fake import Script, say, tool_call


def _all_text(req: LLMRequest) -> str:
    return "\n".join(
        b.get("text", "") for m in req.messages if m["role"] == "user" for b in m["content"]
    )


def _tool_results(req: LLMRequest) -> list[dict[str, Any]]:
    out = []
    for m in req.messages:
        for b in m["content"]:
            if "toolResult" in b:
                out.append(b["toolResult"]["content"][0]["json"])
    return out


def _first_json(req: LLMRequest) -> dict[str, Any]:
    text = req.messages[0]["content"][0]["text"]
    return json.loads(text[text.index("{") :])


# (quote, field) the scripted model points at, per signal type. Code locates them.
_EVIDENCE = {
    "whatsapp": [
        ("lalin Pantura", "lane"),
        ("macet total", "is_disruption"),
        ("banjir di Brebes", "cause"),
        ("ga gerak sm sekali", "is_disruption"),
        ("bs 2-3 hari", "delay"),
    ],
    "pdf": [
        ("severe flooding", "cause"),
        ("Jalur Pantura", "lane"),
        ("between Brebes and Tegal", "location"),
        ("48–72 hours", "delay"),
        ("4500018231", "references"),
    ],
}


def _signal_blocks(req: LLMRequest) -> list[tuple[int, str, str]]:
    """(number, type, text) per "### Signal N (type...)" block of the PERCEIVE prompt."""
    text = _all_text(req)
    parts = re.split(r"^### Signal (\d+) \((\w+)[^)]*\)\n", text, flags=re.M)
    return [(int(parts[i]), parts[i + 1], parts[i + 2]) for i in range(1, len(parts) - 2, 3)]


def perceive(req: LLMRequest, n: int) -> dict[str, Any]:
    text = _all_text(req)
    refs = sorted(set(re.findall(r"\b45\d{8}\b", text)))
    has_notice = "force majeure" in text.lower()
    evidence = [
        {"quote": q, "signal": num, "field": f}
        for num, kind, body in _signal_blocks(req)
        for q, f in _EVIDENCE.get(kind, [])
        if q in body
    ]
    return tool_call(
        "report_disruption",
        {
            "is_disruption": True,
            "cause": "flood",
            "lane": "SMG-JKT",
            "location": "Jalur Pantura, Brebes-Tegal",
            "delay_hours_min": 48,
            "delay_hours_max": 72,
            "references": refs,
            "evidence": evidence,
            "model_confidence": 0.92 if has_notice else 0.6,
        },
    )


def assess(req: LLMRequest, n: int) -> dict[str, Any]:
    d = _first_json(req)
    results = _tool_results(req)
    if not results:
        return tool_call(
            "find_inbound_purchase_orders", {"lane": d["lane"], "references": d["references"]}
        )
    last = results[-1]
    if "purchase_orders" in last:
        pos = last["purchase_orders"]
        item = pos[0]["items"][0]
        return tool_call(
            "assess_impact",
            {
                "material": item["Material"],
                "plant": item["Plant"],
                "affected_references": [p["PurchaseOrder"] for p in pos],
                "delay_hours_min": d["delay_hours_min"],
                "delay_hours_max": d["delay_hours_max"],
            },
        )
    return say("Impact assessed.")


def plan(req: LLMRequest, n: int) -> dict[str, Any]:
    ctx = _first_json(req)
    results = _tool_results(req)
    if ctx["round"] == 1 and not results:
        d = ctx["disruption"]
        return tool_call(
            "search_precedents",
            {"query": f"{d['cause']} {d['location']} {d['lane']} inbound delay"},
        )
    ids = [h["id"] for r in results for h in r.get("hits", [])][:3]
    return tool_call(
        "propose_candidates",
        {
            "candidates": [
                {
                    "label": "Air charter",
                    "strategies": ["spot_air"],
                    "rationale": "Fastest option and independent of the flooded road.",
                },
                {
                    "label": "Transfer + bridge order",
                    "strategies": ["stock_transfer", "alternate_supplier"],
                    "rationale": "Bandung DC is off the Pantura corridor and a Jabodetabek "
                    "alternate supplier is approved; precedent P-001.",
                },
            ],
            "precedent_ids": ids,
        },
    )


def reflect(req: LLMRequest, n: int) -> dict[str, Any]:
    data = _first_json(req)
    cmp = data["comparison"]
    chosen = data["selected_option"]
    rejected = [
        {
            "option_id": f["option_id"],
            "why": "violates " + ", ".join(c["rule"] for c in f["checks"] if not c["passed"]),
        }
        for f in data["earlier_rounds_rejected"]
    ] + [
        {"option_id": o["option_id"], "why": f"more expensive ({o['total_cost_display']})"}
        for o in data["options"]
        if o["option_id"] != chosen and o["status"] == "optimal"
    ]
    return tool_call(
        "write_explanation",
        {
            "summary": f"Flooding on the Pantura corridor delays the inbound PO past the loading "
            f"cutoff, putting {cmp['max_exposure_display']} at risk. SIAGA recommends option "
            f"{chosen} at {cmp['chosen_cost_display']}.",
            "recommendation_rationale": f"Option {chosen} covers the full shortfall before the "
            "cutoff and keeps every donor DC at its safety stock"
            + (
                f", saving {cmp['saving_display']} against option {cmp['baseline']}."
                if "saving_display" in cmp
                else "."
            ),
            "rejected_options": rejected,
            "risks": ["The bridge PO must be approved before its approve-by time."],
        },
    )


# ---------------------------------------------------------------- v2 specialists
# (ORCHESTRATION=multi). Same decisions as above, made through each agent's own tools.

_GLOSS = {
    "lalin Pantura": "Pantura traffic",
    "macet total": "total gridlock",
    "banjir di Brebes": "flooding in Brebes",
    "ga gerak sm sekali": "not moving at all",
    "bs 2-3 hari": "could take 2-3 days",
}


def _calls(*uses: tuple[str, dict[str, Any]], text: str | None = None) -> dict[str, Any]:
    """An assistant message with several tool calls in one turn."""
    content: list[dict[str, Any]] = [{"text": text}] if text else []
    for name, args in uses:
        content += tool_call(name, args)["content"]
    return {"role": "assistant", "content": content}


def signal_agent(req: LLMRequest, n: int) -> dict[str, Any]:
    blocks = _signal_blocks(req)
    pdfs = {r["signal"]: r["text"] for r in _tool_results(req) if "text" in r and "signal" in r}
    unread = [num for num, kind, _ in blocks if kind == "pdf" and num not in pdfs]
    if unread:
        return _calls(*[("extract_pdf_text", {"signal": num}) for num in unread])
    texts = [(num, kind, pdfs.get(num, body)) for num, kind, body in blocks]
    everything = "\n".join(t for _, _, t in texts)
    evidence = [
        {"quote": q, "signal": num, "field": f, "gloss_en": _GLOSS.get(q, q)}
        for num, kind, body in texts
        for q, f in _EVIDENCE.get(kind, [])
        if q in body
    ]
    return tool_call(
        "report_disruption",
        {
            "is_disruption": True,
            "cause": "flood",
            "lane": "SMG-JKT",
            "location": "Jalur Pantura, Brebes-Tegal",
            "delay_hours_min": 48,
            "delay_hours_max": 72,
            "references": sorted(set(re.findall(r"\b45\d{8}\b", everything))),
            "evidence": evidence,
            "model_confidence": 0.92 if "force majeure" in everything.lower() else 0.6,
        },
    )


def impact_agent(req: LLMRequest, n: int) -> dict[str, Any]:
    d = _first_json(req)
    results = _tool_results(req)
    offered = {t["toolSpec"]["name"] for t in req.tools}
    if not results:
        find = ("find_open_pos", {"lane": d["lane"], "references": d["references"]})
        # with DELAY_MODEL set, also ask for the learned delay in the same turn
        return _calls(find, ("predict_delay", {})) if "predict_delay" in offered else _calls(find)
    # the delay the risk function must use: predict_delay's, else the reported range
    delay = next(
        (r["delay_for_risk_hours"] for r in results if "delay_for_risk_hours" in r),
        [d["delay_hours_min"], d["delay_hours_max"]],
    )
    pos_result = next((r for r in results if "purchase_orders" in r), None)
    last = results[-1]
    if "risk" not in last and pos_result is not None:
        pos = pos_result["purchase_orders"]
        item = pos[0]["items"][0]
        return _calls(
            ("get_sales_orders", {"material": item["Material"], "plant": item["Plant"]}),
            (
                "compute_risk",
                {
                    "material": item["Material"],
                    "plant": item["Plant"],
                    "affected_references": [p["PurchaseOrder"] for p in pos],
                    "delay_hours_min": delay[0],
                    "delay_hours_max": delay[1],
                },
            ),
        )
    plant_id = next(
        b["toolUse"]["input"]["plant"]
        for m in req.messages
        for b in m["content"]
        if b.get("toolUse", {}).get("name") == "compute_risk"
    )
    plant = ((last.get("labels") or {}).get("plants") or {}).get(plant_id, plant_id)
    refs = ", ".join(i["ref"] for i in last["risk"]["inbound"])
    return say(
        f"The flood delays PO {refs or 'the inbound PO'} past the loading cutoff at {plant}, "
        "so the customer orders loading there before it are at risk of a stockout."
    )


def planner_simulate(req: LLMRequest, n: int) -> dict[str, Any]:
    ask = max(
        i
        for i, m in enumerate(req.messages)
        if m["role"] == "user"
        and any(b.get("text", "").startswith("Simulate each candidate") for b in m["content"])
    )
    if any("toolResult" in b for m in req.messages[ask + 1 :] for b in m["content"]):
        return say("Every candidate has a solver result.")
    text = req.messages[ask]["content"][0]["text"]
    lines = re.findall(r"^- \w+: (.+)$", text, flags=re.M)
    return _calls(*[("run_solver", {"strategies": ln.split(", ")}) for ln in lines])


def critic_review(req: LLMRequest, n: int) -> dict[str, Any]:
    ctx = _first_json(req)
    results = _tool_results(req)
    if not results:
        return tool_call("check_business_rules", {"round": ctx["round"]})
    notes = [
        {
            "option_id": rv["option_id"],
            "explanation": ". ".join(
                c["plain"] or c["detail"] for c in rv["checks"] if not c["passed"]
            )
            + ". The plan looks cheapest on paper but would move the stockout to the donor DC's "
            "own customers.",
        }
        for rv in results[-1]["reviews"]
        if not all(c["passed"] for c in rv["checks"])
    ]
    return tool_call("report_review", {"explanations": notes})


def executor_summary(req: LLMRequest, n: int) -> dict[str, Any]:
    f = _first_json(req)
    return tool_call(
        "write_approval_summary",
        {
            "summary": f"SIAGA asks you to approve: {f['what']} ({f['cost_display']}). It closes "
            f"the remaining shortfall before the loading cutoff; approve by "
            f"{f['approve_by_display']}."
        },
    )


def golden_scripts() -> dict[str, Script]:
    return {
        "perceive": perceive,
        "assess": assess,
        "plan": plan,
        "reflect": reflect,
        # v2 specialists (ORCHESTRATION=multi)
        "signal": signal_agent,
        "impact": impact_agent,
        "planner.plan": plan,
        "planner.simulate": planner_simulate,
        "critic.review": critic_review,
        "critic.explain": reflect,
        "executor.summary": executor_summary,
    }
