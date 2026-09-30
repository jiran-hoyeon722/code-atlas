package model

type Item struct {
	Name string
}

func (i Item) Label() string {
	switch i.Name {
	case "":
		return "none"
	default:
		return i.Name
	}
}
