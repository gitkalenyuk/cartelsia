//go:build windows

package desktop

import (
	"errors"
	"syscall"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

func Supported() bool { return true }

var ErrClosed = errors.New("window closed")

func RunMainWindow(url, title, dataPath string) error {
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     true,
		AutoFocus: true,
		DataPath:  dataPath,
		WindowOptions: webview2.WindowOptions{
			Title:  title,
			Width:  1240,
			Height: 820,
			Center: true,
			IconId: 1,
		},
	})
	if w == nil {
		return errors.New("webview window unavailable (WebView2 runtime missing?)")
	}
	defer w.Destroy()
	w.Navigate(url)
	w.Run()
	return ErrClosed
}

func Alert(title, text string) {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(text)
	_, _, _ = user32MessageBoxW.Call(
		0,
		uintptr(unsafe.Pointer(m)),
		uintptr(unsafe.Pointer(t)),
		0, // MB_OK
	)
}

var user32MessageBoxW = syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
