package main

import "example.com/mini/tools/lint"

func main() {
	lint.Run(func(name string) bool { return name != "" })
}
