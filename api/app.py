"""Case API: start cases, poll events, decide approvals, reset the demo.

    POST /cases                                  multipart: whatsapp (text), pdf (file) -> 202
    GET  /cases                                  list
    GET  /cases/{id}                             case record + approvals
    GET  /cases/{id}/events?after=<seq>          events after seq (poll every 1 s)
    GET  /cases/{id}/audit                       audit trail + hash-chain verification
    POST /cases/{id}/approvals/{approval_id}     {"decision": "approve"|"reject", "reason"?}
    POST /demo/reset                             restore SAP seed state, clear cases
    GET  /demo/inputs/whatsapp | /demo/inputs/pdf   the demo inputs, for preload buttons
    GET  /config                                 provider, replay flag, limits (UI badges)
    GET  /health/connections?deep=1              what this process can reach (make preflight)

With CASE_API_KEY set, every request except GET /health needs `X-API-Key`. With
FLAGS_SOURCE=ssm the flags are read from SSM at the start of each case, and the case keeps
the agent it started with (docs/connections.md).

The agent runs in a background worker so requests return immediately; a scheduler thread
fires VERIFY when a case's verify_due_at passes.

Run: uvicorn --factory api.app:create_app --port 8000
"""

from __future__ import annotations

import hmac
import json
import logging
import threading
from collections import defaultdict
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel

from agent.case_store import NotFound
from agent.clients import HttpSapClient, SapError
from agent.factory import make_agent
from agent.machine import Agent, CaseStateError
from agent.pii import mask_sender_id
from agent.providers import make_provider
from agent.providers.base import LLMProvider
from agent.runtime import Runtime, build_runtime
from agent.signals import build_signals
from api.connections import check_connections
from api.whatsapp_notify import CloudApiSender, OutcomeNotifier
from siaga_common.settings import REPO_ROOT, Settings, get_settings
from siaga_common.sources import (
    CASE_FLAGS,
    ConfigSourceError,
    SsmFlags,
    overlay,
    snapshot,
    with_secrets,
)

log = logging.getLogger(__name__)
DEMO = REPO_ROOT / "data" / "demo"


def _golden_meta(s: Settings) -> dict[str, Any] | None:
    meta = s.replay_path.parent / "meta.json"
    if not meta.exists():
        return None
    m = json.loads(meta.read_text(encoding="utf-8"))
    return {k: m.get(k) for k in ("provider", "model", "recorded_at")}


def _sap_info(s: Settings) -> dict[str, Any]:
    from urllib.parse import urlparse

    if s.sap_mock_on_btp:
        return {"mode": "btp", "host": urlparse(s.sap_mock_btp_url or "").hostname}
    if s.embedded_sap:
        return {"mode": "embedded", "host": None}
    return {"mode": "local", "host": urlparse(s.sap_mock_url).hostname}


def _specialists(registered: list[str]) -> list[dict[str, Any]]:
    from agent.multi.specialists import SPECIALISTS

    return [
        {
            "name": sp.name,
            "stages": list(sp.stages),
            "allowlist": sorted(t for t in sp.allowlist if t in registered),
            "uses_llm_for": sp.uses_llm_for,
        }
        for sp in SPECIALISTS
    ]


class ApprovalDecision(BaseModel):
    decision: Literal["approve", "reject"]
    reason: str | None = None
    by: str = "planner"


