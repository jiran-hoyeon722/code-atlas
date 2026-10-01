package oven

type Tray struct {
	Slots int
}

func (t Tray) Fits(n int) bool {
	return n > 0 && n <= t.Slots
}
