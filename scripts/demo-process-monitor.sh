#!/bin/bash
# Monitor audio and vitest processes during demo
# Run with: bash scripts/demo-process-monitor.sh

LOG_FILE="/tmp/accordo-process-monitor.log"
INTERVAL=1

echo "Monitoring audio processes (aplay, afplay, vitest)..."
echo "Log: $LOG_FILE"
echo "--- $(date) --- START ---" >> "$LOG_FILE"

while true; do
  TS=$(date '+%H:%M:%S')
  
  APLAY_COUNT=$(pgrep -c aplay 2>/dev/null || echo 0)
  AFPLAY_COUNT=$(pgrep -c afplay 2>/dev/null || echo 0)
  VITEST_COUNT=$(pgrep -c vitest 2>/dev/null || echo 0)
  
  # Always log if non-zero, or every 10 seconds for heartbeat
  if [ "$APLAY_COUNT" -gt 0 ] || [ "$AFPLAY_COUNT" -gt 0 ] || [ "$VITEST_COUNT" -gt 0 ]; then
    echo "[$TS] aplay=$APLAY_COUNT afplay=$AFPLAY_COUNT vitest=$VITEST_COUNT" | tee -a "$LOG_FILE"
  fi
  
  sleep $INTERVAL
done