"""Shared pytest setup: rules mode and a throwaway SQLite database, so tests never touch backend/fleetmind.db."""
import os
import tempfile
from pathlib import Path

os.environ["AGENT_MODE"] = "rules"
os.environ["FLEETMIND_NO_DOTENV"] = "1"
for _k in ("TOMTOM_API_KEY", "HERE_API_KEY", "ANTHROPIC_API_KEY", "ROUTING_PROVIDER"):
    os.environ.pop(_k, None)          # tests never call paid APIs; they mock them
os.environ.setdefault("DATABASE_URL", f"sqlite:///{Path(tempfile.mkdtemp(prefix='fleetmind-test-')) / 'test.db'}")
