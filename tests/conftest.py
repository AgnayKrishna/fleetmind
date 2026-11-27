"""Shared pytest setup: rules mode and a throwaway SQLite database, so tests never touch backend/fleetmind.db."""
import os
import tempfile
from pathlib import Path

os.environ["AGENT_MODE"] = "rules"
os.environ.setdefault("DATABASE_URL", f"sqlite:///{Path(tempfile.mkdtemp(prefix='fleetmind-test-')) / 'test.db'}")
