"""The locked scenario of brief §2.1, read back through the mock SAP API."""

from siaga_common.timeline import day_offset, from_iso
from tests.conftest import DAY0


def one(sap, path):
    r = sap.get(path)
    assert r.status_code == 200, r.text
    return r.json()


def test_inbound_po(sap):
    po = one(sap, "/A_PurchaseOrder('4500018231')")
    assert po["Supplier"] == "V-1001"
    assert po["IncotermsClassification"] == "DDP"
    assert po["YY1_TransportLane"] == "SMG-JKT"
    item = one(sap, "/A_PurchaseOrderItem?$filter=PurchaseOrder eq '4500018231'")["value"][0]
    assert (item["Material"], item["Plant"], item["OrderQuantity"]) == ("MG-2L", "DC-CKR", 1200)
    assert day_offset(DAY0, from_iso(item["YY1_ScheduledDeliveryDateTime"])) == (1, "10:00")


def test_sales_orders(sap):
    sos = {s["SalesOrder"]: s for s in one(sap, "/A_SalesOrder")["value"]}
    assert set(sos) == {"SO-7001", "SO-7002"}
    so1, so2 = sos["SO-7001"], sos["SO-7002"]
    assert so1["YY1_SoldToPartyName"] == "Mitra Retail Nusantara"
    assert (so1["RequestedQuantity"], so1["YY1_PenaltyAmountIDR"]) == (700, 250_000_000)
    assert so1["YY1_PenaltyType"] == "OTIF_PENALTY"
    assert so2["YY1_SoldToPartyName"] == "Grosir Sentosa"
    assert (so2["RequestedQuantity"], so2["YY1_PenaltyAmountIDR"]) == (300, 90_000_000)
    assert so2["YY1_PenaltyType"] == "LOST_MARGIN"
    for so in (so1, so2):
        assert so["Plant"] == "DC-CKR"
        assert day_offset(DAY0, from_iso(so["YY1_LoadingCutoffDateTime"])) == (2, "18:00")


def test_stock(sap):
    ckr = one(sap, "/A_MaterialStock(Material='MG-2L',Plant='DC-CKR')")
    bdg = one(sap, "/A_MaterialStock(Material='MG-2L',Plant='DC-BDG')")
    assert (ckr["OnHandQuantity"], ckr["SafetyStockQuantity"]) == (200, 100)
    assert (bdg["OnHandQuantity"], bdg["SafetyStockQuantity"]) == (800, 400)


def test_suppliers(sap):
    v1 = one(sap, "/A_Supplier('V-1001')")
    v2 = one(sap, "/A_Supplier('V-2002')")
    fwd = one(sap, "/A_Supplier('F-3001')")
    assert v1["SupplierName"] == "PT Sumber Pangan Semarang"
    assert v1["YY1_DefaultIncoterm"] == "DDP"
    assert v2["SupplierName"] == "PT Agro Pangan Tangerang"
    assert v2["Region"] == "Jabodetabek"
    assert (v2["YY1_LeadTimeDays"], v2["YY1_CapacityCartons"]) == (1, 600)
    assert v2["YY1_PremiumPerCartonIDR"] == 15_000
    assert v2["YY1_DefaultIncoterm"] == "DDP"
    assert fwd["SupplierName"] == "PT Lintas Cargo Nusantara"


def test_lanes_and_air_quote(sap):
    lane = one(sap, "/A_TransportLane('BDG-CKR')")
    assert lane["CostPerTruckIDR"] == 1_950_000
    assert lane["CapacityPerTruckCartons"] == 250
    assert lane["TransitHours"] == 8
    assert lane["IsReversibleInternal"] is True
    assert lane["Corridor"] != "Pantura"
    assert one(sap, "/A_TransportLane('SMG-JKT')")["Corridor"] == "Pantura"
    quote = one(sap, "/A_FreightQuote('Q-AIR-0001')")
    assert (quote["PriceIDR"], quote["PricingBasis"]) == (31_000_000, "FLAT")
    assert quote["YY1_ArrivalDate"] == "2026-10-31"  # day 2


def test_product_and_plants(sap):
    assert one(sap, "/A_Product('MG-2L')")["YY1_UnitsPerCarton"] == 12
    plants = {p["Plant"] for p in one(sap, "/A_Plant")["value"]}
    assert plants == {"DC-CKR", "DC-BDG", "DC-SMG"}
