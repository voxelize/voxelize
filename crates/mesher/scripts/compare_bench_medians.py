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
        match = ENTRY_PATTERN.match(line.strip())
        if not match:
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
                medians[match.group(1)] = to_microseconds(median_value, median_unit)
            break

    return medians


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare Criterion benchmark medians across two output files."
    )
    parser.add_argument("--baseline", required=True, help="Path to baseline output file.")
    parser.add_argument("--candidate", required=True, help="Path to candidate output file.")
    args = parser.parse_args()

    baseline = parse_file(Path(args.baseline))
    candidate = parse_file(Path(args.candidate))
    shared_keys = sorted(set(baseline).intersection(candidate))

    print(f"Compared benches: {len(shared_keys)}")
    print(
        "benchmark".ljust(64)
        + " baseline(us)".rjust(14)
        + " candidate(us)".rjust(16)
        + " delta".rjust(10)
    )

    for key in shared_keys:
        baseline_value = baseline[key]
        candidate_value = candidate[key]
        delta = ((candidate_value - baseline_value) / baseline_value) * 100.0
        print(
            key.ljust(64)
            + f"{baseline_value:14.3f}"
            + f"{candidate_value:16.3f}"
            + f"{delta:9.2f}%"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
