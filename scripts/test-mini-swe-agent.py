# /// script
# requires-python = ">=3.10"
# dependencies = ["mini-swe-agent==2.4.6"]
# ///
"""Offline integration checks against the pinned upstream agent and environment."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import sys
import unittest
from unittest.mock import patch

os.environ["MSWEA_SILENT_STARTUP"] = "1"
sys.dont_write_bytecode = True
RUNNER = Path(__file__).resolve().parents[1] / "plugins/use-mini-swe-agent/skills/mini-swe-agent/scripts/run.py"
spec = importlib.util.spec_from_file_location("runner", RUNNER)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class OfflineModel:
    def __init__(self, command):
        self.command = command

    def format_message(self, **kwargs):
        return kwargs

    def get_template_vars(self):
        return {}

    def serialize(self):
        return {}

    def query(self, messages):
        return {"role": "assistant", "content": "offline check", "extra": {
            "actions": [{"command": self.command}], "cost": 0.1,
        }}

    def format_observation_messages(self, message, outputs, template_vars):
        return [{"role": "user", "content": json.dumps(outputs)}]


class RunnerTests(unittest.TestCase):
    def invoke(self, command, expected_status, expected_code):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            task = root / "task.txt"
            task.write_text("Offline test: café", encoding="utf-8")
            args = runner.parse_args([
                "--cwd", str(root), "--task-file", str(task), "--model", "offline",
                "--output-dir", str(root / "result"), "--step-limit", "1",
            ])
            # Exercise real DefaultAgent, upstream config, environment and serialization;
            # only replace the paid model call.
            with patch("minisweagent.models.get_model", return_value=OfflineModel(command)):
                with contextlib.redirect_stdout(io.StringIO()) as stdout:
                    self.assertEqual(runner.run(args), expected_code)
            summary = json.loads(stdout.getvalue())
            self.assertEqual(summary["exit_status"], expected_status)
            self.assertEqual(summary["model_calls"], 1)
            self.assertEqual(summary["cost"], 0.1)
            self.assertEqual(json.loads((root / "result/result.json").read_text()), summary)
            trajectory = json.loads(Path(summary["trajectory"]).read_text())
            self.assertEqual(trajectory["info"]["exit_status"], expected_status)
            with self.assertRaises(FileExistsError):
                runner.run(args)

    def test_submission(self):
        self.invoke("echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT", "Submitted", 0)

    def test_limit_is_failure(self):
        self.invoke("echo still-working", "LimitsExceeded", 1)

    def test_invalid_limits(self):
        for value in ["0", "-1", "nan", "inf"]:
            with self.assertRaises(runner.argparse.ArgumentTypeError):
                runner.positive_float(value)


if __name__ == "__main__":
    unittest.main()
