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

The agent runs in a background worker so requests return immediately; a scheduler thread
fires VERIFY when a case's verify_due_at passes.

Run: uvicorn --factory api.app:create_app --port 8000
"""

from __future__ import annotations

import logging
import threading
from collections import defaultdict
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel

from agent.case_store import NotFound
from agent.clients import HttpSapClient
from agent.machine import Agent, CaseStateError
from agent.providers import make_provider
from agent.providers.base import LLMProvider
from agent.runtime import Runtime, build_runtime
from agent.signals import build_signals
from siaga_common.settings import REPO_ROOT, Settings, get_settings

log = logging.getLogger(__name__)
DEMO = REPO_ROOT / "data" / "demo"


class ApprovalDecision(BaseModel):
    decision: Literal["approve", "reject"]
    reason: str | None = None
    by: str = "planner"


class CaseService:
    """Owns the agent, the worker pool, per-case locks and the VERIFY scheduler."""

    def __init__(
        self,
        runtime: Runtime,
        llm: LLMProvider,
        reset_sap: Callable[[], dict[str, Any]],
        workers: int = 4,
    ):
        self.rt, self.llm, self.reset_sap = runtime, llm, reset_sap
        self.agent = Agent(runtime, llm)
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="case")
        self.locks: dict[str, threading.Lock] = defaultdict(threading.Lock)
        self._stop = threading.Event()
        self._scheduler: threading.Thread | None = None

    def submit(self, case_id: str, fn: Callable[[], Any]) -> None:
        def job() -> None:
            with self.locks[case_id]:
                try:
                    fn()
                except Exception:  # noqa: BLE001 - the agent escalates; never kill the worker
                    log.exception("case %s job failed", case_id)

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
            self.agent.verify(case_id)

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
) -> FastAPI:
    s = settings or get_settings()
    if runtime is None:
        if s.embedded_sap:
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
    service = CaseService(runtime, llm or make_provider(s), reset_sap)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if background:
            service.start_scheduler()
        yield
        service.shutdown()

    app = FastAPI(title="SIAGA Case API", version="0.1.0", lifespan=lifespan)
    app.state.service = service
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

    @app.get("/config")
    def config() -> dict[str, Any]:
        return {
            "llm_provider": service.llm.name,
            "replay": s.replay or s.llm_provider == "replay",
            "model": s.bedrock_model_id if s.llm_provider == "bedrock" else None,
            "verify_delay_seconds": s.verify_delay_seconds,
            "max_tool_calls": s.max_tool_calls,
            "max_replans": s.max_replans,
            "embedded_sap": s.embedded_sap,
        }

    @app.post("/cases", status_code=202)
    async def start_case(
        whatsapp: Annotated[str | None, Form()] = None,
        pdf: Annotated[UploadFile | None, File()] = None,
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
        case = service.agent.start_case(signals)
        service.submit(case.case_id, lambda: service.agent.run(case.case_id))
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
                service.agent.decide(case_id, approval_id, approve, body.by, body.reason)
            except CaseStateError as e:
                log.warning("approval ignored: %s", e)

        service.submit(case_id, job)
        return {"case_id": case_id, "approval_id": approval_id, "decision": body.decision}

    @app.post("/demo/reset")
    def demo_reset() -> dict[str, Any]:
        sap_state = service.reset_sap()
        reset_store = getattr(store, "reset", None)
        if reset_store:
            reset_store()
        return {"status": "reset", "sap": {"day0": sap_state.get("day0")}}

    @app.get("/demo/inputs/whatsapp", response_class=PlainTextResponse)
    def demo_whatsapp() -> str:
        return (DEMO / "whatsapp_driver.txt").read_text()

    @app.get("/demo/inputs/pdf")
    def demo_pdf() -> FileResponse:
        return FileResponse(
            DEMO / "forwarder_notice.pdf",
            media_type="application/pdf",
            filename="forwarder_notice.pdf",
        )

    return app
