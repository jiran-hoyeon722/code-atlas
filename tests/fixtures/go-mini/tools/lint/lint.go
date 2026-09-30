package lint

func Run(check func(string) bool) {
	check("x")
}
