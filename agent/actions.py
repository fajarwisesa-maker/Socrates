"""Map solver plan actions to tool calls (deterministic; the LLM never builds these)."""

from __future__ import annotations

from typing import Any

from services.solver.models import PlannedAction

TOOL_FOR = {
    "stock_transfer": "execute_stock_transfer",
    "alternate_supplier": "create_purchase_order",
    "spot_air": "book_spot_air",
    "reschedule_customer": "reschedule_customer_order",
}


def tool_call_for(action: PlannedAction, material: str, plant: str) -> tuple[str, dict[str, Any]]:
    if action.kind == "stock_transfer":
        args = {
            "material": material,
            "from_plant": action.reference,
            "to_plant": plant,
            "quantity": action.quantity,
            "trucks": action.trucks,
        }
    elif action.kind == "alternate_supplier":
        args = {
            "supplier": action.reference,
            "material": material,
            "plant": plant,
            "quantity": action.quantity,
        }
    elif action.kind == "spot_air":
        args = {"quote": action.reference, "quantity": action.quantity}
    else:
        args = {"sales_order": action.reference}
    return TOOL_FOR[action.kind], args


def describe(action: PlannedAction, plant: str) -> str:
    return {
        "stock_transfer": f"Transfer {action.quantity} cartons {action.reference} -> {plant} "
        f"({action.trucks} truck(s))",
        "alternate_supplier": f"Bridge PO to {action.reference} for {action.quantity} cartons "
        f"delivered to {plant}",
        "spot_air": f"Air charter {action.reference} for {action.quantity} cartons to {plant}",
        "reschedule_customer": f"Reschedule customer order {action.reference}",
    }[action.kind]
