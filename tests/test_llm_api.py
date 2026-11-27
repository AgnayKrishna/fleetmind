"""AGENT_MODE=api: Claude API through the anthropic SDK. The client is replaced by a fake,
so no test ever calls the API or needs a real key.
Run: AGENT_MODE=rules python -m pytest tests"""
import copy
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

os.environ["AGENT_MODE"] = "rules"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import llm  # noqa: E402


class FakeMessages:
    def __init__(self, reply='{"choice": "a", "reasoning": "ok"}', fail=False):
        self.reply, self.fail, self.calls = reply, fail, []

    def create(self, **kw):
        self.calls.append(kw)
        if self.fail:
            raise RuntimeError("boom")
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=self.reply)],
                               usage=SimpleNamespace(input_tokens=1000, output_tokens=200), stop_reason="end_turn")


@pytest.fixture
def api_mode(monkeypatch):
    saved_status, saved_calls, saved_client = copy.deepcopy(llm._status), list(llm._calls), llm._client
    fake = SimpleNamespace(messages=FakeMessages())
    monkeypatch.setenv("AGENT_MODE", "api")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-not-a-real-key")
    monkeypatch.setattr(llm, "_make_client", lambda: fake)
    llm._calls.clear()
    llm._status["usage"] = {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}
    assert llm.init() == "api"
    yield fake
    llm._status.clear()
    llm._status.update(saved_status)
    llm._calls.clear()
    llm._calls.extend(saved_calls)
    llm._client = saved_client


def test_api_mode_uses_sonnet_and_haiku_and_logs_cost(api_mode):
    assert llm.enabled()
    assert llm.ask_json("pick one") == {"choice": "a", "reasoning": "ok"}
    assert llm.ask("summarise", role="orchestrator")
    models = [c["model"] for c in api_mode.messages.calls]
    assert models == [llm.API_MODELS["specialist"], llm.API_MODELS["orchestrator"]]
    assert "haiku" in models[0] and "sonnet" in models[1]
    st = llm.status()
    assert st["mode"] == "api" and st["calls"] == 2 and st["errors"] == 0
    assert st["usage"]["input_tokens"] == 2000 and st["usage"]["output_tokens"] == 400
    expected = llm.estimate_cost("specialist", 1000, 200) + llm.estimate_cost("orchestrator", 1000, 200)
    assert abs(st["usage"]["cost_usd"] - round(expected, 4)) < 1e-9
    assert [c["role"] for c in st["recent_calls"]] == ["specialist", "orchestrator"]
    assert "via Claude API" in llm.model_label("orchestrator")


def test_failed_call_returns_none_so_rules_take_over(api_mode):
    api_mode.messages.fail = True
    assert llm.ask_json("pick one") is None
    st = llm.status()
    assert st["errors"] == 1 and "boom" in st["last_error"]
    assert "test-not-a-real-key" not in str(st)


def test_decision_pipeline_falls_back_to_rules_when_api_fails(api_mode):
    from backend import services
    services.get_routes = lambda a, b, alternatives=False, **kw: [services._straight_route(a, b)] * (2 if alternatives else 1)
    from backend.agents import AgentTeam
    from backend.sim import World
    api_mode.messages.fail = True
    w = World(seed=7)
    team = AgentTeam(w)
    applied = []
    team._decide("test", "Test event", {}, "Dispatch Agent", [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}],
                 {"id": "b", "why": "rules say b"}, [], lambda c: "low", applied.append)
    assert applied == ["b"]
    assert any("rules fallback" in e["text"] for e in w.log)


def test_api_mode_without_key_falls_back_to_rules(monkeypatch):
    saved = copy.deepcopy(llm._status)
    monkeypatch.setenv("AGENT_MODE", "api")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    try:
        assert llm.init() == "rules" and not llm.enabled()
        assert "ANTHROPIC_API_KEY" in llm.status()["last_error"]
    finally:
        llm._status.clear()
        llm._status.update(saved)


def test_claude_mode_still_strips_api_key(monkeypatch):
    """Claude Code mode must keep using the subscription login, never the API key."""
    seen = {}

    def fake_run(cmd, **kw):
        seen["env"] = kw["env"]
        return SimpleNamespace(returncode=0, stdout='{"result": "hi"}', stderr="")
    saved = copy.deepcopy(llm._status)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-not-a-real-key")
    monkeypatch.setattr(llm.subprocess, "run", fake_run)
    llm._status.update(mode="claude", claude_path="claude")
    try:
        assert llm.ask("hello") == "hi"
        assert "ANTHROPIC_API_KEY" not in seen["env"]
    finally:
        llm._status.clear()
        llm._status.update(saved)
