.DEFAULT_GOAL := help
SHELL := /bin/bash
UV := uv run
N ?= 10

.PHONY: help install dev api web web-check web-smoke web-smoke-replay test lint fmt aws-check aws-probe seed sap-mock solver solver-demo policy-demo demo-inputs demo demo-fake eval-perceive demo-reset replay replay-cli record-golden rehearse rehearse-fault preflight destroy

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

install: ## Install Python + web deps and the pre-commit hook
	uv sync
	$(UV) pre-commit install
	cd web && npm ci

test: ## Run the test suite
	$(UV) pytest -q

lint: ## Ruff lint + format check
	$(UV) ruff check .
	$(UV) ruff format --check .

fmt: ## Auto-fix lint and format
	$(UV) ruff check --fix .
	$(UV) ruff format .

aws-check: ## Show AWS identity and ACTIVE Claude models in AWS_REGION
	$(UV) python scripts/aws_check.py

aws-probe: ## Also prove tool use with a tiny Converse call per Sonnet model
	$(UV) python scripts/aws_check.py --probe

seed: ## Load seed data (data/seed) into the mock SAP SQLite DB; DAY0=YYYY-MM-DD optional
	$(UV) python -m services.sap_mock.seed $(if $(DAY0),--day0 $(DAY0),)

sap-mock: ## Run the mock S/4HANA API on :8001
	$(UV) uvicorn --factory services.sap_mock.app:create_app --host 127.0.0.1 --port 8001 --reload

solver: ## Run the solver API on :8002
	$(UV) uvicorn --factory services.solver.app:create_app --host 127.0.0.1 --port 8002 --reload

solver-demo: ## Print risk + options A, B (first solve), B (replan) from the seed data
	$(UV) python scripts/solver_demo.py $(if $(DAY0),--day0 $(DAY0),)

policy-demo: ## Show Tier 2 allowed, Tier 3 blocked/approved, Rp 60M escalated + audit chain
	$(UV) python scripts/policy_demo.py

demo-reset: ## Restore demo state (via the running mock SAP, else directly in SQLite)
	$(UV) python scripts/demo_reset.py

demo-inputs: ## Regenerate data/demo/forwarder_notice.pdf
	$(UV) python scripts/make_demo_inputs.py

# ---- Targets below are filled in by later phases ----
define not_yet
	@echo "'$@' is implemented in Phase $(1)."; exit 1
endef

api: ## Run the Case API on :8000 (EMBEDDED_SAP=1 to skip the separate mock SAP)
	$(UV) uvicorn --factory api.app:create_app --host 127.0.0.1 --port 8000

web: ## Run the dashboard on :3000 (proxies /api to SIAGA_API_URL, default :8000)
	cd web && npm run dev

web-check: ## Typecheck, lint and production-build the dashboard
	cd web && npx tsc --noEmit && npx eslint . && npx next build

web-smoke: ## Playwright smoke test of the full demo (starts its own API + dashboard)
	./scripts/web_smoke.sh

web-smoke-replay: ## Same on the golden recording; checks the REPLAY badge
	SMOKE_LLM=replay ./scripts/web_smoke.sh

dev: ## Run mock SAP (:8001), Case API (:8000) and dashboard (:3000) together; Ctrl-C stops all
	@trap 'kill 0' INT TERM EXIT; \
	$(UV) uvicorn --factory services.sap_mock.app:create_app --host 127.0.0.1 --port 8001 & \
	$(UV) uvicorn --factory api.app:create_app --host 127.0.0.1 --port 8000 & \
	(cd web && npm run dev) & \
	wait

demo: ## Run the demo case from the CLI (LLM per .env; auto-approve; VERIFY after 5 s)
	$(UV) python -m agent.run --whatsapp data/demo/whatsapp_driver.txt \
		--pdf data/demo/forwarder_notice.pdf --auto-approve --verify-delay 5

demo-fake: ## Same with the scripted fake LLM (no AWS needed)
	$(UV) python -m agent.run --whatsapp data/demo/whatsapp_driver.txt \
		--pdf data/demo/forwarder_notice.pdf --auto-approve --verify-delay 1 --provider fake

eval-perceive: ## PERCEIVE accuracy on data/demo/perceive_testset.jsonl (needs Bedrock)
	$(UV) python scripts/eval_perceive.py

replay: ## Full stack (mock SAP + API + dashboard) on the golden recording; no Bedrock calls
	REPLAY=1 $(MAKE) dev

replay-cli: ## The golden recording through the CLI (instant)
	REPLAY=1 REPLAY_SPEED=0 $(UV) python -m agent.run --whatsapp data/demo/whatsapp_driver.txt \
		--pdf data/demo/forwarder_notice.pdf --auto-approve --verify-delay 1 --embedded-sap

record-golden: ## Record the golden run with the LLM from .env (accepted only if it hits 11.4M)
	$(UV) python scripts/record_golden.py

rehearse: ## Reset, run, approve, verify N times via the Case API (N=10); report in var/rehearse/
	$(UV) python scripts/rehearse.py -n $(N)

rehearse-fault: ## Same, but inject a delayed transfer: passes only if VERIFY re-opens the case
	$(UV) python scripts/rehearse.py -n $(N) --inject transfer_delayed

preflight: ## Demo-day checklist: services up, LLM reachable or golden recording present
	$(UV) python scripts/preflight.py

destroy: ## Tear down all AWS resources (Phase 7)
	$(call not_yet,7)
