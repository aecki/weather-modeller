"""Ensure setup is repeatable and optional tools cannot install into base."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "src"))
import bootstrap

from weather_modeller.development import install_dev_tools, install_regional_tools


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        cache = ROOT / ".cache/tmp"
        cache.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=cache)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def test_dev_install_refuses_another_python_prefix(self):
        with patch("weather_modeller.development.subprocess.run") as install:
            with self.assertRaisesRegex(RuntimeError, "must be installed through"):
                install_dev_tools(self.root)
            install.assert_not_called()

    def test_regional_install_refuses_base_and_uses_local_interpreter(self):
        with patch("weather_modeller.development.subprocess.run") as install:
            with self.assertRaisesRegex(RuntimeError, "must be installed through"):
                install_regional_tools(self.root)
            install.assert_not_called()
        prefix = self.root / ".environments/weather-modeller"
        with (
            patch("weather_modeller.development.sys.prefix", str(prefix)),
            patch("weather_modeller.development.subprocess.run") as install,
        ):
            install_regional_tools(self.root)
        args = install.call_args.args[0]
        self.assertEqual(args[0], sys.executable)
        self.assertIn("--isolated", args)
        self.assertIn("--no-user", args)
        self.assertEqual(args[args.index("--cache-dir") + 1], str(self.root / ".cache/pip"))
        self.assertEqual(args[-1], str(self.root / "requirements-regional.txt"))

    def test_partial_environment_is_repaired_instead_of_skipped(self):
        prefix = self.root / ".environments/weather-modeller"
        (prefix / "conda-meta").mkdir(parents=True)
        (prefix / "conda-meta/history").touch()
        conda = self.root / "conda"
        conda.touch()
        with (
            patch.object(bootstrap, "ROOT", self.root),
            patch.object(bootstrap, "ENVIRONMENT", prefix),
            patch.dict(bootstrap.os.environ, {"CONDA_EXE": str(conda)}),
            patch.object(bootstrap.subprocess, "run") as command,
            patch.object(sys, "argv", ["bootstrap.py"]),
        ):
            bootstrap.main()
        self.assertEqual(command.call_args.args[0][1:3], ["env", "update"])
        env = command.call_args.kwargs["env"]
        self.assertEqual(env["CONDA_REGISTER_ENVS"], "false")
        self.assertEqual(env["CONDA_PKGS_DIRS"], str(self.root / ".cache/conda"))
        self.assertEqual(env["PYTHONNOUSERSITE"], "1")
