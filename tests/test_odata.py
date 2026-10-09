import pytest

from services.sap_mock.odata import ODataError, apply_query, parse_filter

ROWS = [
    {"Id": "A", "Plant": "DC-CKR", "Qty": 200, "Eta": "2026-10-30T03:00:00Z", "Name": "Cikarang"},
    {"Id": "B", "Plant": "DC-BDG", "Qty": 800, "Eta": "2026-10-31T03:00:00Z", "Name": "Bandung"},
    {"Id": "C", "Plant": "DC-SMG", "Qty": None, "Eta": None, "Name": "O'Brien"},
]


def ids(pred):
    return [r["Id"] for r in ROWS if pred(r)]


@pytest.mark.parametrize(
    "expr,expected",
    [
        ("Plant eq 'DC-CKR'", ["A"]),
        ("Plant ne 'DC-CKR'", ["B", "C"]),
        ("Qty gt 200", ["B"]),
        ("Qty ge 200 and Plant eq 'DC-BDG'", ["B"]),
        ("Plant eq 'DC-CKR' or Plant eq 'DC-SMG'", ["A", "C"]),
        ("not (Plant eq 'DC-CKR')", ["B", "C"]),
        ("Qty eq null", ["C"]),
        ("Eta lt 2026-10-31T00:00:00Z", ["A"]),
        ("Eta le 2026-10-31T10:00:00+07:00", ["A", "B"]),  # offset normalised to UTC
        ("contains(Name,'and')", ["B"]),
        ("startswith(Plant,'DC-B')", ["B"]),
        ("Name eq 'O''Brien'", ["C"]),
        ("", ["A", "B", "C"]),
    ],
)
def test_filter(expr, expected):
    assert ids(parse_filter(expr)) == expected


@pytest.mark.parametrize("expr", ["Plant eq", "Plant like 'x'", "(Plant eq 'A'", "Plant eq 'A' x"])
def test_bad_filter_raises(expr):
    with pytest.raises(ODataError):
        parse_filter(expr)


def test_select_top_orderby():
    out = apply_query(ROWS, select="Id,Qty", orderby="Qty desc", top=2)
    assert out == [{"Id": "B", "Qty": 800}, {"Id": "A", "Qty": 200}]
