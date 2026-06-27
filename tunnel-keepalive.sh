#!/bin/bash
# 自动维持 localtunnel 隧道：断开后自动重启
while true; do
  URL=$(npx localtunnel --port 3001 2>&1 | grep -o 'https://[a-z-]*\.loca\.lt')
  echo "=== $(date) Tunnel: $URL ==="
  echo "$URL" > /tmp/lt-current-url.txt
  # 等待进程结束（断开后继续循环）
  wait
  echo "Tunnel died, restarting in 3s..."
  sleep 3
done
