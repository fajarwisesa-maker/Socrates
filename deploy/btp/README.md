# Cloud Foundry deploy files for the mock S/4HANA (`siaga-sap-mock`)

These are the committed source of the BTP deployment. `make btp-package` copies them, with
the mock's code (`services/sap_mock`, `siaga_common`, `data/seed`), into `build/btp/`, the
directory you `cf push` from. Exact commands: `docs/btp-deploy.md`.

| File | Purpose |
| --- | --- |
| `manifest.yml` | app `siaga-sap-mock`: 512M, 1 instance, `python_buildpack`, random route, port health check, uvicorn start command on `$PORT` |
| `requirements.txt` | what the Python buildpack installs with pip, pinned to this repo's locked versions (a test keeps them in sync with `uv.lock`) |
| `runtime.txt` | Python 3.12 for the buildpack |
| `.cfignore` | keeps caches and the local SQLite file out of the upload |
