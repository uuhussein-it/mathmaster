"""
SAT MathMaster - PythonAnywhere WSGI entry point.

Steps after deploy:
  1. In the PythonAnywhere "Web" tab, create a new web app:
       - Manual configuration -> Python 3.10 (or 3.11)
  2. Set "Virtualenv path" (make it *before* the manual config, or create it in
     the Consoles tab):  /home/<username>/.virtualenvs/sat
       and install deps:  pip install -r requirements.txt
  3. Set the WSGI configuration file path to point to this file.
  4. Reload the web app.
"""

import os
import sys

# Root of the project on PythonAnywhere, e.g. /home/hussein/sat-math-site
PROJECT = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(PROJECT, "backend")

sys.path.insert(0, BACKEND)

os.chdir(PROJECT)

from app import app as application  # noqa: E402