def fizzbuzz(n):
    out = "".join(word for div, word in [(3, "Fizz"), (5, "Buzz")] if n % div == 0)
    return out or n


if __name__ == "__main__":
    for i in range(1, 101):
        print(fizzbuzz(i))
