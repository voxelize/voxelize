#!/usr/bin/env python3

import argparse
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


def lane_selected(lane: str, include_patterns: list[str], exclude_patterns: list[str]) -> bool:
    if include_patterns:
        if not any(re.search(pattern, lane) for pattern in include_patterns):
            return False
    if exclude_patterns:
        if any(re.search(pattern, lane) for pattern in exclude_patterns):
            return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fail if benchmark median regression exceeds threshold."
    )
    parser.add_argument("--baseline", required=True, help="Path to baseline benchmark output.")
    parser.add_argument("--candidate", required=True, help="Path to candidate benchmark output.")
    parser.add_argument(
        "--max-regression-pct",
        type=float,
        default=1.0,
        help="Maximum allowed regression percentage before failing.",
    )
    parser.add_argument(
        "--include",
        action="append",
        default=[],
        help="Regex lane filters to include (can be repeated).",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        help="Regex lane filters to exclude (can be repeated).",
    )
    args = parser.parse_args()

    baseline = parse_file(Path(args.baseline))
    candidate = parse_file(Path(args.candidate))
    shared_lanes = sorted(set(baseline).intersection(candidate))
    selected_lanes = [
        lane
        for lane in shared_lanes
        if lane_selected(lane, args.include, args.exclude)
    ]

    regressions: list[tuple[str, float, float, float]] = []
    for lane in selected_lanes:
        baseline_value = baseline[lane]
        candidate_value = candidate[lane]
        delta_pct = ((candidate_value - baseline_value) / baseline_value) * 100.0
        if delta_pct > args.max_regression_pct:
            regressions.append((lane, baseline_value, candidate_value, delta_pct))

    print(
        f"Checked {len(selected_lanes)} lanes "
        f"(threshold: +{args.max_regression_pct:.2f}% max regression)"
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
