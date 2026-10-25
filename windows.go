//go:build windows

package main

import (
	"context"
	"fmt"
	"runtime"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	overlayWindowsTitle = "QQ桌面弹幕"
	overlayWindowsClass = "wailsWindow"
	wmHotKey            = 0x0312       //定义windows热键消息编号
	modAlt              = 0x0001       //定义Alt修饰键
	modControl          = 0x0002       //定义Ctrl键
	modNoRepeat         = 0x4000       //定义按住热键时不重复触发的标志
	hotKeyID            = 1            //定义当前全局热键唯一的编号
	KeyD                = 0x44         //定义字母D的虚拟键码
	wsExLayered         = 0x00080000   //定义窗口分层扩展样式，保持窗口透明能力
	wsExTransparent     = 0x00000020   //定义窗口鼠标穿透扩展样式
	wsExToolWindow      = 0x00000080   //定义工具窗口样式，隐藏任务栏入口
	wsExAppWindow       = 0x00040000   //定义应用窗口样式，显示任务栏入口
	swpNopSize          = 0x0001       //定义窗口尺寸不变
	swpNoMove           = 0x0002       //定义保持窗口位置不变
	swpNoZOrder         = 0x0004       //定义保持窗口Z顺序不变
	swpNoActivate       = 0x0010       //定义修改窗口样式时不激活窗口
	swpFrameChanged     = 0x0020       //定义通知系统重新计算窗口边框
	gwlExStyle          = ^uintptr(19) //定义GWL_EXSTYLE 的数值，对应-20
	wmLeftButtonDown    = 0x0201
	wmLeftButtonUp      = 0x0202
	whMouseLL           = 14 //定义低级鼠标钩子类型
)

var (
	overlayUser32         = windows.NewLazySystemDLL("user32.dll")       //加载Windows user 32.dll
	procFindWindow        = overlayUser32.NewProc("FindWindowW")         //加载FindWindows函数
	procGetWindowLongPtr  = overlayUser32.NewProc("GetWindowLongPtrW")   //加载GetWindowLongPtrW函数
	procSetWindowLongPtr  = overlayUser32.NewProc("SetWindowLongPtrW")   //加载SetWindowLongPtrW函数
	procSetWindowPos      = overlayUser32.NewProc("SetWindowPos")        //加载SetWindowPos函数
	procRegisterHotKey    = overlayUser32.NewProc("RegisterHotKey")      //加载RegisterHotKey函数
	procUnregisterHotKey  = overlayUser32.NewProc("UnregisterHotKey")    //加载UnregisterHotKey函数
	procGetMessage        = overlayUser32.NewProc("GetMessageW")         //加载 GetMessageW函数
	procSetForegroundWnd  = overlayUser32.NewProc("SetForegroundWindow") //加载SetForegroundWindow函数
	procSetWindowsHookEx  = overlayUser32.NewProc("SetWindowsHookExW")   //加载SetWindowsHookExW函数
	procCallNextHookEx    = overlayUser32.NewProc("CallNextHookEx")      //加载CallNextHookEx函数
	procUnhookWindowsHook = overlayUser32.NewProc("UnhookWindowsHookEx") //加载UnhookWindowsHookEx函数
	procClientToScreen    = overlayUser32.NewProc("ClientToScreen")      //加载ClientToScreen函数
	procGetCursorPos      = overlayUser32.NewProc("GetCursorPos")        //加载GetCursorPos函数
)

type overlayMouseHookData struct {
	point       winPoint //保存鼠标屏幕坐标
	mouseData   uint32   //保存鼠标附加数据
	flags       uint32   //保存鼠标事件标志
	time        uint32   //保存鼠标事件时间
	dwExtraInfo uintptr  //保存系统附加信息
}

type overlayInteractiveArea struct {
	left    int32 //保存交互区域左边界
	top     int32 //保存交互区域上边界
	right   int32 //保存交互区域右边界
	bottom  int32 //保存交互区域下边界
	visible bool  //保存交互区域是否启用
}

