package GetMessage

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"my-project/user"
	"os"
	"strings"
	"sync"
	"time"
)

var (
	Messages []Message
)

type Message struct {
	ID             int64  `json:"ID"`
	UserID         int64  `json:"UserID"`
	NotificationID string `json:"notification_id"` //通知ID
	Time           string `json:"time"`            //通知时间
	Title          string `json:"title"`           //群名
	Body           string `json:"body"`            //通知内容
}

func init() {
	if err := LoadMessage(); err != nil {
		fmt.Println("加载数据失败！", err)
	}
}
func LoadMessage() error {
	data, err := os.ReadFile(user.MessageFilePath)
	if err != nil {
		if os.IsNotExist(err) {
			Messages = []Message{}
			return nil
		}
		return err
	}
	if len(bytes.TrimSpace(data)) == 0 {
		Messages = []Message{}
		return nil
	}
	if err := json.Unmarshal(data, &Messages); err != nil {
		if Messages == nil {
			Messages = []Message{}
		}
		return nil
	}
	var legacy Message
	if err := json.Unmarshal(data, &legacy); err != nil {
		if legacy.ID == 0 && legacy.Title == "" && legacy.Body == "" {
			Messages = []Message{}
		} else {
			Messages = []Message{legacy}
		}
		return nil
	}
	return fmt.Errorf("消息格式错误！")
}
func SaveMessage() error {
	//反序列化
	data, err := json.MarshalIndent(Messages, "", " ")
	if err != nil {
		return err
	}
	//序列化后写入文件
	return os.WriteFile(user.MessageFilePath, data, 0644)
}

var (
	seenMu     sync.Mutex              //互斥锁
	seen       = make(map[string]bool) //哈希表去重
	maxSeenCap = 10000                 //最大容量
)

func parseLine(line string) (Message, bool) {
	parts := strings.SplitN(line, "\t", 4)
	if len(parts) != 4 {
		return Message{}, false
	}
	return Message{
		NotificationID: parts[0],
		Time:           parts[1],
		Title:          parts[2],
		Body:           parts[3],
	}, true
}

// 区分已读和未读的消息
func PrimeSeen() error {
	lines, err := queryQQNotifications()
	if err != nil {
		return err
	}
	seenMu.Lock()
	defer seenMu.Unlock()
	//处理每一条消息
	for _, line := range lines {
		msg, ok := parseLine(line)
		if ok {
			seen[msg.NotificationID] = true
		}
	}
	return nil
}
func NextMessages(ctx context.Context, interval time.Duration) ([]Message, error) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop() //函数退出时停止定时器
	for {
		lines, err := queryQQNotifications()
		if err != nil {
			return nil, fmt.Errorf("查询失败！: %w", err)
		}
		seenMu.Lock()
		var newMessages []Message
		for _, line := range lines {
			msg, ok := parseLine(line)
			if !ok {
				continue
			}
			if !seen[msg.NotificationID] {
				seen[msg.NotificationID] = true
				newMessages = append(newMessages, msg)
			}
		}
		if len(newMessages) > maxSeenCap {
			clear(seen)
			for _, line := range lines {
				if m, ok := parseLine(line); ok {
					seen[m.NotificationID] = true
				}
			}
		}
		seenMu.Unlock()
		if len(newMessages) > 0 {
			return newMessages, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
	}
}
