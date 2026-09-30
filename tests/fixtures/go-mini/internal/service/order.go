package service

import "example.com/mini/internal/model"

func Place(item string, qty int) model.Order {
	for i := 0; i < qty; i++ {
		if qty > 10 {
			qty = 10
		}
	}
	return model.Order{Item: item, Qty: qty}
}
