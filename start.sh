#!/bin/bash
# PTPT 起動: nodeサーバがcloudflaredトンネルを起動・自動監視する（落ちたら自動で貼り直す）。
# 公開URLとQRを表示。URLは起動/貼り直しごとに変わる。
# 使い方: ~/photoparty/start.sh
cd "$(dirname "$0")"
SLOG=/tmp/photoparty-server.log

# 既存を入れ替え（stray cloudflaredも掃除）
pkill -f "node server.js" 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
sleep 1

# PP_TUNNEL=1 でサーバがcloudflaredを子プロセスで起動・監視する
PP_TUNNEL=1 nohup node server.js > "$SLOG" 2>&1 &
sleep 1
if ! pgrep -f "node server.js" >/dev/null; then
  echo "■ nodeサーバ起動に失敗。ログ: tail -20 $SLOG"; exit 1
fi
echo "■ nodeサーバ OK (localhost:3000)。トンネル確立を待つ…（最大60秒）"

URL=""
for i in $(seq 1 30); do
  sleep 2
  # サーバが「■ 公開URL: <url>」を出す
  URL=$(grep -ao 'https://[a-z0-9-]*\.trycloudflare\.com' "$SLOG" | tail -1)
  [ -n "$URL" ] && break
done

if [ -z "$URL" ]; then
  echo "■ トンネル確立に失敗。ログ: tail -30 $SLOG"; exit 1
fi

echo ""
echo "════════════════════════════════════════════════"
echo "  今日の公開URL:"
echo "  $URL"
echo "════════════════════════════════════════════════"
echo "  ・参加者にはこのQR/URLを見せる（URLは貼り直しごとに変わる）"
echo "  ・ホストは http://localhost:3000 で開くと、トンネルが変わっても"
echo "    切れず、招待画面に常に最新URL/QRが出る＋「貼り直す」ボタンも使える"
echo ""
if command -v qrencode >/dev/null 2>&1; then
  qrencode -t ANSIUTF8 "$URL"
fi
echo ""
