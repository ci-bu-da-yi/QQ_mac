package main

import (
	"net/http"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	// macOS 专用配置包
	wailsMac "github.com/wailsapp/wails/v2/pkg/options/mac"
)

const appShellHTML = `<!doctype html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<title>QQ桌面弹幕</title>
</head>
<body></body>
</html>`

// 其他静态资源返回404
func serveAppShell(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && r.URL.Path != "/index.html" {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(appShellHTML))
}

func NewApp() *App {
	return &App{}
}
func main() {
	app := NewApp()
	err := wails.Run(&options.App{
		Title:         "QQ桌面弹幕",
		Width:         1024,
		Height:        768,
		DisableResize: true,
		Fullscreen:    true,
		Frameless:     true,
		AlwaysOnTop:   true,
		// macOS 专属配置。
		// 不能把这个字段写成 Windows options。
		Mac: &wailsMac.Options{
			// 允许 WebView 透明，方便以后实现弹幕叠层。
			WebviewIsTransparent: true,

			// 允许窗口半透明。
			WindowIsTranslucent: true,

			// 防止用户按 Esc 时直接退出全屏。
			DisableEscapeExitsFullscreen: true,
		},

		// 没有前端目录时，Wails 仍需要资产处理器
		AssetServer: &assetserver.Options{
			Handler: http.HandlerFunc(serveAppShell),
		},

		OnStartup: app.startup,
		Bind:      []interface{}{app},
	})

	if err != nil {
		println("启动失败！", err.Error())
	}
}
