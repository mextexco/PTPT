#!/bin/bash
# PTPT サーバ起動（Tailscale Funnel運用）
# 電源ON後などにこれ1つでnodeサーバを立ててFunnel状態を確認する。
# 使い方: ~/photoparty/start.sh
cd "$(dirname "$0")"
SLOG=/tmp/photoparty-server.log

# 既存サーバがいれば入れ替え
pkill -f "node server.js" 2>/dev/null
sleep 1
nohup node server.js > "$SLOG" 2>&1 &
sleep 1

if pgrep -f "node server.js" >/dev/null; then
  echo "■ nodeサーバ起動OK (localhost:3000)"
else
  echo "■ nodeサーバ起動に失敗。ログ: tail -20 $SLOG"
  exit 1
fi

# Funnel状態（tailscaledは自動常駐。offなら公開し直す）
if tailscale funnel status 2>/dev/null | grep -q "Funnel on"; then
  echo "■ Tailscale Funnel: ON"
else
  echo "■ FunnelがoffなのでBGで公開する"
  tailscale funnel --bg 3000
fi

echo ""
echo "  公開URL: https://shumacbook.tailfa36ca.ts.net"
echo "  （URLは固定。参加者はこれを開くだけ）"
