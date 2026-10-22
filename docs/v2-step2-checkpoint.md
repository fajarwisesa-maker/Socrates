# SIAGA v2 step 2 checkpoint: multi-agent orchestration

Flag: `ORCHESTRATION=multi` (default `single` = v1). Design and decisions: CLAUDE.md,
"SIAGA v2 step 2 decisions".

**Every run below used the scripted `fake` LLM.** The three Bedrock runs this step asks for
are blocked: the AWS account returns `ValidationException: Operation not allowed` on every
model call (Anthropic's first-time use form had not been submitted).

## One run, event by event

`ORCHESTRATION=multi uv run python -m agent.run --whatsapp data/demo/whatsapp_driver.txt \
--pdf data/demo/forwarder_notice.pdf --provider fake --embedded-sap --auto-approve --verify-delay 1 --plain`

Columns: wall time, stage, agent, event, title. Each specialist chooses its own tool calls
(within its allowlist); the orchestrator opens and closes the case.

```
   0.5s  CASE      SIAGA Orchestrator info       Case opened
SIAGA case case-…  (LLM: fake)
   0.5s  PERCEIVE  Signal Agent       started    Perceive started
   0.5s  PERCEIVE  Signal Agent       llm        LLM signal (0.0 s)
   0.5s  PERCEIVE  Signal Agent       tool       extract_pdf_text -> ok (Tier 0)
   0.5s  PERCEIVE  Signal Agent       llm        LLM signal (0.0 s)
   0.6s  PERCEIVE  Signal Agent       completed  Disruption identified
   0.6s  ASSESS    Impact Agent       started    Assess started
   0.6s  ASSESS    Impact Agent       llm        LLM impact (0.0 s)
   0.6s  ASSESS    Impact Agent       tool       find_open_pos -> ok (Tier 0)
   0.6s  ASSESS    Impact Agent       llm        LLM impact (0.0 s)
   0.6s  ASSESS    Impact Agent       tool       get_sales_orders -> ok (Tier 0)
   0.6s  ASSESS    Impact Agent       tool       compute_risk -> ok (Tier 0)
   0.6s  ASSESS    Impact Agent       llm        LLM impact (0.0 s)
   0.6s  ASSESS    Impact Agent       completed  Impact assessed
   0.6s  PLAN      Planner Agent      started    Plan started
   0.7s  PLAN      Planner Agent      llm        LLM planner.plan (0.0 s)
   0.7s  PLAN      Planner Agent      tool       search_precedents -> ok (Tier 0)
   0.7s  PLAN      Planner Agent      llm        LLM planner.plan (0.0 s)
   0.7s  PLAN      Planner Agent      completed  2 candidate(s) proposed
   0.7s  SIMULATE  Planner Agent      started    Simulate started
   0.7s  SIMULATE  Planner Agent      llm        LLM planner.simulate (0.0 s)
   0.7s  SIMULATE  Planner Agent      tool       run_solver -> ok (Tier 0)
   0.7s  SIMULATE  Planner Agent      tool       run_solver -> ok (Tier 0)
   0.8s  SIMULATE  Planner Agent      llm        LLM planner.simulate (0.0 s)
   0.8s  SIMULATE  Planner Agent      completed  2 option(s) solved
   0.8s  REFLECT   Critic Agent       started    Reflect started
   0.8s  REFLECT   Critic Agent       llm        LLM critic.review (0.0 s)
   0.8s  REFLECT   Critic Agent       tool       check_business_rules -> ok (Tier 0)
   0.8s  REFLECT   Critic Agent       llm        LLM critic.review (0.0 s)
   0.8s  REFLECT   Critic Agent       check      Critic: option A1 passes all rules
   0.8s  REFLECT   Critic Agent       rejected   Critic: option B1 violates safety_stock
   0.8s  REFLECT   Critic Agent       completed  Critic rejected option B1; replanning
   0.8s  PLAN      Planner Agent      started    Plan started
   0.8s  PLAN      Planner Agent      llm        LLM planner.plan (0.0 s)
   0.8s  PLAN      Planner Agent      completed  2 candidate(s) proposed
   0.8s  SIMULATE  Planner Agent      started    Simulate started
   0.8s  SIMULATE  Planner Agent      llm        LLM planner.simulate (0.0 s)
   0.9s  SIMULATE  Planner Agent      tool       run_solver -> ok (Tier 0)
   0.9s  SIMULATE  Planner Agent      tool       run_solver -> ok (Tier 0)
   0.9s  SIMULATE  Planner Agent      llm        LLM planner.simulate (0.0 s)
   0.9s  SIMULATE  Planner Agent      completed  2 option(s) solved
   0.9s  REFLECT   Critic Agent       started    Reflect started
   0.9s  REFLECT   Critic Agent       llm        LLM critic.review (0.0 s)
   1.0s  REFLECT   Critic Agent       tool       check_business_rules -> ok (Tier 0)
   1.0s  REFLECT   Critic Agent       llm        LLM critic.review (0.0 s)
   1.0s  REFLECT   Critic Agent       check      Critic: option A2 passes all rules
   1.0s  REFLECT   Critic Agent       check      Critic: option B2 passes all rules
   1.0s  REFLECT   Critic Agent       llm        LLM critic.explain (0.0 s)
   1.0s  REFLECT   Critic Agent       completed  Selected option B2 (Rp 11.400.000)
   1.0s  ACT       Executor Agent     started    Act started
   1.0s  ACT       Executor Agent     tool       create_stock_transfer -> ok (Tier 2)
   1.0s  ACT       Executor Agent     executed   Auto-executed (Tier 2): Transfer 400 cartons DC-BDG -> DC-CKR (2 truck(s))
   1.0s  ACT       Executor Agent     llm        LLM executor.summary (0.0 s)
   1.1s  ACT       Executor Agent     tool       request_approval -> ok (Tier 0)
   1.1s  ACT       Executor Agent     waiting    Approval requested (Tier 3): Bridge PO to V-2002 for 500 cartons delivered to DC-CKR
   1.1s  ACT       Executor Agent     info       Tier 0 note on PO 4500018231
   1.1s  ACT       Executor Agent     completed  1 executed, 1 awaiting approval

  APPROVAL apr-…: Bridge PO to V-2002 for 500 cartons delivered to DC-CKR  Rp 7.500.000
    approve by Day 1 18:00 · Fri 23 Oct WIB; if rejected: Executed actions are kept. SIAGA replans the remaining shortfall (about 500 cartons) without this action; the next known option is A2 Air charter (Rp 31.000.000).
   1.1s  ACT       Executor Agent     tool       create_purchase_order -> ok (Tier 3)
   1.1s  ACT       Executor Agent     executed   Executed after approval: Bridge PO to V-2002 for 500 cartons delivered to DC-CKR
   1.1s  VERIFY    Executor Agent     scheduled  Verification scheduled

(waiting 1 s for VERIFY)
   2.1s  VERIFY    Executor Agent     started    Verify started
   2.1s  VERIFY    Executor Agent     tool       check_status -> ok (Tier 0)
   2.1s  VERIFY    Executor Agent     completed  Verified: demand covered
   2.1s  CASE      SIAGA Orchestrator resolved   Case resolved

=== summary
status RESOLVED  tool calls 15  LLM calls 18  replans 1  wall 2.1 s
chosen B2 Rp 11.400.000; exposure Rp 340.000.000; saving vs A2 Rp 19.600.000
  EXECUTED          Tier 2  Transfer 400 cartons DC-BDG -> DC-CKR (2 truck(s))  Rp 3.900.000  STO-000001
  EXECUTED          Tier 3  Bridge PO to V-2002 for 500 cartons delivered to DC-CKR  Rp 7.500.000  4500018232
stage times (s):
  PERCEIVE     0.03
  ASSESS       0.084
  PLAN         0.018
  SIMULATE     0.086
  REFLECT      0.046
  PLAN#2       0.013
  SIMULATE#2   0.078
  REFLECT#2    0.061
  ACT          0.072
  VERIFY       0.023
```

## Timings (fake LLM, `make rehearse N=10`)

| Agent | Stage(s) | mean / max s |
| --- | --- | --- |
| Signal Agent | Perceive | 0.02 / 0.04 |
| Impact Agent | Assess | 0.08 / 0.12 |
| Planner Agent | Plan + Simulate (2 rounds) | 0.19 / 0.21 |
| Critic Agent | Reflect (2 rounds) | 0.11 / 0.11 |
| Executor Agent | Act + Verify | 0.10 / 0.19 |

Signal → verified: 3.7 s mean (VERIFY timer 3 s). With Bedrock, each of the 18 model calls
adds its latency; the < 4 min target is to be measured once Bedrock works.

## Tests

| Check | Result |
| --- | --- |
| pytest (incl. `tests/test_multi_agent.py`, 12 tests: agent sequence, tools per agent, audit attribution, gloss, approve → verify, reject → air within budget, allowlist hard error, budget and replan cap across agents, code fill-in for a skipped candidate, bounded invalid output, multi recording replays) | 171 passed, 1 skipped (live Bedrock) |
| `make rehearse N=10`, multi, fake | 10/10 |
| `make rehearse N=10`, multi, replay | 10/10 |
| `make rehearse N=3`, v1 (flag off) | 3/3 |
| `make web-smoke`, multi (fake / replay) | 9/9 / 8/8 (incl. projector check and `e2e/multi.spec.ts`) |
| `make web-smoke`, v1 (fake / replay) | 8/8 + multi spec skipped / 7/7 |
