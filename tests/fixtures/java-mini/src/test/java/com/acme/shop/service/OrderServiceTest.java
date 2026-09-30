package com.acme.shop.service;

class OrderServiceTest {
    void totalIsPositive() {
        OrderService service = new OrderService();
        if (service.total() < 0) {
            throw new AssertionError("negative");
        }
    }
}
