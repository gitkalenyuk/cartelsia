//go:build !windows

package desktop

import "errors"

func Supported() bool { return false }

var ErrClosed = errors.New("window closed")

func RunMainWindow(url, title, dataPath string) error {
	return errors.New("desktop GUI not supported on this platform")
}

func Alert(title, text string) {}