var (
	overlayPointerEngaged atomic.Bool
	overlayHWND           atomic.Uintptr                         //保存弹幕窗口句柄
	overlayArea           atomic.Pointer[overlayInteractiveArea] //保存控制面板交互区域
	overlayAreaSpec       atomic.Pointer[overlayInteractiveArea] //保存前端上报的相对交互区域
	overlayPassThrough    atomic.Bool                            //保存当前鼠标穿透状态
	overlayStyleReady     atomic.Bool                            //保存窗口样式是否已经初始化
	manualInteractiveMode atomic.Bool
	//保存手动交互模式状态

)

type winPoint struct {
	x, y int32
}
type winMsg struct {
	Hwnd     uintptr  //保存接受消息的窗口标识符
	Message  uint32   //保存消息编号
	_        uint32   //填充 4 字节，保证64位结构体的对齐
	WParam   uintptr  //保存消息附加参数
	LParam   uintptr  //保存消息附加参数
	Time     uint32   //保存时间
	Pt       winPoint //保存鼠标坐标
	LPrivate uint32   //保存私有参数
}

var overlayMouseHookProc = windows.NewCallback(func(nCode, wParam, lParam uintptr) uintptr {
	if int32(nCode) >= 0 && lParam != 0 && !manualInteractiveMode.Load() {
		data := mouseHookDataFromLParam(lParam)

		switch wParam {
		case wmLeftButtonDown:
			if isOverlayInteractivePoint(data.point.x, data.point.y) {
				overlayPointerEngaged.Store(true)
			}
		case wmLeftButtonUp:
			overlayPointerEngaged.Store(false)
		}

		updateOverlayInteraction(data.point.x, data.point.y)
	}

	result, _, _ := procCallNextHookEx.Call(0, nCode, wParam, lParam)
	return result
})

// 把系统回调参数转换成 Go 结构体指针
// 只对这个受控转换关闭检查。
//
//go:nocheckptr
func mouseHookDataFromLParam(lParam uintptr) *overlayMouseHookData {
	return (*overlayMouseHookData)(unsafe.Pointer(uintptr(lParam)))
}

func startOverlayIntegration(ctx context.Context) {
	go func() {
		hwnd := waitForOverlayWindows(ctx)
		if hwnd == 0 {
			fmt.Println("未找到窗口，鼠标穿透未启用")
			return
		}

		overlayHWND.Store(hwnd)

		runtime.LockOSThread()
		defer runtime.UnlockOSThread()

		// 鼠标钩子属于增强功能，安装失败时仍然继续启用定时检测。
		var module windows.Handle
		err := windows.GetModuleHandleEx(
			windows.GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
			nil,
			&module,
		)
		if err != nil {
			fmt.Println("获取程序模块失败，跳过鼠标钩子:", err)
		} else {
			hook, _, callErr := procSetWindowsHookEx.Call(
				whMouseLL,
				overlayMouseHookProc,
				uintptr(module),
				0,
			)
			if hook != 0 {
				defer procUnhookWindowsHook.Call(hook)
			} else {
				fmt.Println(
					"安装鼠标交互钩子失败，改用定时检测:",
					winCallError(callErr),
				)
			}
		}

		// 初始状态允许鼠标穿透，鼠标进入控制面板后再关闭穿透。
		if err := setOverlayClickThrough(hwnd, true); err != nil {
			fmt.Println("启用鼠标穿透失败:", err)
			return
		}

		// 应用前端已经上报的控制面板交互区域。
		if spec := overlayAreaSpec.Load(); spec != nil {
			applyOverlayArea(hwnd, spec)
		}

		// 即使低级鼠标钩子不可用，也通过定时检测保证面板可以点击。
		startOverlayCursorTracking(ctx, hwnd)

		ok, _, callErr := procRegisterHotKey.Call(
			0,
			hotKeyID,
			modControl|modAlt|modNoRepeat,
			KeyD,
		)
		if ok != 0 {
			defer procUnregisterHotKey.Call(0, hotKeyID)
		} else {
			fmt.Println(
				"全局快捷键注册失败，仍可使用面板自动交互:",
				winCallError(callErr),
			)
		}

		fmt.Println("鼠标穿透已启用，移到控制面板会自动进入交互")

		var msg winMsg
		for {
			ret, _, callErr := procGetMessage.Call(
				uintptr(unsafe.Pointer(&msg)),
				0,
				0,
				0,
			)
			if int32(ret) == -1 {
				fmt.Println("读取系统消息失败:", winCallError(callErr))
				return
			}
			if ret == 0 {
				return
			}

			if msg.Message != wmHotKey || msg.WParam != hotKeyID {
				continue
			}

			// Ctrl+Alt+D 切换为手动交互模式。
			manualInteractiveMode.Store(!manualInteractiveMode.Load())
			refreshOverlayInteraction(hwnd)
		}
	}()
}
func startOverlayCursorTracking(ctx context.Context, hwnd uintptr) {
	go func() {
		ticker := time.NewTicker(16 * time.Millisecond)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				// 手动交互模式由快捷键控制，这里不要覆盖它的状态。
				if !manualInteractiveMode.Load() {
					refreshOverlayInteraction(hwnd)
				}
			}
		}
	}()
}
func (a *App) SetOverlayInteractiveArea(
	x int,
	y int,
	width int,
	height int,
	visible bool,
) {
	if width <= 0 || height <= 0 {
		visible = false
	}

	spec := &overlayInteractiveArea{
		left:    int32(x),
		top:     int32(y),
		right:   int32(x + width),
		bottom:  int32(y + height),
		visible: visible,
	}
	overlayAreaSpec.Store(spec)

	hwnd := overlayHWND.Load()
	if hwnd == 0 {
		return
	}

	applyOverlayArea(hwnd, spec)
}

