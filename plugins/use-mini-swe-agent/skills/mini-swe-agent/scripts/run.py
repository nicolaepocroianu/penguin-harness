# /// script
# requires-python = ">=3.10"
# dependencies = ["mini-swe-agent==2.4.6"]
# ///
"""Run a non-interactive coding task and preserve upstream results."""

import argparse
import contextlib
import json
import math
import os
from pathlib import Path
import sys


def positive_float(value):
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise argparse.ArgumentTypeError("must be a finite positive number")
    return number


def positive_int(value):
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return number


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cwd", type=Path, required=True)
    parser.add_argument("--task-file", type=Path, required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--cost-limit", type=positive_float, default=3.0)
    parser.add_argument("--step-limit", type=positive_int, default=50)
    parser.add_argument("--time-limit", type=positive_int, default=900)
    return parser.parse_args(argv)


def run(args):
    cwd = args.cwd.resolve(strict=True)
    if not cwd.is_dir():
        raise ValueError("--cwd must be a directory")
    task = args.task_file.read_text(encoding="utf-8-sig")
    if not task.strip():
        raise ValueError("--task-file must not be empty")
    output = args.output_dir.resolve()
    # Never overwrite an earlier run's evidence.
    output.mkdir(parents=True, exist_ok=False)
    os.environ["MSWEA_SILENT_STARTUP"] = "1"
    # Keep library diagnostics off the runner's machine-readable stdout.
    with contextlib.redirect_stdout(sys.stderr):
        from minisweagent.agents.default import DefaultAgent
        from minisweagent.config import get_config_from_spec
        from minisweagent.environments.local import LocalEnvironment
        from minisweagent.models import get_model

        config = get_config_from_spec("mini.yaml")
        config["model"]["model_name"] = args.model
        agent = DefaultAgent(
            get_model(config=config["model"]),
            LocalEnvironment(**(config["environment"] | {"cwd": str(cwd)})),
            **(config["agent"] | {
                "cost_limit": args.cost_limit,
                "step_limit": args.step_limit,
                "wall_time_limit_seconds": args.time_limit,
                "output_path": output / "trajectory.json",
            }),
        )
        result = agent.run(task)
    summary = {
        "exit_status": result.get("exit_status", "Unknown"),
        "submission": result.get("submission", ""),
        "cost": agent.cost,
        "model_calls": agent.n_calls,
        "trajectory": str(output / "trajectory.json"),
    }
    serialized = json.dumps(summary, ensure_ascii=False, indent=2)
    (output / "result.json").write_text(serialized + "\n", encoding="utf-8")
    print(serialized)
    return 0 if summary["exit_status"] == "Submitted" else 1


if __name__ == "__main__":
    sys.exit(run(parse_args()))
