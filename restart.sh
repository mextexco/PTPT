#!/bin/bash
# PhotoParty 一発復旧: サーバとトンネルを再起動して公開URLを表示する
# 使い方: ~/photoparty/restart.sh
cd "$(dirname "$0")"
SLOG=/tmp/photoparty-server.log
TLOG=/tmp/photoparty-tunnel.log

pkill -f "node server.js" 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
sleep 1

nohup node server.js > "$SLOG" 2>&1 &
nohup cloudflared tunnel --edge-ip-version 4 --protocol http2 --url http://localhost:3000 > "$TLOG" 2>&1 &

echo "起動中…（最大60秒待つ）"
URL=""
for i in $(seq 1 30); do
  sleep 2
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TLOG" | head -1)
  if [ -n "$URL" ] && curl -s -o /dev/null --max-time 3 "$URL/"; then
    CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$URL/")
    [ "$CODE" = "200" ] && break
  fi
  URL=""
done

if [ -n "$URL" ]; then
  echo ""
  echo "■ 復旧完了"
  echo "  公開URL: $URL"
  echo "  （URLは毎回変わる。参加者にはこの新URLのQRを見せ直すこと）"
else
  echo "■ 失敗。ログを確認: tail -20 $TLOG"
  exit 1
fi
