.DEFAULT_GOAL := help
SHELL := /bin/bash
UV := uv run
N ?= 10

.PHONY: help install dev test lint fmt aws-check aws-probe seed demo demo-reset replay rehearse destroy

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

# ---- Targets below are filled in by later phases ----
define not_yet
	@echo "'$@' is implemented in Phase $(1)."; exit 1
endef

seed: ## Load seed data into SQLite (Phase 1)
	$(call not_yet,1)

demo-reset: ## Restore mock SAP to seed state (Phase 1)
	$(call not_yet,1)

dev: ## Run mock SAP, solver, Case API and dashboard locally (Phase 5)
	$(call not_yet,5)

demo: ## Run the demo case from the CLI (Phase 4)
	$(call not_yet,4)

replay: ## Run the full system on the recorded golden run (Phase 6)
	$(call not_yet,6)

rehearse: ## Reset, run, approve, verify; loop N times (Phase 6)
	$(call not_yet,6)

destroy: ## Tear down all AWS resources (Phase 7)
	$(call not_yet,7)
