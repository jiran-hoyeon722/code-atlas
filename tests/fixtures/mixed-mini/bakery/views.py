from bakery.menu import Menu


def main():
    for r in Menu().quick():
        print(r.name)


if __name__ == "__main__":
    main()
