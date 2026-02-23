#!/usr/bin/env python3

import argparse
import math
import re
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


def lane_group(lane: str) -> str:
    parts = lane.split("/")
    if len(parts) < 2:
        return lane
    return f"{parts[0]}/{parts[1]}"


def geomean(values: list[float]) -> float:
    if not values:
        return 0.0
    log_sum = sum(math.log(value) for value in values)
    return math.exp(log_sum / len(values))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Summarize speedups by benchmark lane group."
    )
    parser.add_argument(
        "--baseline",
        required=True,
        help="Path to baseline benchmark output.",
    )
    parser.add_argument(
        "--candidate",
        required=True,
        help="Path to candidate benchmark output.",
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

    baseline = parse_file(Path(args.baseline))
    candidate = parse_file(Path(args.candidate))

    shared_lanes = sorted(set(baseline).intersection(candidate))
    lanes = [
        lane
        for lane in shared_lanes
        if selected(lane, args.include, args.exclude)
    ]

    grouped_ratios: dict[str, list[float]] = {}
    for lane in lanes:
        group = lane_group(lane)
        ratio = baseline[lane] / candidate[lane]
        grouped_ratios.setdefault(group, []).append(ratio)

    print(f"Lanes: {len(lanes)}")
    print(
        "group".ljust(36)
        + " lanes".rjust(8)
        + " geomean_speedup".rjust(18)
        + " mean_speedup".rjust(14)
    )
    for group in sorted(grouped_ratios):
        ratios = grouped_ratios[group]
        geomean_speedup = geomean(ratios)
        mean_speedup = sum(ratios) / len(ratios)
        print(
            group.ljust(36)
            + f"{len(ratios):8d}"
            + f"{geomean_speedup:18.4f}x"
            + f"{mean_speedup:14.4f}x"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
