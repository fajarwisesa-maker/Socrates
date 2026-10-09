.DEFAULT_GOAL := help
SHELL := /bin/bash
UV := uv run
N ?= 10

.PHONY: help install dev test lint fmt aws-check aws-probe seed sap-mock solver solver-demo policy-demo demo-inputs demo demo-fake eval-perceive demo-reset replay rehearse destroy

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

install: ## Install Python deps and pre-commit hook
	uv sync
	$(UV) pre-commit install

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

dev: ## Run mock SAP, solver, Case API and dashboard locally (Phase 5)
	$(call not_yet,5)

demo: ## Run the demo case from the CLI (LLM per .env; auto-approve; VERIFY after 5 s)
	$(UV) python -m agent.run --whatsapp data/demo/whatsapp_driver.txt \
		--pdf data/demo/forwarder_notice.pdf --auto-approve --verify-delay 5

demo-fake: ## Same with the scripted fake LLM (no AWS needed)
	$(UV) python -m agent.run --whatsapp data/demo/whatsapp_driver.txt \
		--pdf data/demo/forwarder_notice.pdf --auto-approve --verify-delay 1 --provider fake

eval-perceive: ## PERCEIVE accuracy on data/demo/perceive_testset.jsonl (needs Bedrock)
	$(UV) python scripts/eval_perceive.py

replay: ## Run the full system on the recorded golden run (Phase 6)
	$(call not_yet,6)

rehearse: ## Reset, run, approve, verify; loop N times (Phase 6)
	$(call not_yet,6)

destroy: ## Tear down all AWS resources (Phase 7)
	$(call not_yet,7)
