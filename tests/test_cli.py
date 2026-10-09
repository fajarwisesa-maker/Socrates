"""CLI smoke test: full case with the fake LLM and the embedded mock SAP."""

from agent.run import main
from siaga_common.settings import REPO_ROOT

DEMO = REPO_ROOT / "data" / "demo"


def test_cli_runs_demo_to_resolved(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "siaga.db"))
    monkeypatch.setenv("AUDIT_DIR", str(tmp_path / "audit"))
    from siaga_common.settings import get_settings

    get_settings.cache_clear()
    code = main(
        [
            "--whatsapp", str(DEMO / "whatsapp_driver.txt"),
            "--pdf", str(DEMO / "forwarder_notice.pdf"),
            "--provider", "fake", "--embedded-sap", "--auto-approve",
            "--verify-delay", "0", "--plain",
        ]
    )  # fmt: skip
    get_settings.cache_clear()
    out = capsys.readouterr().out
    assert code == 0
    assert "status RESOLVED" in out
    assert "Critic rejected option B1" in out
    assert "chosen B2 Rp 11.400.000" in out
    assert "STO-000001" in out and "4500018232" in out
