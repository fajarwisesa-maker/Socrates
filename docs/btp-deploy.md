# Deploy the mock S/4HANA to SAP BTP Cloud Foundry (v2 step 1)

App name: **`siaga-sap-mock`**. It is the same mock S/4HANA as `make sap-mock`, running in
the team's Cloud Foundry space. The CF org is shared with other teams, so every request
needs the `X-API-Key` header. SIAGA uses it in mode local (`SAP_MOCK_ON_BTP=1`, set by
`make use-local`).

The deploy files are committed in `deploy/btp/`:

- `manifest.yml`: app `siaga-sap-mock`, 512M, 1 instance, `python_buildpack`, random
  route, port health check, start command
  `python -m uvicorn --factory services.sap_mock.app:create_app --host 0.0.0.0 --port $PORT`;
- `requirements.txt`: pinned to this repo's locked versions, installed by the buildpack with pip;
- `runtime.txt`: Python 3.12;
- `.cfignore`.

`make btp-package` copies them, with the mock's code and seed data, into `build/btp/`. You
push from that folder.

Run everything from your laptop (bash / WSL), in the repo on the latest branch.

## 1. Once: the cf CLI

Install cf CLI v8: on Ubuntu/WSL, the `cf8-cli` apt package from Cloud Foundry's
repository (see the CF CLI installation guide). Check with `cf version`; it should print 8.x.

## 2. Log in and target the team space

The API endpoint is in the BTP cockpit, under subaccount → Overview → Cloud Foundry
Environment, for example `https://api.cf.<region>.hana.ondemand.com`. The org and space
names are on the same page.

```bash
cf login -a <API endpoint> --sso        # or: cf login -a <API endpoint> -u <your e-mail>
cf target -o <org> -s <space>
cf apps                                  # the space as it is now
```

## 3. Package and push without starting

```bash
make btp-package                         # -> build/btp/ (code + seed + the deploy/btp files)
cd build/btp
cf push --no-start                       # creates siaga-sap-mock from manifest.yml (no staging yet)
```

## 4. Set the key, then start

The key is generated in your terminal. It never goes into a file in the repo, a command
you paste into a chat, or a chat message.

```bash
SAP_MOCK_API_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
cf set-env siaga-sap-mock SAP_MOCK_API_KEY "$SAP_MOCK_API_KEY"
unset SAP_MOCK_API_KEY
cf start siaga-sap-mock                  # stages with python_buildpack, then starts
cf app siaga-sap-mock                    # "routes:" is the URL; state "running"
cd ../..
```

If you need the key again, `cf env siaga-sap-mock` shows it under "User-Provided".

## 5. Check it

```bash
URL=https://<route from cf app>
curl -s -o /dev/null -w "%{http_code}\n" "$URL/A_Plant"      # 401: the key is enforced
```

## 6. Point SIAGA at it

```bash
scripts/fill-env.sh        # asks for SAP_MOCK_BTP_URL (the https route) and SAP_MOCK_API_KEY (hidden)
make use-local
make demo-reset            # re-seeds the BTP copy: day 0 = today
make sap-latency           # round trips from the laptop to BTP
make preflight             # "BTP mock — key required and accepted" must be ✅
```

## Updating the app later

```bash
make btp-package && (cd build/btp && cf push)     # keeps the env vars (the key) and the route
make demo-reset
```

## If the key changes

Run this in your own terminal; the key is typed hidden and never echoed:

```bash
read -r -s -p "new SAP_MOCK_API_KEY: " SAP_MOCK_API_KEY; echo
cf set-env siaga-sap-mock SAP_MOCK_API_KEY "$SAP_MOCK_API_KEY"
unset SAP_MOCK_API_KEY
cf restage siaga-sap-mock                # picks up the new key; the app re-seeds on start
scripts/fill-env.sh                      # the same key into .env.local, then: make use-local
make demo-reset
make preflight
```

(Only the AWS production design also needs `AWS_PROFILE=siaga scripts/put-sap-secret.sh`.)

## Notes

- Logs: `cf logs siaga-sap-mock --recent`. Restart: `cf restart siaga-sap-mock`.
- A restart or restage wipes the SQLite file. The app seeds itself on start, and
  `make demo-reset` sets day 0 to today.
- The health check is a port check, so no endpoint is open without the key.
- To turn it off, set `SAP_MOCK_ON_BTP=0` (or `make use-replay` / `make use-v1`). SIAGA then
  uses the local mock again.
- To remove it after Demo Day: `cf delete siaga-sap-mock -r`.
