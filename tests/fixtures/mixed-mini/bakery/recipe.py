class Recipe:
    def __init__(self, name, minutes):
        self.name = name
        self.minutes = minutes

    def is_quick(self):
        return self.minutes < 20
