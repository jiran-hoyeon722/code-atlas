package service

import (
	"testing"

	"example.com/mini/internal/model"
)

func TestPlace(t *testing.T) {
	if Place("pen", 1) != (model.Order{Item: "pen", Qty: 1}) {
		t.Fatal("unexpected order")
	}
}
