"""Mock S/4HANA: OData-V4-shaped reads, two action endpoints, admin reset.

Reads (any entity set in store.KEYS):
    GET /A_PurchaseOrder?$filter=Supplier eq 'V-1001'&$select=PurchaseOrder,YY1_Status
    GET /A_PurchaseOrder('4500018231')
    GET /A_MaterialStock(Material='MG-2L',Plant='DC-CKR')
Actions:
    POST /StockTransfer        internal DC-to-DC transfer (posts immediately, IN_TRANSIT)
    POST /A_PurchaseOrder      create PO (deep insert of items; supplier confirms at once)
Admin:
    POST /admin/reset          restore the seed state (optional {"day0": "YYYY-MM-DD"})
    GET  /admin/state          day 0 and entity counts

The mock does bookkeeping only (stock movements, number ranges, confirmations). It does
not decide tiers or approvals; that is the agent's tool layer + policy engine.

Run: uvicorn --factory services.sap_mock.app:create_app --port 8001
"""

from __future__ import annotations

import re
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from services.sap_mock import odata
from services.sap_mock.seed import reset_store
from services.sap_mock.store import KEYS, SapStore, SqliteSapStore
from siaga_common.settings import get_settings
from siaga_common.timeline import to_iso

PO_NUMBER_START = 4500018232  # next number after the seeded PO 4500018231
STO_NUMBER_START = 1


class SapError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


# ---------- request models ----------


class StockTransferIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    Material: str
    FromPlant: str
    ToPlant: str
    Quantity: int = Field(gt=0)
    NumberOfTrucks: int = Field(gt=0)
    YY1_CaseId: str | None = None
    IdempotencyKey: str | None = None


class PurchaseOrderItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    Material: str
    Plant: str
    OrderQuantity: int = Field(gt=0)


class PurchaseOrderIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    Supplier: str
    IncotermsClassification: str | None = None
    to_PurchaseOrderItem: list[PurchaseOrderItemIn] = Field(min_length=1)
    YY1_CaseId: str | None = None
    YY1_ApprovalId: str | None = None
    IdempotencyKey: str | None = None


class ResetIn(BaseModel):
    day0: date | None = None


# ---------- helpers ----------

Row = dict[str, Any]

_KEY_SEGMENT = re.compile(r"^(?P<set>[A-Za-z_]+)\((?P<key>.*)\)$")
_NAMED_KEY = re.compile(r"(\w+)\s*=\s*'((?:[^']|'')*)'")


def _parse_resource(resource: str) -> tuple[str, str | None]:
    m = _KEY_SEGMENT.match(resource)
    if not m:
        return resource, None
    entity_set, raw = m.group("set"), m.group("key").strip()
    if entity_set not in KEYS:
        raise SapError(404, "NotFound", f"unknown entity set {entity_set!r}")
    fields = KEYS[entity_set]
    named = dict(_NAMED_KEY.findall(raw))
    if named:
        if set(named) != set(fields):
            raise SapError(400, "BadKey", f"{entity_set} key needs {', '.join(fields)}")
        return entity_set, "|".join(named[f].replace("''", "'") for f in fields)
    if len(fields) == 1 and raw.startswith("'") and raw.endswith("'"):
        return entity_set, raw[1:-1].replace("''", "'")
    raise SapError(400, "BadKey", f"cannot parse key {raw!r} for {entity_set}")


def _find_by(store: SapStore, entity_set: str, field: str, value: Any) -> Row | None:
    return next((r for r in store.list(entity_set) if r.get(field) == value), None)


