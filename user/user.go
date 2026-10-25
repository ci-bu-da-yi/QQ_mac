package user

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"unicode"

	"golang.org/x/crypto/bcrypt"
)

var (
	Users           []User
	userFilePath    string
	MessageFilePath string
)

type User struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Password string `json:"password"`
}
type Message struct {
	NotificationID string `json:"notification_id"` //通知ID
	Time           string `json:"time"`            //通知时间
	Title          string `json:"title"`           //群名
	Body           string `json:"body"`            //通知内容
}

func init() {
	initStoragePaths()
	LoadUser()
}

// 找路径方便后面找文件
func initStoragePaths() {
	configDir, err := os.UserConfigDir() //获取标准配置目录
	if err != nil {
		userFilePath = filepath.Join("users", "users.json")
		MessageFilePath = filepath.Join("users", "messages.json")
		return
	}
	dataDir := filepath.Join(configDir, "QQDanmaku")
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		userFilePath = filepath.Join("users", "users.json")
		return
	}
	userFilePath = filepath.Join(dataDir, "users.json")
	MessageFilePath = filepath.Join(dataDir, "messages.json")
}

// 创建用户
func CreateUser(name string, password string) (*User, error) {
	if name == "" || password == "" {
		return nil, errors.New("用户名或密码为空！")
	}
	if len(password) < 8 || len(password) > 20 {
		return nil, errors.New("用户密码长度必须在8~20之间！")
	}
	if !BoolPassword(password) {
		return nil, errors.New("密码必须包含大，小写字母，数字和特殊字符！")
	}
	if _, err := FindName(name); err == nil {
		return nil, errors.New("用户名已经存在！")
	}
	newPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		fmt.Println("密码加密失败")
		return nil, err
	}
	nemID := int64(1)
	if len(Users) > 0 {
		nemID = Users[len(Users)-1].ID + 1
	}
	user := User{
		ID:       nemID,
		Name:     name,
		Password: string(newPassword),
	}
	Users = append(Users, user)
	err = SaveUser()
	if err != nil {
		return nil, errors.New("用户保存数据失败！")
	}
	return &user, nil
}

// 寻找用户
func FindName(name string) (*User, error) {
	for _, u := range Users {
		if u.Name == name {
			return &u, nil
		}
	}
	return nil, errors.New("用户不存在！")

}

// 保存用户数据
func SaveUser() error {
	data, err := json.Marshal(Users)
	if err != nil {
		return err
	}
	return ioutil.WriteFile(userFilePath, data, 0644)
}

// 密码判断
func BoolPassword(password string) bool {
	count := len(password)
	count1 := 0
	count2 := 0
	count3 := 0
	for _, i := range password {
		if unicode.IsLower(i) {
			count1++
		}
		if unicode.IsUpper(i) {
			count2++
		}
		if unicode.IsNumber(i) {
			count3++
		}
	}
	if count1 == 0 || count2 == 0 || count3 == 0 {
		return false
	}
	if count-count1-count2-count3 <= 0 {
		return false
	}
	return true
}

// *User 可以改数据，User不能
func CheckUser(name string, password string, u *User) (*User, error) {
	if name == "" || password == "" {
		return nil, errors.New("请输入用户名或者密码！")
	}
	if _, err := FindName(name); err != nil {
		return nil, err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.Password), []byte(password)); err != nil {
		return nil, errors.New("密码错误！")
	}
	return u, nil
}
func LoadUser() {
	data, err := os.ReadFile(userFilePath)
	if err != nil {
		if !os.IsNotExist(err) {
			fmt.Println("用户数据解析失败！")
		}
		Users = []User{}
		return
	}
	//判断文件是否为空
	if len(bytes.TrimSpace(data)) == 0 {
		Users = []User{}
		return
	}
	// 新版本：用户数组
	var users []User
	if err := json.Unmarshal(data, &users); err == nil {
		Users = users
		return
	}

	// 旧版本：单个用户
	var legacy User
	if err := json.Unmarshal(data, &legacy); err == nil && legacy.ID != 0 {
		Users = []User{legacy}
		return
	}

	fmt.Println("用户数据解析失败！")
	Users = []User{}
	//校验是否为合法用户
}

// 登录
func LoginService(name string, password string) (*User, error) {
	u, err := FindName(name)
	if err != nil {
		return nil, err
	}
	u2, err2 := CheckUser(name, password, u)
	if err2 != nil {
		return nil, err2
	}
	return u2, nil
}

// 防止乱码
func limitRunes(value string, limit int) string {
	runes := []rune(value)
	//没超过限制返回原本字符串
	if len(runes) <= limit {
		return value
	}
	//截断
	return string(runes[:limit])
}

// 获取桌面路径
func GetDeskPath() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "获取桌面路径失败！", err
	}
	deskpath := filepath.Join(homeDir, "Desktop")
	if info, err := os.Stat(deskpath); err == nil && info.IsDir() {
		return deskpath, nil
	}
	oneDirveDeskPath := filepath.Join(homeDir, "OneDirve", "DeskPath")
	if info, err := os.Stat(oneDirveDeskPath); err == nil && info.IsDir() {
		return oneDirveDeskPath, nil
	}
	return deskpath, err
}
