import pytest

from siaga_common.money import format_idr


@pytest.mark.parametrize(
    "amount,text",
    [
        (11_400_000, "Rp 11.400.000"),
        (340_000_000, "Rp 340.000.000"),
        (15_000, "Rp 15.000"),
        (0, "Rp 0"),
        (-19_600_000, "-Rp 19.600.000"),
    ],
)
def test_format_idr(amount, text):
    assert format_idr(amount) == text
