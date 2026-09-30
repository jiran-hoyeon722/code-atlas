package main

import (
	"fmt"

	"github.com/x/y"

	svc "example.com/mini/internal/service"
	_ "example.com/mini/internal/audit"
	. "example.com/mini/pkg/util"
)

func main() {
	o := svc.Place("book", 2)
	if o.Qty > 1 && Blank(o.Item) == false {
		fmt.Println(y.Wrap(o.Item))
	}
}
