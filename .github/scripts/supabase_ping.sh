#!/usr/bin/env bash
# One small read from Supabase so the free project doesn't pause from inactivity.
# Never fails the workflow: a problem here only shows a warning on the run page.
set -u

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_KEY:-}" ]; then
  echo "Supabase secrets not set yet; skipping."
  exit 0
fi

STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  "${SUPABASE_URL%/}/rest/v1/push_subs?select=endpoint&limit=1") || STATUS="no answer"

if [ "$STATUS" = "200" ]; then
  echo "Supabase is awake."
else
  echo "::warning::Couldn't reach Supabase (status: $STATUS). Check the SUPABASE_URL and SUPABASE_SERVICE_KEY secrets, or open the project on supabase.com and click Restore if it paused."
fi
exit 0