// 切换后台模式
func (a *App) SetOverlayBackgroundMode(enabled bool) error {
	hwnd := overlayHWND.Load() //读取标识符
	if hwnd == 0 {
		return nil //没初始化直接返回
	}
	//调用win32
	style, _, callErr := procGetWindowLongPtr.Call(hwnd, gwlExStyle)
	if style == 0 && !winCallOk(callErr) {
		return winCallError(callErr)
	}
	//复制
	newStyle := style
	//隐藏任务栏和ALT+TAB入口
	if enabled {
		//挂后台
		newStyle |= wsExToolWindow
		newStyle &^= wsExAppWindow
	} else {
		newStyle &^= wsExToolWindow
		newStyle |= wsExAppWindow
	}
	//减少窗口刷新
	if newStyle != style {
		previous, _, callErr := procSetWindowLongPtr.Call(
			hwnd,
			gwlExStyle,
			newStyle,
		)
		if previous == 0 && !winCallOk(callErr) {
			return winCallError(callErr)
		}
	}
	//通知Windows
	//不移动，不缩放，刷新窗口
	ok, _, callErr := procSetWindowPos.Call(
		hwnd,
		0,
		0,
		0,
		0,
		0,
		swpNoMove|swpNopSize|swpNoZOrder|swpNoActivate|swpFrameChanged,
	)
	if ok == 0 {
		return winCallError(callErr)
	}

	return nil
}

func applyOverlayArea(hwnd uintptr, spec *overlayInteractiveArea) {
	var origin winPoint
	ok, _, _ := procClientToScreen.Call(
		hwnd,
		uintptr(unsafe.Pointer(&origin)),
	)
	if ok == 0 {
		return
	}

	overlayArea.Store(&overlayInteractiveArea{
		left:    origin.x + spec.left,
		top:     origin.y + spec.top,
		right:   origin.x + spec.right,
		bottom:  origin.y + spec.bottom,
		visible: spec.visible,
	})

	refreshOverlayInteraction(hwnd)
}

