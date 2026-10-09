# Seed data — locked demo scenario (build brief §2.1)

Do not change values here without agreeing it with the product owner; tests assert them.

- One file per OData entity set of the mock S/4HANA (`services/sap_mock`).
- Field names follow S/4HANA API conventions where natural; `YY1_*` fields are custom
  extension fields (the SAP naming convention for key-user extensibility).
- Times are relative to day 0 (midnight WIB on the case start date):
  `{"day": 1, "time": "10:00"}` → UTC ISO timestamp, `{"day": 2}` → ISO date.
  They are resolved when the seed is loaded (`make seed` / `POST /admin/reset`).
- `null` means the brief gives no value. Nothing here is invented beyond identifiers
  (customer IDs, forwarder ID, lane IDs, quote ID).
- Quantities are cartons (`CAR`, carton of 12 × 2L). Money is IDR.
