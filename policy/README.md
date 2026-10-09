# policy/

- `siaga.cedar` — authority-tier policies (brief §2.3). Every policy has an `@id`.
- `siaga.cedarschema` — entity, action and context schema; policies are validated
  against it in tests. `agent/policy.py` generates the `action` list from the tool
  registry, so the schema file holds the shared context type only.

Principal `Agent::"siaga"`, resource `Case::"<case_id>"`, action `Action::"<tool name>"`.
The Rp 50,000,000 threshold also exists in code (`agent/tools/base.py`
`TIER2_MAX_IDR`) for the in-code check; a test keeps the two in sync.
