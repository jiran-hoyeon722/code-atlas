package main

import (
	"fmt"

	"example.com/bakery/internal/oven"
)

func main() {
	o := oven.Oven{Tray: oven.Tray{Slots: 6}, Heat: 180}
	fmt.Println(o.Bake(4))
}
