package main

import (
	"context"
	"embed"
	"os"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	wailsWindows "github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func NewApp() *App {
	return &App{}
}
func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:            "QQ桌面弹幕",
		Width:            1024,
		Height:           768,
		DisableResize:    true,
		Fullscreen:       true,
		Frameless:        true,
		AlwaysOnTop:      true,
		WindowStartState: options.Fullscreen,
		CSSDragProperty:  "--wails-draggable",
		CSSDragValue:     "drag",
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 0, G: 0, B: 0, A: 0},
		Windows: &wailsWindows.Options{
			WebviewIsTransparent:              true,
			WindowIsTranslucent:               true,
			DisableFramelessWindowDecorations: true,
		},
		OnStartup: func(ctx context.Context) {
			app.startup(ctx)
		},
		//回调函数。触发条件：前端加载完成
		//否则可能会在鼠标穿透的时候会阻拦其他的操作,会一直穿透
		OnDomReady: func(ctx context.Context) {
			startOverlayIntegration(ctx)
		},
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	exePath, err := os.Executable()
	if err != nil {
		println("获取路径失败！", err.Error())
		return
	}

	// 开发程序不要覆盖桌面正式快捷方式
	if !strings.HasSuffix(strings.ToLower(exePath), "-dev.exe") {
		if err1 := CreateDesktopShortcut(exePath); err1 != nil {
			println("创建桌面快捷方式失败：:", err1.Error())
		}
	}
}
