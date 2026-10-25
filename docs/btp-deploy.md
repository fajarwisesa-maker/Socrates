# Deploy the mock S/4HANA to SAP BTP Cloud Foundry (v2 step 1)

The same mock S/4HANA as `make sap-mock`, on the team's Cloud Foundry space. The CF org is
shared with other teams, so every request needs the `X-API-Key` header. Turn it on for the
agent with `SAP_MOCK_ON_BTP=1`; nothing else changes.

Run these from your laptop (bash / WSL), in the repo with the latest branch.

## 1. Once: the cf CLI

Install cf CLI v8 (the Cloud Foundry CLI installation guide; on Ubuntu/WSL the
`cf8-cli` apt package from Cloud Foundry's repository). Check with `cf version`.

## 2. Build the package

```bash
make btp-package          # -> build/btp/ (mock + seed + requirements.txt + runtime.txt + manifest.yml)
```

## 3. Log in and target the team space

The API endpoint is in the BTP cockpit: subaccount > Overview > Cloud Foundry Environment
(for example `https://api.cf.<region>.hana.ondemand.com`).

```bash
cf login -a <API endpoint> --sso        # or: cf login -a <API endpoint> -u <your e-mail>
cf target -o <org> -s <team space>
```

## 4. Push without starting, set the key, start

```bash
cd build/btp
cf push --no-start                       # app "siaga-sap-mock", 512M, 1 instance, random route

# a new random key; it never goes into a file in the repo or into a chat
export SAP_MOCK_API_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
cf set-env siaga-sap-mock SAP_MOCK_API_KEY "$SAP_MOCK_API_KEY"
cf start siaga-sap-mock
cf app siaga-sap-mock                    # "routes:" shows the URL
cd ../..
```

Keep the key: put it in your local `.env` as `SAP_MOCK_API_KEY=...` (git-ignored).

## 5. Check it

```bash
URL=https://<route from cf app>
curl -s -o /dev/null -w "%{http_code}\n" "$URL/A_Plant"                            # 401
curl -s -H "X-API-Key: $SAP_MOCK_API_KEY" "$URL/admin/state"                       # day0, counts
```

## 6. Point SIAGA at it

In `.env`:

```ini
SAP_MOCK_ON_BTP=1
SAP_MOCK_BTP_URL=https://<route>
SAP_MOCK_API_KEY=<the key>
```

```bash
make demo-reset                          # re-seeds the BTP copy (its SQLite is ephemeral)
make sap-latency                         # round-trip latency from this machine to BTP
LLM_PROVIDER=fake make rehearse N=3      # the full demo against the BTP-hosted mock
```

Send the app URL (no key) and the output of the last two commands back.

## Notes

- Logs: `cf logs siaga-sap-mock --recent`. Restart: `cf restart siaga-sap-mock`.
- A restart or restage wipes the SQLite file; the app seeds itself on start, and
  `make demo-reset` sets day 0 to today.
- The health check is a port check, so no endpoint is open without the key.
- Turn it off: `SAP_MOCK_ON_BTP=0` (or remove the line) and SIAGA uses localhost again.
- Remove it after Demo Day: `cf delete siaga-sap-mock -r`.
