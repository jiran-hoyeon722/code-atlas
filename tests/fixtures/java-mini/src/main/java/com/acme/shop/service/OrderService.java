package com.acme.shop.service;

import static com.acme.shop.util.Money.round;

import com.acme.shop.domain.Order;
import com.acme.shop.domain.Refund;
import java.util.List;

public class OrderService {
    private final PriceCalculator calculator = amount -> round(amount * 1.1);
    private final Order order = new Order();

    public List<Order.Line> lines() {
        return order.lines();
    }

    public double total() {
        double sum = 0;
        for (Order.Line line : order.lines()) {
            sum += calculator.price(line.amount());
        }
        return sum;
    }

    public Refund refund() {
        return null;
    }
}
