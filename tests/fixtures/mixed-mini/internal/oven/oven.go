package oven

type Oven struct {
	Tray Tray
	Heat int
}

func (o Oven) Bake(n int) string {
	if !o.Tray.Fits(n) {
		return "too many"
	}
	return "baked"
}
