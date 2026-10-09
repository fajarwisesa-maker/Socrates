---
id: P-012
title: Phantom stock at a donor DC breaks a transfer plan
period: 2024-08
tags: [data_quality, cycle_count, stock_transfer]
synthetic: true
---
> **SYNTHETIC** precedent written for the SIAGA hackathon demo. Companies are fictional and costs are illustrative.

**Situation.** During a supplier delay the planner arranged a transfer of 300 cartons from a West Java DC, based on the system figure. At loading, only 120 cartons could be found. The rest had been damaged weeks earlier and never written off.

**Action.** The truck left with 120 cartons. The planner bought the missing 180 cartons from an alternate supplier at short notice, at a higher premium than a planned order would have cost.

**Cost and outcome.** Transfer Rp 1.95M, rush bridge premium Rp 3.8M. One order shipped four hours late with a Rp 5M fee.

**Lesson.** Before a large transfer, ask the donor DC to confirm physical stock. When data quality is in doubt, plan a bridge order for part of the quantity as a hedge.
