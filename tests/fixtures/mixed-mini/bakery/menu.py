from bakery.recipe import Recipe


class Menu:
    def __init__(self):
        self.items = [Recipe("bun", 15), Recipe("loaf", 45)]

    def quick(self):
        return [r for r in self.items if r.is_quick()]
