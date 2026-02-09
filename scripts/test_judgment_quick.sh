#!/bin/bash
# Quick test script for judgment creation

echo "🧪 Quick Judgment Test"
echo "======================"
echo ""

# Test 1: Health check
echo "1. Testing API health..."
HEALTH=$(curl -s http://localhost:3000/health | jq -r '.status' 2>/dev/null)
if [ "$HEALTH" = "ok" ]; then
  echo "   ✅ API is running"
else
  echo "   ❌ API is not running. Start with: npm start"
  exit 1
fi

# Test 2: Get first opportunity
echo ""
echo "2. Fetching opportunities..."
OPP_ID=$(curl -s http://localhost:3000/api/opportunities | jq -r '.opportunities[0].id' 2>/dev/null)
if [ -z "$OPP_ID" ] || [ "$OPP_ID" = "null" ]; then
  echo "   ❌ No opportunities found"
  exit 1
fi
OPP_TITLE=$(curl -s http://localhost:3000/api/opportunities | jq -r '.opportunities[0].title' 2>/dev/null)
echo "   ✅ Found opportunity: $OPP_TITLE"

# Test 3: Test signals endpoint
echo ""
echo "3. Testing signals endpoint..."
SIGNALS_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/opportunities/$OPP_ID/signals)
if [ "$SIGNALS_RESPONSE" = "200" ]; then
  SIGNAL_COUNT=$(curl -s http://localhost:3000/api/opportunities/$OPP_ID/signals | jq 'length' 2>/dev/null)
  echo "   ✅ Signals endpoint works ($SIGNAL_COUNT signals)"
else
  echo "   ⚠️  Signals endpoint returned $SIGNALS_RESPONSE (server may need restart)"
fi

# Test 4: Test judgment creation
echo ""
echo "4. Testing judgment creation..."
JUDGMENT_RESPONSE=$(curl -s -X POST http://localhost:3000/api/judgments \
  -H "Content-Type: application/json" \
  -d "{
    \"opportunityId\": \"$OPP_ID\",
    \"userId\": \"test-user@example.com\",
    \"analysis\": \"Test analysis\",
    \"recommendation\": \"Test recommendation\",
    \"confidence\": 0.7
  }" | jq -r '.error // .id' 2>/dev/null)

if [[ "$JUDGMENT_RESPONSE" == *"requires Cursor extension"* ]] || [[ "$JUDGMENT_RESPONSE" == "501" ]]; then
  echo "   ❌ Server is running OLD code. Restart with: npm start"
elif [[ "$JUDGMENT_RESPONSE" == *"-"* ]]; then
  echo "   ✅ Judgment created: $JUDGMENT_RESPONSE"
else
  echo "   ⚠️  Unexpected response: $JUDGMENT_RESPONSE"
fi

echo ""
echo "Summary:"
echo "- API Health: $([ "$HEALTH" = "ok" ] && echo "✅" || echo "❌")"
echo "- Opportunities API: ✅"
echo "- Signals API: $([ "$SIGNALS_RESPONSE" = "200" ] && echo "✅" || echo "⚠️  Restart needed")"
echo "- Judgment API: $([[ "$JUDGMENT_RESPONSE" == *"-"* ]] && echo "✅" || echo "⚠️  Restart needed")"