func refreshOverlayInteraction(hwnd uintptr) {
	if manualInteractiveMode.Load() {
		if err := setOverlayClickThrough(hwnd, false); err == nil {
			procSetForegroundWnd.Call(hwnd)
		}
		return
	}

	var point winPoint
	ok, _, _ := procGetCursorPos.Call(uintptr(unsafe.Pointer(&point)))
	if ok != 0 {
		updateOverlayInteraction(point.x, point.y)
	}
}
func isOverlayInteractivePoint(x int32, y int32) bool {
	area := overlayArea.Load()
	return area != nil &&
		area.visible &&
		x >= area.left &&
		x < area.right &&
		y >= area.top &&
		y < area.bottom
}
func updateOverlayInteraction(x int32, y int32) {
	hwnd := overlayHWND.Load()
	if hwnd == 0 {
		return
	}

	interactive := overlayPointerEngaged.Load() ||
		isOverlayInteractivePoint(x, y)

	previousPassThrough := overlayPassThrough.Load()
	styleReady := overlayStyleReady.Load()

	if err := setOverlayClickThrough(hwnd, !interactive); err != nil {
		return
	}

	if interactive && (!styleReady || previousPassThrough) {
		procSetForegroundWnd.Call(hwnd)
	}
}

// uintptr 是 Go 语言中一个专门用于底层系统编程的特殊整数类型，
// 它的核心作用是安全地存储指针的内存地址值。
func waitForOverlayWindows(ctx context.Context) uintptr {
	title, _ := windows.UTF16PtrFromString(overlayWindowsTitle)
	className, _ := windows.UTF16PtrFromString(overlayWindowsClass)
	//转化成 Windows UTF-8字符串
	ticker := time.NewTicker(100 * time.Millisecond)
	//100毫秒的计时器
	defer ticker.Stop()
	//函数结束释放计时器
	for {
		hwnd, _, _ := procFindWindow.Call( //找窗口标识符
			uintptr(unsafe.Pointer(className)), //指定 Wails 窗口类
			uintptr(unsafe.Pointer(title)))     //传入指针
		if hwnd != 0 {
			return hwnd //找到了
		}
		select { //检查上下文是否取消
		case <-ctx.Done(): //放弃等待直接返回
			return 0 //未找到窗口
		case <-ticker.C: //下一次触发
		}
	}
}
func setOverlayClickThrough(hwnd uintptr, enabled bool) error {
	if overlayStyleReady.Load() && overlayPassThrough.Load() == enabled {
		return nil
	}

	style, _, callErr := procGetWindowLongPtr.Call(hwnd, gwlExStyle)
	//读取扩展模式
	if style == 0 && !winCallOk(callErr) {
		return winCallError(callErr)
	}
	newstyle := style
	//判断是否需要启动鼠标穿透
	if enabled {
		//保留分层样式并增加鼠标穿透样式
		newstyle |= wsExLayered | wsExTransparent
	} else {
		//移除鼠标穿透样式，保留分层
		newstyle &^= wsExTransparent
	}
	//窗口是否发生变化
	if newstyle != style {

		previous, _, callErr := procSetWindowLongPtr.Call(
			hwnd,       //标识符
			gwlExStyle, //修改扩展样式
			newstyle,
		) //传入新的
		//窗口设置是否成功
		if previous == 0 && !winCallOk(callErr) {
			return winCallError(callErr)
		}
	}
	ok, _, callErr := procSetWindowPos.Call(
		hwnd, //标识符
		0,    //窗口z
		0,    //x
		0,    //y
		0,    //原宽度
		0,    //原高度
		// 使用不移动、不缩放、不激活和刷新边框标志。
		swpNoMove|swpNopSize|swpNoZOrder|swpNoActivate|swpFrameChanged,
	)
	//刷新窗口是否成功
	if ok == 0 {
		return winCallError(callErr)
	}

	overlayPassThrough.Store(enabled)
	overlayStyleReady.Store(true)
	return nil
}
func winCallOk(err error) bool {
	//判断错误是否为空
	if err == nil { //空错误调用成功
		return true
	}
	//转换错误码
	errno, ok := err.(syscall.Errno)
	if ok && errno == 0 {
		return true
	}
	return false
}
func winCallError(err error) error {
	//错误是否表示调用成功
	if winCallOk(err) {
		return nil
	}
	return err
}
