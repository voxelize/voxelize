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


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Aggregate benchmark medians across multiple output files."
    )
    parser.add_argument(
        "--input",
        action="append",
        required=True,
        help="Benchmark output file path (repeatable).",
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
    args = parser.parse_args()

    parsed_runs = [parse_file(Path(path)) for path in args.input]
    shared_lanes = set(parsed_runs[0])
    for run in parsed_runs[1:]:
        shared_lanes &= set(run)

    lanes = sorted(
        lane
        for lane in shared_lanes
        if selected(lane, args.include, args.exclude)
    )

    print(f"Runs: {len(parsed_runs)}")
    print(f"Lanes: {len(lanes)}")
    print(
        "benchmark".ljust(64)
        + " mean(us)".rjust(12)
        + " median(us)".rjust(14)
        + " stdev(us)".rjust(12)
    )

    for lane in lanes:
        values = [run[lane] for run in parsed_runs]
        mean_value = statistics.mean(values)
        median_value = statistics.median(values)
        stdev_value = statistics.pstdev(values)
        print(
            lane.ljust(64)
            + f"{mean_value:12.3f}"
            + f"{median_value:14.3f}"
            + f"{stdev_value:12.3f}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