class CaseService:
    """Owns the agents, the worker pool, per-case locks and the VERIFY scheduler.

    With a flag reader (FLAGS_SOURCE=ssm), each new case reads the flags and gets the agent
    built for those values (built once per distinct set, sharing the store, audit, KB and
    solver); approvals and VERIFY of that case use the same agent, found from the flags
    stored on the case.
    """

    def __init__(
        self,
        runtime: Runtime,
        llm: LLMProvider,
        reset_sap: Callable[[], dict[str, Any]],
        workers: int = 4,
        flags: SsmFlags | None = None,
        notifier: OutcomeNotifier | None = None,
    ):
        self.rt, self.llm, self.reset_sap = runtime, llm, reset_sap
        self.notifier = notifier  # WhatsApp option B: reply with the outcome
        self.agent = make_agent(runtime, llm)
        self.flag_reader = flags
        self._agents: dict[tuple[tuple[str, str], ...], Agent] = {
            self._key(snapshot(runtime.settings)): self.agent
        }
        self._last_flags: dict[str, str] | None = None
        self._agents_lock = threading.Lock()
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="case")
        self.locks: dict[str, threading.Lock] = defaultdict(threading.Lock)
        self._stop = threading.Event()
        self._scheduler: threading.Thread | None = None

    @staticmethod
    def _key(flags: dict[str, str]) -> tuple[tuple[str, str], ...]:
        return tuple(sorted((k, v) for k, v in flags.items() if k in CASE_FLAGS))

    def current_flags(self) -> tuple[dict[str, str], str | None]:
        """(case flags for the next case, warning). SSM errors fall back to the last values
        read (else the startup values) and say so; they never stop a case."""
        if self.flag_reader is None:
            return snapshot(self.rt.settings), None
        try:
            values = {k: v for k, v in self.flag_reader.read().items() if k in CASE_FLAGS}
            self._last_flags = values
            return values, None
        except ConfigSourceError as e:
            log.warning("flags: %s", e)
            fallback = self._last_flags or snapshot(self.rt.settings)
            return fallback, f"{e}; using the last flags read"

    def agent_for(self, flags: dict[str, str]) -> Agent:
        base = self.rt.settings
        # "" = not set (e.g. no BEDROCK_MODEL_ID); the key is what the settings end up as,
        # so the flags read from SSM and the full set stored on a case find the same agent
        s = overlay(base, {k: v for k, v in flags.items() if k in CASE_FLAGS and v != ""})
        key = self._key(snapshot(s))
        with self._agents_lock:
            if key not in self._agents:
                rt = build_runtime(
                    s,
                    # the BTP flag picks the SAP endpoint; otherwise keep this process's SAP
                    sap=self.rt.sap if s.sap_mock_on_btp == base.sap_mock_on_btp else None,
                    solver=self.rt.solver,
                    store=self.rt.store,
                    audit=self.rt.audit,
                    kb=self.rt.kb,
                    clock=self.rt.clock,
                )
                replaying = s.replay or s.llm_provider == "replay"
                same_llm = (s.llm_provider, s.replay, s.bedrock_model_id) == (
                    base.llm_provider,
                    base.replay,
                    base.bedrock_model_id,
                ) and (
                    not replaying or s.replay_path == base.replay_path  # multi has its own
                )
                self._agents[key] = make_agent(rt, self.llm if same_llm else make_provider(s))
            return self._agents[key]

    def agent_for_case(self, case_id: str) -> Agent:
        flags = self.rt.store.get_case(case_id).flags
        return self.agent_for(flags) if flags else self.agent

    def current_agent(self) -> tuple[Agent, str | None]:
        flags, warning = self.current_flags()
        return self.agent_for(flags), warning

    def submit(self, case_id: str, fn: Callable[[], Any]) -> None:
        def job() -> None:
            with self.locks[case_id]:
                try:
                    fn()
                except Exception:  # noqa: BLE001 - the agent escalates; never kill the worker
                    log.exception("case %s job failed", case_id)
                if self.notifier is not None:
                    try:
                        self.notifier.after_job(self.rt, case_id)
                    except Exception:  # noqa: BLE001 - a reply never affects the case
                        log.exception("case %s: outcome notification failed", case_id)

        self.pool.submit(job)

    def start_scheduler(self, interval_s: float = 1.0) -> None:
        def loop() -> None:
            while not self._stop.wait(interval_s):
                self.tick()

        self._scheduler = threading.Thread(target=loop, name="verify-scheduler", daemon=True)
        self._scheduler.start()

    def tick(self) -> list[str]:
        """Submit VERIFY for every case whose verify_due_at has passed."""
        ids = [c.case_id for c in self.rt.store.list_cases(status="VERIFYING")]
        due = self.agent.due_verifications(ids)
        for cid in due:
            self.submit(cid, lambda cid=cid: self._verify_if_due(cid))
        return due

    def _verify_if_due(self, case_id: str) -> None:
        if case_id in self.agent.due_verifications([case_id]):  # re-check under the lock
            self.agent_for_case(case_id).verify(case_id)

    def shutdown(self) -> None:
        self._stop.set()
        self.pool.shutdown(wait=False, cancel_futures=True)


def _http_reset(sap: HttpSapClient) -> Callable[[], dict[str, Any]]:
    def reset() -> dict[str, Any]:
        return sap.post("/admin/reset", {})

    return reset


