#!/bin/bash
cd "$(dirname "$0")"

echo "╔══════════════════════════════════════╗"
echo "║   SLASH MUSIC ▸ Cyberpunk Player    ║"
echo "╚══════════════════════════════════════╝"
echo ""

# === CONFIGURATION ===
# Set your API keys here
DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-your-deepseek-api-key}"
GITHUB_TOKEN="${GITHUB_TOKEN:-your-github-token}"
REPO="${GITHUB_REPO:-your-username/your-repo}"
# =====================

# Kill old processes
lsof -ti:3000 | xargs kill -9 2>/dev/null
pkill -f cloudflared 2>/dev/null
sleep 1

# Start server
DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" node server.js &
SERVER_PID=$!
echo "[OK] Server started (PID: $SERVER_PID)"

sleep 2

# Download cloudflared if missing
if [ ! -f /tmp/cloudflared ]; then
  echo "[..] Downloading Cloudflare Tunnel..."
  curl -sL "https://github.com/cloudflare/cloudflared/releases/download/2026.5.0/cloudflared-darwin-arm64.tgz" -o /tmp/cf.tgz
  tar xzf /tmp/cf.tgz -C /tmp
  chmod +x /tmp/cloudflared
fi

# Function to update the GitHub Pages redirect
update_redirect() {
  local NEW_URL="$1"
  if [ -z "$NEW_URL" ]; then return; fi

  local SHA=$(curl -s "https://api.github.com/repos/$REPO/contents/docs/url.txt" \
    -H "Authorization: token $GITHUB_TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('sha',''))" 2>/dev/null)

  if [ -z "$SHA" ]; then return; fi

  local B64=$(echo -n "$NEW_URL" | base64)
  curl -s -X PUT "https://api.github.com/repos/$REPO/contents/docs/url.txt" \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"message\":\"Update tunnel URL\",\"content\":\"$B64\",\"sha\":\"$SHA\"}" > /dev/null

  echo "[OK] Redirect updated: https://${REPO%/*}.github.io/${REPO#*/}/"
}

# Start tunnel in background, capture URL
/tmp/cloudflared tunnel --url http://localhost:3000 2>&1 | while read line; do
  echo "$line" | grep -q "trycloudflare.com" && echo "$line" | grep -o 'https://[^.]*\.trycloudflare\.com' > /tmp/slash_music_url.txt
done &
TUNNEL_PID=$!

# Wait for tunnel URL
echo "[..] Establishing tunnel..."
URL=""
for i in $(seq 1 30); do
  sleep 1
  if [ -f /tmp/slash_music_url.txt ] && [ -s /tmp/slash_music_url.txt ]; then
    URL=$(cat /tmp/slash_music_url.txt)
    break
  fi
  [ $((i % 5)) -eq 0 ] && echo "   Still connecting... ($i/30)"
done

if [ -n "$URL" ]; then
  update_redirect "$URL"
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Permanent: https://${REPO%/*}.github.io/${REPO#*/}/"
echo "║  Local:     http://localhost:3000"
echo "║  Direct:    ${URL:-waiting...}"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Share the Permanent URL with anyone!"
echo ""
echo "Press Ctrl+C to stop all services."

# Monitor loop
while true; do
  sleep 30

  if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "[!] Server died, restarting..."
    DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" node server.js &
    SERVER_PID=$!
  fi

  if ! kill -0 $TUNNEL_PID 2>/dev/null; then
    echo "[!] Tunnel died, restarting..."
    /tmp/cloudflared tunnel --url http://localhost:3000 2>&1 | while read line; do
      echo "$line" | grep -q "trycloudflare.com" && echo "$line" | grep -o 'https://[^.]*\.trycloudflare\.com' > /tmp/slash_music_url.txt
    done &
    TUNNEL_PID=$!
    sleep 5
    NEW_URL=$(cat /tmp/slash_music_url.txt 2>/dev/null)
    if [ -n "$NEW_URL" ] && [ "$NEW_URL" != "$URL" ]; then
      URL="$NEW_URL"
      update_redirect "$URL"
    fi
  fi
done
