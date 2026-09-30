package com.acme.shop;

import com.acme.shop.controller.OrderController;

public class ShopApplication {
    public static void main(String[] args) {
        OrderController controller = new OrderController();
        controller.list(args.length > 0 ? args[0] : "all");
    }
}
