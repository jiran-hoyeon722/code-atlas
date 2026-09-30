from billing.tasks.charge import charge


class Order:
    def pay(self, amount):
        return charge(amount) if amount > 0 else None
