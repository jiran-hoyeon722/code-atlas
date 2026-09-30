package com.acme.shop.controller;

import com.acme.shop.domain.Order.Line;
import com.acme.shop.service.*;
import java.util.ArrayList;
import java.util.List;

public class OrderController {
    private final OrderService service = new OrderService();

    public List<Line> list(String filter) {
        List<Line> out = new ArrayList<>();
        for (Line line : service.lines()) {
            if (filter.equals("all") || line.sku().startsWith(filter)) {
                out.add(line);
            }
        }
        return out;
    }
}
