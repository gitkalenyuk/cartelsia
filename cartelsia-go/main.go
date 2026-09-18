package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"sync/atomic"
	"syscall"
	"time"

	"cartelsia/pkg/cartesia"
	"cartelsia/pkg/desktop"
	"cartelsia/pkg/keys"
	"cartelsia/pkg/models"
	"cartelsia/pkg/orchestrator"
	"cartelsia/pkg/server"
	"cartelsia/pkg/storage"
)

func main() {
	// The window and its COM apartment must live on the primary OS thread.
	runtime.LockOSThread()

	portFlag := flag.Int("port", 54321, "Web server port")
	portable := flag.Bool("portable", true, "Store data and audio in current directory")
	headless := flag.Bool("headless", false, "Run in console mode without native desktop window")
	flag.Parse()

	store, err := storage.NewStorage(*portable)
	if err != nil {
		desktop.Alert("Cartelsia", "Помилка сховища: "+err.Error())
		os.Exit(1)
	}

	useGUI := runtime.GOOS == "windows" && !*headless && desktop.Supported()
	if useGUI {
		logDir := store.DataDir()
		_ = os.MkdirAll(logDir, 0o755)
		logPath := filepath.Join(logDir, "app.log")
		if f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644); err == nil {
			os.Stdout = f
			os.Stderr = f
			log.SetOutput(f)
		}
	}

	client := cartesia.NewClient("")
	var srv *server.Server

	pool := keys.NewPoolManager(store, client, func() {
		if srv != nil {
			srv.BroadcastEvent(models.MainEvent{
				"type": "keys-replaced",
				"keys": srv.KeysPublic(),
			})
		}
	})

	orch := orchestrator.NewOrchestrator(client, pool, store, func(ev models.MainEvent) {
		if srv != nil {
			srv.BroadcastEvent(ev)
		}
	})

	exeDir, _ := os.Executable()
	baseDir := filepath.Dir(exeDir)
	cwd, _ := os.Getwd()

	candidates := []string{
		filepath.Join(baseDir, "renderer"),
		filepath.Join(cwd, "renderer"),
		filepath.Join(baseDir, "out", "renderer"),
		filepath.Join(cwd, "out", "renderer"),
		filepath.Join(cwd, "..", "out", "renderer"),
	}

	rendererDir := ""
	for _, c := range candidates {
		if fi, err := os.Stat(c); err == nil && fi.IsDir() {
			if _, errIndex := os.Stat(filepath.Join(c, "index.html")); errIndex == nil {
				rendererDir = c
				break
			}
		}
	}

	if rendererDir == "" {
		rendererDir = candidates[0]
	}
	log.Printf("[Cartelsia-Go] Frontend assets: %s\n", rendererDir)

	port, _ := pickFreePort("127.0.0.1", *portFlag)
	srv = server.NewServer(port, store, pool, client, orch, rendererDir)

	_, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		if err := srv.Start(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("Server failed: %v\n", err)
			if useGUI {
				desktop.Alert("Cartelsia", "Не вдалося запустити внутрішній сервер: "+err.Error())
			}
			os.Exit(1)
		}
	}()

	url := fmt.Sprintf("http://127.0.0.1:%d", port)
	log.Printf("[Cartelsia-Go] Running at: %s\n", url)

	if err := waitReady(url, 15*time.Second); err != nil {
		log.Printf("Server waitReady failed: %v\n", err)
		if useGUI {
			desktop.Alert("Cartelsia", "Помилка очікування сервера: "+err.Error())
		}
		os.Exit(1)
	}

	var shuttingDown atomic.Bool
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sig
		log.Println("[Cartelsia-Go] Shutting down...")
		shuttingDown.Store(true)
		cancel()
		os.Exit(0)
	}()

	if useGUI {
		dataPath := filepath.Join(store.DataDir(), "webview2")
		_ = os.MkdirAll(dataPath, 0o755)

		err := desktop.RunMainWindow(url, "Cartelsia", dataPath)
		if err != nil && err != desktop.ErrClosed {
			log.Printf("WebView2 failed (%v), falling back to browser\n", err)
			desktop.Alert("Cartelsia", "Microsoft Edge WebView2 runtime не знайдено на цьому ПК.\n\nCartelsia відкриється у стандартному браузері.")
			useGUI = false
		} else {
			shuttingDown.Store(true)
			cancel()
			return
		}
	}

	fmt.Println("==================================================")
	fmt.Println("  Cartelsia (Go Standalone Edition v2.1.3)")
	fmt.Println("  Fast, lightweight, native Go TTS pipeline")
	fmt.Printf("  URL: %s\n", url)
	fmt.Println("==================================================")

	if !*headless {
		openBrowser(url)
	}

	select {}
}

func waitReady(base string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 2 * time.Second}
	for time.Now().Before(deadline) {
		resp, err := client.Get(base)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 500 {
				return nil
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("no response from %s within %s", base, timeout)
}

func pickFreePort(host string, startPort int) (int, bool) {
	if portAvailable(host, startPort) {
		return startPort, false
	}
	for p := startPort + 1; p <= startPort+100 && p < 65536; p++ {
		if portAvailable(host, p) {
			return p, true
		}
	}
	if l, err := net.Listen("tcp", net.JoinHostPort(host, "0")); err == nil {
		p := l.Addr().(*net.TCPAddr).Port
		_ = l.Close()
		return p, true
	}
	return startPort, false
}

func portAvailable(host string, port int) bool {
	l, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return false
	}
	_ = l.Close()
	return true
}

func openBrowser(u string) {
	switch runtime.GOOS {
	case "windows":
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", u).Start()
	case "darwin":
		_ = exec.Command("open", u).Start()
	default:
		_ = exec.Command("xdg-open", u).Start()
	}
}
