package util

import "strings"

func Blank(s string) bool {
	return strings.TrimSpace(s) == ""
}
