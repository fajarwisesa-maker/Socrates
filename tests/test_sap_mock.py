"""Mock S/4HANA API behaviour: OData shape, actions, reset."""

from siaga_common.timeline import to_iso
from tests.conftest import NOW

TRANSFER = {
    "Material": "MG-2L",
    "FromPlant": "DC-BDG",
    "ToPlant": "DC-CKR",
    "Quantity": 400,
    "NumberOfTrucks": 2,
    "YY1_CaseId": "case-1",
}
BRIDGE_PO = {
    "Supplier": "V-2002",
    "to_PurchaseOrderItem": [{"Material": "MG-2L", "Plant": "DC-CKR", "OrderQuantity": 500}],
    "YY1_CaseId": "case-1",
    "YY1_ApprovalId": "apr-1",
}


def stock(sap, plant):
    return sap.get(f"/A_MaterialStock(Material='MG-2L',Plant='{plant}')").json()


# ---- OData shape ----


def test_collection_envelope_filter_select(sap):
    r = sap.get(
        "/A_SalesOrder",
        params={"$filter": "YY1_PenaltyAmountIDR gt 100000000", "$select": "SalesOrder"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["@odata.context"] == "$metadata#A_SalesOrder"
    assert body["value"] == [{"SalesOrder": "SO-7001"}]


def test_entity_by_key_and_errors(sap):
    r = sap.get("/A_Supplier('V-2002')", params={"$select": "Supplier,SupplierName"})
    assert r.json() == {
        "@odata.context": "$metadata#A_Supplier/$entity",
        "Supplier": "V-2002",
        "SupplierName": "PT Agro Pangan Tangerang",
    }
    assert sap.get("/A_Supplier('NOPE')").json()["error"]["code"] == "NotFound"
    assert sap.get("/A_Nothing").status_code == 404
    bad = sap.get("/A_SalesOrder", params={"$filter": "Plant eq"})
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "BadQuery"


def test_service_document_lists_entity_sets(sap):
    names = {e["name"] for e in sap.get("/").json()["value"]}
    assert {"A_PurchaseOrder", "A_PurchaseOrderItem", "A_SalesOrder", "A_MaterialStock"} <= names
    assert {"A_Supplier", "StockTransfer"} <= names


# ---- StockTransfer ----


def test_stock_transfer_posts_and_moves_stock(sap):
    r = sap.post("/StockTransfer", json=TRANSFER)
    assert r.status_code == 201, r.text
    sto = r.json()
    assert sto["StockTransfer"] == "STO-000001"
    assert sto["Status"] == "IN_TRANSIT"
    assert sto["FreightCostIDR"] == 3_900_000
    assert sto["PostedDateTime"] == to_iso(NOW)
    assert sto["PlannedArrivalDateTime"] == "2026-10-29T10:00:00Z"  # day 0 17:00 WIB (+8 h)
    assert stock(sap, "DC-BDG")["OnHandQuantity"] == 400
    assert stock(sap, "DC-CKR")["InTransitQuantity"] == 400
    # status read used by VERIFY
    got = sap.get("/StockTransfer('STO-000001')").json()
    assert (got["Quantity"], got["Status"]) == (400, "IN_TRANSIT")


def test_stock_transfer_is_idempotent(sap):
    body = {**TRANSFER, "IdempotencyKey": "case-1:transfer"}
    first = sap.post("/StockTransfer", json=body)
    again = sap.post("/StockTransfer", json=body)
    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json()["StockTransfer"] == first.json()["StockTransfer"]
    assert stock(sap, "DC-BDG")["OnHandQuantity"] == 400  # moved once


def test_stock_transfer_validation(sap):
    too_few_trucks = sap.post("/StockTransfer", json={**TRANSFER, "Quantity": 750})
    assert too_few_trucks.json()["error"]["code"] == "TruckCapacity"
    too_much = sap.post("/StockTransfer", json={**TRANSFER, "Quantity": 900, "NumberOfTrucks": 4})
    assert too_much.json()["error"]["code"] == "InsufficientStock"
    no_lane = sap.post("/StockTransfer", json={**TRANSFER, "FromPlant": "DC-SMG"})
    assert no_lane.json()["error"]["code"] == "NoLane"
    negative = sap.post("/StockTransfer", json={**TRANSFER, "Quantity": -1})
    assert negative.status_code == 422
    assert stock(sap, "DC-BDG")["OnHandQuantity"] == 800  # nothing moved


def test_mock_sap_does_not_enforce_safety_stock(sap):
    """Safety stock is a business rule for the Critic, not an SAP posting rule."""
    r = sap.post("/StockTransfer", json={**TRANSFER, "Quantity": 750, "NumberOfTrucks": 3})
    assert r.status_code == 201
    assert stock(sap, "DC-BDG")["OnHandQuantity"] == 50


# ---- Purchase order create ----


def test_create_bridge_po_confirms(sap):
    r = sap.post("/A_PurchaseOrder", json=BRIDGE_PO)
    assert r.status_code == 201, r.text
    po = r.json()
    assert po["PurchaseOrder"] == "4500018232"
    assert po["YY1_Status"] == "CONFIRMED"
    assert po["IncotermsClassification"] == "DDP"  # supplier default
    item = po["to_PurchaseOrderItem"][0]
    assert item["YY1_ConfirmedQuantity"] == 500
    assert item["YY1_PremiumAmountIDR"] == 7_500_000
    assert item["YY1_ScheduledDeliveryDateTime"] == "2026-10-30T02:00:00Z"  # +1 day lead time
    # status read used by VERIFY
    header = sap.get("/A_PurchaseOrder('4500018232')").json()
    assert (header["YY1_Status"], header["YY1_ApprovalId"]) == ("CONFIRMED", "apr-1")
    items = sap.get(
        "/A_PurchaseOrderItem", params={"$filter": "PurchaseOrder eq '4500018232'"}
    ).json()["value"]
    assert [i["OrderQuantity"] for i in items] == [500]


def test_po_confirmation_capped_by_supplier_capacity(sap):
    sap.post("/A_PurchaseOrder", json=BRIDGE_PO)  # 500 of 600
    r = sap.post("/A_PurchaseOrder", json=BRIDGE_PO).json()
    assert r["YY1_Status"] == "PARTIALLY_CONFIRMED"
    assert r["to_PurchaseOrderItem"][0]["YY1_ConfirmedQuantity"] == 100


def test_po_validation(sap):
    fwd = sap.post("/A_PurchaseOrder", json={**BRIDGE_PO, "Supplier": "F-3001"})
    assert fwd.json()["error"]["code"] == "BadSupplier"
    bad_item = {"Material": "XX", "Plant": "DC-CKR", "OrderQuantity": 1}
    bad_mat = sap.post("/A_PurchaseOrder", json={**BRIDGE_PO, "to_PurchaseOrderItem": [bad_item]})
    assert bad_mat.json()["error"]["code"] == "BadMaterial"
    assert sap.post("/A_PurchaseOrder", json={**BRIDGE_PO, "extra": 1}).status_code == 422


# ---- reset ----


def test_admin_reset_restores_seed(sap):
    sap.post("/StockTransfer", json=TRANSFER)
    sap.post("/A_PurchaseOrder", json=BRIDGE_PO)
    r = sap.post("/admin/reset", json={"day0": "2026-10-29"})
    assert r.status_code == 200
    assert r.json()["day0"] == "2026-10-28T17:00:00Z"
    assert r.json()["counts"]["StockTransfer"] == 0
    assert r.json()["counts"]["A_PurchaseOrder"] == 1
    assert stock(sap, "DC-BDG")["OnHandQuantity"] == 800
    assert stock(sap, "DC-CKR")["InTransitQuantity"] == 0
    # number ranges restart too
    assert sap.post("/StockTransfer", json=TRANSFER).json()["StockTransfer"] == "STO-000001"
    assert sap.post("/A_PurchaseOrder", json=BRIDGE_PO).json()["PurchaseOrder"] == "4500018232"
