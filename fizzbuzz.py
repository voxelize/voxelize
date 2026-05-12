#!/usr/bin/env python3


def main() -> None:
    for n in range(1, 101):
        output = ""

        if n % 3 == 0:
            output += "Fizz"
        if n % 5 == 0:
            output += "Buzz"

        print(output or n)


if __name__ == "__main__":
    main()
