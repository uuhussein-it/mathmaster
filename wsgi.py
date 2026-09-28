import os
import sys

# Render (and most hosts) run from the repo root.
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "backend"))

os.chdir(ROOT)

from app import app as application  # noqa: E402

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    application.run(host="0.0.0.0", port=port)
