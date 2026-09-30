package com.acme.shop.domain;

import java.util.List;

public class Order {
    public record Line(String sku, double amount) {}

    private OrderStatus status = OrderStatus.NEW;

    public List<Line> lines() {
        return List.of(new Line("a-1", 3.0));
    }

    public boolean isOpen() {
        return status == OrderStatus.NEW || status == OrderStatus.PAID;
    }
}
