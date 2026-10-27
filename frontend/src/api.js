import {
  Login,
  Logout,
  Register,
} from '../wailsjs/go/main/App'

function publicUser(value) {
  if (!value) {
    return null
  }

  return {
    id: Number(value.id ?? value.ID ?? value.userId ?? value.UserId ?? 0),
    name: String(
      value.name ??
        value.Name ??
        value.user ??
        value.User ??
        '',
    ),
  }
}

function normalize(result) {
  const success = Boolean(result?.success)
  return {
    success,
    message: String(result?.message ?? (success ? '操作成功' : '操作失败')),
    user: publicUser(result?.user),
  }
}

function callOptionalBackend(method, ...args) {
  const backendMethod = window.go?.main?.App?.[method]
  if (typeof backendMethod !== 'function') {
    return undefined
  }

  return backendMethod(...args)
}

export async function register(username, password) {
  return normalize(await Register(username, password))
}

export async function login(username, password) {
  return normalize(await Login(username, password))
}

export async function logout() {
  return normalize(await Logout())
}

export async function setOverlayInteractiveArea(...args) {
  await callOptionalBackend('SetOverlayInteractiveArea', ...args)
}

export async function setOverlayBackgroundMode(enabled) {
  await callOptionalBackend('SetOverlayBackgroundMode', enabled)
}
