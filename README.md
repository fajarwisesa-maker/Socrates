# SIAGA — Supply Intelligence Agent for Guarding Availability

Hackathon prototype of a supervised AI agent for Indonesian FMCG supply chains: it reads
informal disruption signals, maps them to POs, SKUs and customer orders, costs mitigation
options with a deterministic solver, auto-executes low-risk actions and escalates the rest
to a human planner.

See [CLAUDE.md](CLAUDE.md) for how to run, configuration, architecture and decisions.

```bash
uv sync && make test
```
