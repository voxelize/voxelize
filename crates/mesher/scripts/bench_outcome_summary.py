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


def selected(lane: str, includes: list[str], excludes: list[str]) -> bool:
    if includes and not any(re.search(pattern, lane) for pattern in includes):
        return False
    if excludes and any(re.search(pattern, lane) for pattern in excludes):
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Summarize improved/regressed/neutral benchmark lane outcomes."
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
        "--neutral-band-pct",
        type=float,
        default=1.0,
        help="Absolute percentage treated as neutral (default: 1.0).",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=10,
        help="How many best/worst lanes to print (default: 10).",
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
    lanes = sorted(set(baseline).intersection(candidate))
    lanes = [
        lane
        for lane in lanes
        if selected(lane, args.include, args.exclude)
    ]

    outcomes: list[tuple[str, float, float, float]] = []
    improved = 0
    regressed = 0
    neutral = 0
    for lane in lanes:
        baseline_value = baseline[lane]
        candidate_value = candidate[lane]
        delta_pct = ((candidate_value - baseline_value) / baseline_value) * 100.0
        outcomes.append((lane, baseline_value, candidate_value, delta_pct))
        if delta_pct < -args.neutral_band_pct:
            improved += 1
        elif delta_pct > args.neutral_band_pct:
            regressed += 1
        else:
            neutral += 1

    print(f"Total lanes: {len(lanes)}")
    print(f"Neutral band: ±{args.neutral_band_pct:.2f}%")
    print(f"Improved: {improved}")
    print(f"Regressed: {regressed}")
    print(f"Neutral: {neutral}")

    print("\nLargest regressions:")
    print(
        "benchmark".ljust(64)
        + " baseline(us)".rjust(14)
        + " candidate(us)".rjust(16)
        + " delta".rjust(10)
    )
    for lane, baseline_value, candidate_value, delta_pct in sorted(
        outcomes, key=lambda item: item[3], reverse=True
    )[: args.top]:
        print(
            lane.ljust(64)
            + f"{baseline_value:14.3f}"
            + f"{candidate_value:16.3f}"
            + f"{delta_pct:9.2f}%"
        )

    print("\nLargest improvements:")
    print(
        "benchmark".ljust(64)
        + " baseline(us)".rjust(14)
        + " candidate(us)".rjust(16)
        + " delta".rjust(10)
    )
    for lane, baseline_value, candidate_value, delta_pct in sorted(
        outcomes, key=lambda item: item[3]
    )[: args.top]:
        print(
            lane.ljust(64)
            + f"{baseline_value:14.3f}"
            + f"{candidate_value:16.3f}"
            + f"{delta_pct:9.2f}%"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
