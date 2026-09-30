package com.acme.shop.util;

public final class Money {
    public static final int CENTS = 100;

    private Money() {}

    public static double round(double value) {
        return Math.round(value * CENTS) / (double) CENTS;
    }
}
