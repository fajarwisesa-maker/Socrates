---
id: P-008
title: Power outage stops warehouse system at a Surabaya DC
period: 2025-01
tags: [it_outage, warehouse, surabaya, manual_process]
synthetic: true
---
> **SYNTHETIC** precedent written for the SIAGA hackathon demo. Companies are fictional and costs are illustrative.

**Situation.** A grid failure and a generator fault stopped the warehouse management system at a Surabaya DC for 14 hours. Picking and goods issue could not be posted, and 22 outbound loads for East Java customers were due that day.

**Action.** The DC switched to paper pick lists for the six largest orders and posted the goods issues in SAP once power returned. Smaller orders were moved to the next morning after calls to each customer.

**Cost and outcome.** Overtime of Rp 6.2M and one small late-delivery fee of Rp 3M. Inventory records were reconciled the next day with a cycle count.

**Lesson.** IT outages need a manual fallback for priority orders. Always reconcile stock after manual postings before trusting the system figures for new decisions.