def create_app(
    store: SapStore | None = None, clock: Callable[[], datetime] | None = None
) -> FastAPI:
    store = store or SqliteSapStore(get_settings().sap_db_path)
    now = clock or (lambda: datetime.now(UTC))
    app = FastAPI(title="SIAGA mock S/4HANA", version="0.1.0")
    app.state.store = store

    if store.get_meta("day0") is None:  # first start on an empty DB
        reset_store(store)

    @app.exception_handler(SapError)
    async def _sap_error(_: Request, exc: SapError) -> JSONResponse:
        return JSONResponse(odata.error(exc.code, exc.message), status_code=exc.status)

    @app.exception_handler(odata.ODataError)
    async def _odata_error(_: Request, exc: odata.ODataError) -> JSONResponse:
        return JSONResponse(odata.error("BadQuery", str(exc)), status_code=400)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        msg = "; ".join(f"{'.'.join(map(str, e['loc'][1:]))}: {e['msg']}" for e in exc.errors())
        return JSONResponse(odata.error("ValidationError", msg), status_code=422)

    # ----- admin -----

    @app.post("/admin/reset")
    def admin_reset(body: ResetIn | None = None) -> dict[str, Any]:
        day0 = reset_store(store, body.day0 if body else None)
        return {"status": "reset", "day0": to_iso(day0), **_state()}

    @app.get("/admin/state")
    def admin_state() -> dict[str, Any]:
        return {"day0": store.get_meta("day0"), **_state()}

    def _state() -> dict[str, Any]:
        return {"counts": {k: len(store.list(k)) for k in KEYS}}

    # ----- actions -----

    @app.post("/StockTransfer", status_code=201)
    def create_stock_transfer(body: StockTransferIn) -> JSONResponse:
        with store.transaction():
            if body.IdempotencyKey and (
                hit := _find_by(store, "StockTransfer", "IdempotencyKey", body.IdempotencyKey)
            ):
                return JSONResponse(odata.entity("StockTransfer", hit), status_code=200)
            lane = next(
                (
                    ln
                    for ln in store.list("A_TransportLane")
                    if ln["FromLocation"] == body.FromPlant and ln["ToLocation"] == body.ToPlant
                ),
                None,
            )
            if lane is None:
                raise SapError(400, "NoLane", f"no lane {body.FromPlant} -> {body.ToPlant}")
            cap = lane["CapacityPerTruckCartons"]
            if body.NumberOfTrucks * cap < body.Quantity:
                raise SapError(
                    400,
                    "TruckCapacity",
                    f"{body.NumberOfTrucks} truck(s) x {cap} cartons < {body.Quantity}",
                )
            src = store.get("A_MaterialStock", f"{body.Material}|{body.FromPlant}")
            dst = store.get("A_MaterialStock", f"{body.Material}|{body.ToPlant}")
            if src is None or dst is None:
                raise SapError(400, "NoStockRecord", "material not managed at both plants")
            if body.Quantity > src["OnHandQuantity"]:
                raise SapError(
                    400,
                    "InsufficientStock",
                    f"{body.FromPlant} has {src['OnHandQuantity']} on hand, "
                    f"requested {body.Quantity}",
                )
            n = store.next_number("StockTransfer", STO_NUMBER_START)
            posted = now()
            sto = {
                "StockTransfer": f"STO-{n:06d}",
                "Material": body.Material,
                "FromPlant": body.FromPlant,
                "ToPlant": body.ToPlant,
                "Quantity": body.Quantity,
                "NumberOfTrucks": body.NumberOfTrucks,
                "TransportLane": lane["TransportLane"],
                "FreightCostIDR": body.NumberOfTrucks * lane["CostPerTruckIDR"],
                "Status": "IN_TRANSIT",
                "PostedDateTime": to_iso(posted),
                "PlannedArrivalDateTime": to_iso(posted + timedelta(hours=lane["TransitHours"])),
                "IsReversible": bool(lane["IsReversibleInternal"]),
                "YY1_CaseId": body.YY1_CaseId,
                "IdempotencyKey": body.IdempotencyKey,
            }
            src["OnHandQuantity"] -= body.Quantity
            dst["InTransitQuantity"] += body.Quantity
            store.put("A_MaterialStock", src)
            store.put("A_MaterialStock", dst)
            store.put("StockTransfer", sto)
        return JSONResponse(odata.entity("StockTransfer", sto), status_code=201)

    @app.post("/A_PurchaseOrder", status_code=201)
    def create_purchase_order(body: PurchaseOrderIn) -> JSONResponse:
        with store.transaction():
            if body.IdempotencyKey and (
                hit := _find_by(store, "A_PurchaseOrder", "IdempotencyKey", body.IdempotencyKey)
            ):
                return JSONResponse(odata.entity("A_PurchaseOrder", hit), status_code=200)
            supplier = store.get("A_Supplier", body.Supplier)
            if supplier is None or supplier["YY1_SupplierRole"] == "FORWARDER":
                raise SapError(400, "BadSupplier", f"{body.Supplier} is not a goods supplier")
            for it in body.to_PurchaseOrderItem:
                if store.get("A_Product", it.Material) is None:
                    raise SapError(400, "BadMaterial", f"unknown material {it.Material}")
                if store.get("A_Plant", it.Plant) is None:
                    raise SapError(400, "BadPlant", f"unknown plant {it.Plant}")
                approved = supplier.get("YY1_ApprovedMaterials")
                if approved is not None and it.Material not in approved:
                    raise SapError(
                        400, "NotApproved", f"{body.Supplier} not approved for {it.Material}"
                    )

            created = now()
            remaining = _remaining_capacity(store, supplier)
            po_number = str(store.next_number("PurchaseOrder", PO_NUMBER_START))
            items, all_confirmed = [], True
            lead = supplier.get("YY1_LeadTimeDays")
            premium = supplier.get("YY1_PremiumPerCartonIDR")
            for idx, it in enumerate(body.to_PurchaseOrderItem, start=1):
                confirmed = it.OrderQuantity
                if remaining is not None:
                    confirmed = min(confirmed, remaining)
                    remaining -= confirmed
                all_confirmed &= confirmed == it.OrderQuantity
                items.append(
                    {
                        "PurchaseOrder": po_number,
                        "PurchaseOrderItem": str(idx * 10),
                        "Material": it.Material,
                        "Plant": it.Plant,
                        "OrderQuantity": it.OrderQuantity,
                        "PurchaseOrderQuantityUnit": "CAR",
                        "YY1_ConfirmedQuantity": confirmed,
                        "YY1_ScheduledDeliveryDateTime": (
                            to_iso(created + timedelta(days=lead)) if lead is not None else None
                        ),
                        "YY1_PremiumAmountIDR": premium * confirmed if premium else None,
                    }
                )
            po = {
                "PurchaseOrder": po_number,
                "PurchaseOrderType": "NB",
                "Supplier": body.Supplier,
                "IncotermsClassification": body.IncotermsClassification
                or supplier.get("YY1_DefaultIncoterm"),
                "DocumentCurrency": "IDR",
                "CreationDateTime": to_iso(created),
                "YY1_Status": "CONFIRMED" if all_confirmed else "PARTIALLY_CONFIRMED",
                "YY1_ShipmentStatus": "NOT_SHIPPED",
                "YY1_Forwarder": None,
                "YY1_TransportLane": None,
                "YY1_CaseId": body.YY1_CaseId,
                "YY1_ApprovalId": body.YY1_ApprovalId,
                "IdempotencyKey": body.IdempotencyKey,
            }
            store.put("A_PurchaseOrder", po)
            for item in items:
                store.put("A_PurchaseOrderItem", item)
        return JSONResponse(
            odata.entity("A_PurchaseOrder", {**po, "to_PurchaseOrderItem": items}), status_code=201
        )

    # ----- generic reads (registered last so the routes above win) -----

    @app.get("/")
    def service_document() -> dict[str, Any]:
        return {
            "@odata.context": "$metadata",
            "value": [{"name": s, "kind": "EntitySet", "url": s} for s in KEYS],
        }

    @app.get("/{resource}")
    def read(
        resource: str,
        filter_: str | None = Query(None, alias="$filter"),
        select: str | None = Query(None, alias="$select"),
        top: int | None = Query(None, alias="$top"),
        orderby: str | None = Query(None, alias="$orderby"),
    ) -> dict[str, Any]:
        entity_set, key = _parse_resource(resource)
        if entity_set not in KEYS:
            raise SapError(404, "NotFound", f"unknown entity set {entity_set!r}")
        if key is not None:
            row = store.get(entity_set, key)
            if row is None:
                raise SapError(404, "NotFound", f"{entity_set}({key}) does not exist")
            if select:
                row = odata.apply_query([row], select=select)[0]
            return odata.entity(entity_set, row)
        rows = odata.apply_query(
            store.list(entity_set), filter_=filter_, select=select, top=top, orderby=orderby
        )
        return odata.collection(entity_set, rows)

    return app


def _remaining_capacity(store: SapStore, supplier: Row) -> int | None:
    """Supplier capacity minus quantities already confirmed on POs created since reset."""
    cap = supplier.get("YY1_CapacityCartons")
    if cap is None:
        return None
    new_pos = {
        po["PurchaseOrder"]
        for po in store.list("A_PurchaseOrder")
        if po["Supplier"] == supplier["Supplier"] and po.get("CreationDateTime")
    }
    used = sum(
        it["YY1_ConfirmedQuantity"]
        for it in store.list("A_PurchaseOrderItem")
        if it["PurchaseOrder"] in new_pos
    )
    return max(cap - used, 0)
