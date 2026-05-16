"""Vercel Python serverless entrypoint for the IF Maker FastAPI backend.

Vercel's Python runtime serves the module-level ASGI ``app`` object directly.
The sys.path insert makes the backend package root (main.py, routes/, services/)
importable from inside the ``api/`` directory.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import app  # noqa: E402,F401  (exported for the Vercel runtime)
