#!/usr/bin/env python3

import argparse
import re
import statistics
from pathlib import Path


ENTRY_PATTERN = re.compile(
    r"^(greedy_mesher/.*|non_greedy_mesher/.*|uncached_mesher/.*)$"
)
TIME_PATTERN = re.compile(r"time:\s+\[(.*?)\]")


def to_microseconds(value: float, unit: str) -> float:
    if unit == "ms":
        return value * 1000.0
    if unit in {"µs", "us"}:
        return value
    if unit == "ns":
        return value / 1000.0
    raise ValueError(f"Unsupported time unit: {unit}")


def parse_file(path: Path) -> dict[str, float]:
    lines = path.read_text().splitlines()
    medians: dict[str, float] = {}

    for index, line in enumerate(lines):
        entry_match = ENTRY_PATTERN.match(line.strip())
        if not entry_match:
            continue

        for next_index in range(index + 1, min(index + 8, len(lines))):
            time_match = TIME_PATTERN.search(lines[next_index])
            if not time_match:
                continue

            tokens = time_match.group(1).replace(",", "").split()
            values: list[tuple[float, str]] = []
            token_index = 0
            while token_index + 1 < len(tokens):
                try:
                    number = float(tokens[token_index])
                    unit = tokens[token_index + 1]
                    values.append((number, unit))
                    token_index += 2
                except ValueError:
                    token_index += 1

            if len(values) >= 2:
                median_value, median_unit = values[1]
                medians[entry_match.group(1)] = to_microseconds(median_value, median_unit)
            break

    return medians


def selected(lane: str, includes: list[str], excludes: list[str]) -> bool:
    if includes and not any(re.search(pattern, lane) for pattern in includes):
        return False
    if excludes and any(re.search(pattern, lane) for pattern in excludes):
        return False
    return True


def metric(values: list[float], metric_name: str) -> float:
    if metric_name == "mean":
        return statistics.mean(values)
    return statistics.median(values)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare benchmark medians across baseline and candidate run sets."
    )
    parser.add_argument(
        "--baseline",
        action="append",
        required=True,
        help="Baseline benchmark output file path (repeatable).",
    )
    parser.add_argument(
        "--candidate",
        action="append",
        required=True,
        help="Candidate benchmark output file path (repeatable).",
    )
    parser.add_argument(
        "--include",
        action="append",
        default=[],
        help="Regex lane include filter (repeatable).",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        help="Regex lane exclude filter (repeatable).",
    )
    parser.add_argument(
        "--metric",
        choices=["mean", "median"],
        default="mean",
        help="Aggregate metric used for baseline and candidate sets.",
    )
    parser.add_argument(
        "--max-regression-pct",
        type=float,
        default=None,
        help="Optional failure threshold for candidate regressions.",
    )
    args = parser.parse_args()

    baseline_runs = [parse_file(Path(path)) for path in args.baseline]
    candidate_runs = [parse_file(Path(path)) for path in args.candidate]

    shared_lanes = set(baseline_runs[0]).intersection(candidate_runs[0])
    for run in baseline_runs[1:]:
        shared_lanes &= set(run)
    for run in candidate_runs[1:]:
        shared_lanes &= set(run)

    lanes = sorted(
        lane
        for lane in shared_lanes
        if selected(lane, args.include, args.exclude)
    )

    regressions: list[tuple[str, float, float, float]] = []

    print(f"Baseline runs: {len(baseline_runs)}")
    print(f"Candidate runs: {len(candidate_runs)}")
    print(f"Lanes: {len(lanes)}")
    print(
        "benchmark".ljust(64)
        + " baseline(us)".rjust(14)
        + " candidate(us)".rjust(16)
        + " delta".rjust(10)
        + " b-σ".rjust(10)
        + " c-σ".rjust(10)
    )

    for lane in lanes:
        baseline_values = [run[lane] for run in baseline_runs]
        candidate_values = [run[lane] for run in candidate_runs]

        baseline_metric = metric(baseline_values, args.metric)
        candidate_metric = metric(candidate_values, args.metric)
        delta_pct = ((candidate_metric - baseline_metric) / baseline_metric) * 100.0

        baseline_stdev = statistics.pstdev(baseline_values)
        candidate_stdev = statistics.pstdev(candidate_values)

        print(
            lane.ljust(64)
            + f"{baseline_metric:14.3f}"
            + f"{candidate_metric:16.3f}"
            + f"{delta_pct:9.2f}%"
            + f"{baseline_stdev:10.3f}"
            + f"{candidate_stdev:10.3f}"
        )

        if (
            args.max_regression_pct is not None
            and delta_pct > args.max_regression_pct
        ):
            regressions.append(
                (lane, baseline_metric, candidate_metric, delta_pct)
            )

    if args.max_regression_pct is not None:
        print(
            f"Regression gate: +{args.max_regression_pct:.2f}% max "
            "allowed increase"
        )
        if regressions:
            print("Regressions above threshold:")
            for lane, baseline_value, candidate_value, delta_pct in regressions:
                print(
                    f"  {lane}: baseline={baseline_value:.3f}us "
                    f"candidate={candidate_value:.3f}us delta=+{delta_pct:.2f}%"
                )
            return 1
        print("No regressions above threshold.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
