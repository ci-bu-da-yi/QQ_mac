# README

## About

A Wails-based desktop backend written in Go. It listens to QQ messages and keeps the application and notification logic in the Go backend.
The project has no frontend source tree. Wails provides an empty in-process shell so its desktop runtime and backend bindings remain available.

## Development

Run the backend in Wails development mode without frontend compilation or binding generation:

```sh
wails dev -s -skipbindings
```

## Building

Wails requires these flags when a project has no frontend directory:

```sh
wails build -s -skipbindings
```