def create_app(
    settings: Settings | None = None,
    *,
    runtime: Runtime | None = None,
    llm: LLMProvider | None = None,
    reset_sap: Callable[[], dict[str, Any]] | None = None,
    background: bool = True,
    notifier: OutcomeNotifier | None = None,
) -> FastAPI:
    s = with_secrets(settings or get_settings())  # SECRETS_SOURCE=aws: siaga/sap, once
    whatsapp_inbound = s.whatsapp_inbound  # a process setting (the webhook app), not a case flag
    if runtime is None:
        if s.embedded_sap and not s.sap_mock_on_btp:  # the BTP flag wins
            from services.sap_mock.embedded import embedded_sap

            sap, sap_store = embedded_sap()
            runtime = build_runtime(s, sap=sap)

            def embedded_reset() -> dict[str, Any]:
                from services.sap_mock.seed import reset_store
                from siaga_common.timeline import to_iso

                return {"day0": to_iso(reset_store(sap_store))}

            reset_sap = reset_sap or embedded_reset
        else:
            runtime = build_runtime(s)
    if reset_sap is None:
        reset_sap = _http_reset(runtime.sap)  # type: ignore[arg-type]
    flags = SsmFlags(s.aws_region) if s.flags_source == "ssm" else None
    if notifier is None and s.whatsapp_notify:
        notifier = OutcomeNotifier(CloudApiSender(s))
    service = CaseService(
        runtime, llm or make_provider(s), reset_sap, flags=flags, notifier=notifier
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if background:
            service.start_scheduler()
        yield
        service.shutdown()

    app = FastAPI(title="SIAGA Case API", version="0.1.0", lifespan=lifespan)
    app.state.service = service
    if s.case_api_key:
        expected = s.case_api_key.get_secret_value().encode()

        @app.middleware("http")
        async def _require_api_key(request: Request, call_next):
            open_path = request.url.path == "/health" or request.method == "OPTIONS"
            given = request.headers.get("x-api-key", "").encode()
            if not open_path and not hmac.compare_digest(given, expected):
                return JSONResponse({"detail": "missing or wrong X-API-Key"}, status_code=401)
            return await call_next(request)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    store = runtime.store

    def get_case_or_404(case_id: str):
        try:
            return store.get_case(case_id)
        except NotFound as e:
            raise HTTPException(404, f"case {case_id} not found") from e

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/connections")
    def connections(deep: bool = False) -> dict[str, Any]:
        """What this process can reach, for `make preflight`. Never returns a secret value;
        `deep=1` also makes one Bedrock call and one RPT-1.6 call."""
        agent, warning = service.current_agent()
        return check_connections(agent.rt.settings, agent.rt, deep=deep, flags_warning=warning)

    @app.get("/config")
    def config() -> dict[str, Any]:
        agent, _ = service.current_agent()
        s = agent.rt.settings
        return {
            "llm_provider": service.llm.name,
            "orchestration": s.orchestration,
            "delay_model": s.delay_model,
            "specialists": _specialists(agent.rt.registry.names())
            if s.orchestration == "multi"
            else [],
            "replay": s.replay or s.llm_provider == "replay",
            "model": {"bedrock": s.bedrock_model_id, "sap_genai": s.sap_genai_model}.get(
                s.llm_provider
            ),
            # LLM_FALLBACK: a case may run on Claude via SAP AI Core (UI note from its events)
            "llm_fallback": {"provider": s.llm_fallback, "model": s.sap_genai_model}
            if s.llm_fallback
            else None,
            "verify_delay_seconds": s.verify_delay_seconds,
            "max_tool_calls": s.max_tool_calls,
            "max_replans": s.max_replans,
            "embedded_sap": s.embedded_sap,
            "replay_source": _golden_meta(s) if (s.replay or s.llm_provider == "replay") else None,
            # v2: what each box of the architecture runs on in this process (Architecture view)
            "pii_masking": s.pii_masking,
            "joule_approvals": False,  # v2 step 4 not built (JOULE_APPROVALS is ignored)
            "flags_source": s.flags_source,
            # WhatsApp inbound: the dashboard then follows cases it did not start itself
            "whatsapp_inbound": whatsapp_inbound,
            "whatsapp_notify": notifier is not None,
            "sap": _sap_info(s),
            "backends": {
                "case_store": s.case_store,
                "audit": s.audit_backend,
                "kb": s.kb_backend,
                "policy": s.policy_backend,
                "solver": s.solver_backend,
            },
        }

    @app.post("/cases", status_code=202)
    async def start_case(
        whatsapp: Annotated[str | None, Form()] = None,
        pdf: Annotated[UploadFile | None, File()] = None,
        # set by the WhatsApp webhook (api/whatsapp.py); absent for the dashboard buttons
        source_channel: Annotated[str | None, Form()] = None,
        source_ref: Annotated[str | None, Form()] = None,
        source_sender: Annotated[str | None, Form()] = None,
        source_received_at: Annotated[str | None, Form()] = None,
    ) -> dict[str, Any]:
        pdf_bytes = await pdf.read() if pdf is not None else None
        if not (whatsapp and whatsapp.strip()) and not pdf_bytes:
            raise HTTPException(422, "give a WhatsApp text and/or a PDF")
        try:
            signals = build_signals(
                whatsapp, pdf_bytes or None, pdf.filename if pdf is not None else None
            )
        except Exception as e:  # noqa: BLE001 - unreadable PDF
            raise HTTPException(422, f"could not read the PDF: {e}") from e
        if source_channel == "whatsapp_api":
            # the case and the UI get the masked sender; the full one is audited below
            for sig in signals:
                if sig["type"] == "whatsapp":
                    sig |= {
                        "via": source_channel,
                        "sender": mask_sender_id(source_sender),
                        "received_at": source_received_at,
                    }
        agent, warning = service.current_agent()
        case = agent.start_case(signals)
        if warning:
            agent.rt.audit.append(case.case_id, "flags_warning", {"warning": warning})
        if source_channel:
            agent.rt.audit.append(
                case.case_id,
                "signal_received",
                {
                    "channel": source_channel,
                    "message_id": source_ref,
                    "sender": source_sender,
                    "received_at": source_received_at,
                },
            )
        service.submit(case.case_id, lambda: agent.run(case.case_id))
        return {"case_id": case.case_id, "status": case.status}

    @app.get("/cases")
    def list_cases() -> dict[str, Any]:
        return {
            "cases": [
                {"case_id": c.case_id, "status": c.status, "created_at": c.created_at}
                for c in store.list_cases()
            ]
        }

    @app.get("/cases/{case_id}")
    def get_case(case_id: str) -> dict[str, Any]:
        case = get_case_or_404(case_id)
        return {
            "case": case.model_dump(mode="json"),
            "approvals": [a.model_dump(mode="json") for a in store.list_approvals(case_id)],
        }

    @app.get("/cases/{case_id}/events")
    def events(case_id: str, after: int = -1) -> dict[str, Any]:
        get_case_or_404(case_id)
        evs = store.list_events(case_id, after=after)
        return {
            "events": [e.model_dump(mode="json") for e in evs],
            "last_seq": evs[-1].seq if evs else after,
        }

    @app.get("/cases/{case_id}/audit")
    def audit(case_id: str) -> dict[str, Any]:
        get_case_or_404(case_id)
        return {
            "entries": [e.model_dump(mode="json") for e in runtime.audit.read(case_id)],
            "verification": runtime.audit.verify(case_id).model_dump(),
        }

    @app.post("/cases/{case_id}/approvals/{approval_id}", status_code=202)
    def decide(case_id: str, approval_id: str, body: ApprovalDecision) -> dict[str, Any]:
        case = get_case_or_404(case_id)
        if case.status != "AWAITING_APPROVAL":
            raise HTTPException(409, f"case is {case.status}, not awaiting approval")
        if not any(
            a.get("approval_id") == approval_id and a["status"] == "PENDING_APPROVAL"
            for a in case.actions
        ):
            raise HTTPException(409, f"approval {approval_id} is not pending on this case")
        approve = body.decision == "approve"

        def job() -> None:
            try:
                service.agent_for_case(case_id).decide(
                    case_id, approval_id, approve, body.by, body.reason
                )
            except CaseStateError as e:
                log.warning("approval ignored: %s", e)

        service.submit(case_id, job)
        return {"case_id": case_id, "approval_id": approval_id, "decision": body.decision}

    @app.post("/demo/reset")
    def demo_reset() -> dict[str, Any]:
        sap = service.current_agent()[0].rt.sap  # the BTP copy when the flags say so
        sap_state = service.reset_sap() if sap is runtime.sap else _http_reset(sap)()  # type: ignore[arg-type]
        reset_store = getattr(store, "reset", None)
        if reset_store:
            reset_store()
        return {"status": "reset", "sap": {"day0": sap_state.get("day0")}}

    @app.post("/demo/inject", include_in_schema=False)
    def demo_inject(body: dict[str, Any]) -> dict[str, Any]:
        """Hidden: forward a fault to the mock SAP (makes VERIFY fail). Not in the UI."""
        try:
            return service.current_agent()[0].rt.sap.post("/admin/inject", body)
        except SapError as e:
            raise HTTPException(e.status, e.message) from e

    @app.get("/demo/inputs/whatsapp", response_class=PlainTextResponse)
    def demo_whatsapp() -> str:
        return (DEMO / "whatsapp_driver.txt").read_text(encoding="utf-8")

    @app.get("/demo/inputs/pdf")
    def demo_pdf() -> FileResponse:
        return FileResponse(
            DEMO / "forwarder_notice.pdf",
            media_type="application/pdf",
            filename="forwarder_notice.pdf",
        )

    return app
