"""Run the Alice Blue unit suite using the project's existing venv packages.

Does not install anything: it only adds the local .venv site-packages and the
module directory to sys.path, then runs unittest discovery. This is a local
verification helper; it is not part of the live service.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VENV_SP = os.path.join(HERE, ".venv", "Lib", "site-packages")
if os.path.isdir(VENV_SP):
    sys.path.insert(0, VENV_SP)
sys.path.insert(0, HERE)

import unittest  # noqa: E402

loader = unittest.defaultTestLoader
suite = loader.discover(HERE, pattern="test_*.py")
runner = unittest.TextTestRunner(verbosity=2)
result = runner.run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
