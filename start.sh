#!/bin/bash
# PTPT 起動: nodeサーバ + cloudflaredトンネルを立ち上げ、公開URLとQRを表示する。
# 電源ON後や「今日の公開URLが欲しい」ときにこれ1つ。URLは毎回変わる。
# 使い方: ~/photoparty/start.sh
cd "$(dirname "$0")"
SLOG=/tmp/photoparty-server.log
TLOG=/tmp/photoparty-cf.log

# 既存を入れ替え（クリーンに立て直す）
pkill -f "node server.js" 2>/dev/null
pkill -f "cloudflared tunnel" 2>/dev/null
sleep 1

nohup node server.js > "$SLOG" 2>&1 &
sleep 1
if ! pgrep -f "node server.js" >/dev/null; then
  echo "■ nodeサーバ起動に失敗。ログ: tail -20 $SLOG"; exit 1
fi
echo "■ nodeサーバ OK (localhost:3000)"

nohup cloudflared tunnel --edge-ip-version 4 --protocol http2 --url http://localhost:3000 > "$TLOG" 2>&1 &
echo "■ トンネル起動中…（最大60秒待つ）"

URL=""
for i in $(seq 1 30); do
  sleep 2
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TLOG" | head -1)
  # URLが出て かつ エッジに接続登録できたら確立とみなす
  if [ -n "$URL" ] && grep -q "Registered tunnel connection" "$TLOG"; then break; fi
  URL=""
done

if [ -z "$URL" ]; then
  echo "■ トンネル確立に失敗。ログ: tail -20 $TLOG"; exit 1
fi

echo ""
echo "════════════════════════════════════════════════"
echo "  今日の公開URL:"
echo "  $URL"
echo "════════════════════════════════════════════════"
echo "  参加者にはこのQR/URLを見せる（URLは起動ごとに変わる）"
echo ""
if command -v qrencode >/dev/null 2>&1; then
  qrencode -t ANSIUTF8 "$URL"
else
  echo "（qrencode未導入: brew install qrencode で端末QRを出せる。無くても公開URLを"
  echo "  ホスト機のブラウザで開き→部屋作成→アプリ内QRで招待、で運用可）"
fi
echo ""
