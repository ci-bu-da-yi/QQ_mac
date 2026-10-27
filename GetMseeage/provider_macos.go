package GetMessage

import "errors"

var ErrMacNotificationSource = errors.New(
	"macos QQ 通知数据源尚未接入",
)

func queryQQNotifications() ([]string, error) {
	return nil, ErrMacNotificationSource
}
