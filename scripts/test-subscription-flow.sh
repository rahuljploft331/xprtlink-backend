#!/bin/bash
# XpertLink Expert Subscription Flow - End-to-End Test Script
# Run: bash test-subscription-flow.sh

BASE_URL="http://localhost:4000"
PASS=true

echo ""
echo "========================================"
echo " XpertLink Expert Subscription Flow Test"
echo "========================================"

# ── STEP 1: Login ────────────────────────────────────────────────
echo ""
echo "➡  STEP 1: Expert Login..."
LOGIN_RESP=$(curl -s -X POST "$BASE_URL/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"role":"expert","email":"ava.chen@expert.local","password":"Expert@123"}')
echo "$LOGIN_RESP" | python3 -m json.tool 2>/dev/null || echo "$LOGIN_RESP"

TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('accessToken',''))" 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "❌ STEP 1 FAILED: No accessToken in response"
  PASS=false
else
  echo "✅ STEP 1 PASSED — Token acquired"
fi

# ── STEP 2: List Plans ───────────────────────────────────────────
echo ""
echo "➡  STEP 2: List Subscription Plans..."
PLANS_RESP=$(curl -s -X GET "$BASE_URL/api/v1/billing/subscriptions/plans" \
  -H "Authorization: Bearer $TOKEN")
echo "$PLANS_RESP" | python3 -m json.tool 2>/dev/null || echo "$PLANS_RESP"

PLAN_CODE=$(echo "$PLANS_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
plans = d.get('data', [])
pro = next((p for p in plans if p.get('code') == 'professional'), plans[0] if plans else None)
print(pro.get('code','') if pro else '')
" 2>/dev/null)
if [ -z "$PLAN_CODE" ]; then
  echo "❌ STEP 2 FAILED: No plans returned"
  PASS=false
else
  echo "✅ STEP 2 PASSED — Plan code: $PLAN_CODE"
fi

# ── STEP 3: Subscribe ────────────────────────────────────────────
echo ""
echo "➡  STEP 3: Subscribe to '$PLAN_CODE' plan..."
SUB_RESP=$(curl -s -X POST "$BASE_URL/api/v1/billing/subscriptions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"planCode\":\"$PLAN_CODE\",\"store\":\"apple\",\"receiptData\":\"receipt_demo_token_123\"}")
echo "$SUB_RESP" | python3 -m json.tool 2>/dev/null || echo "$SUB_RESP"

SUB_STATUS=$(echo "$SUB_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('status',''))" 2>/dev/null)
if [ "$SUB_STATUS" = "active" ]; then
  echo "✅ STEP 3 PASSED — Subscription status: active"
else
  echo "❌ STEP 3 FAILED — Expected 'active', got: '$SUB_STATUS'"
  PASS=false
fi

# ── STEP 4: Check /subscriptions/me ─────────────────────────────
echo ""
echo "➡  STEP 4: Check /billing/subscriptions/me..."
ME_RESP=$(curl -s -X GET "$BASE_URL/api/v1/billing/subscriptions/me" \
  -H "Authorization: Bearer $TOKEN")
echo "$ME_RESP" | python3 -m json.tool 2>/dev/null || echo "$ME_RESP"

ME_STATUS=$(echo "$ME_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('status',''))" 2>/dev/null)
if [ "$ME_STATUS" = "active" ]; then
  echo "✅ STEP 4 PASSED — Subscription status: active"
else
  echo "❌ STEP 4 FAILED — Expected 'active', got: '$ME_STATUS'"
  PASS=false
fi

# ── STEP 5: Check /experts/me ────────────────────────────────────
echo ""
echo "➡  STEP 5: Check /experts/me (subscriptionActive flag)..."
EXPERT_RESP=$(curl -s -X GET "$BASE_URL/api/v1/experts/me" \
  -H "Authorization: Bearer $TOKEN")
echo "$EXPERT_RESP" | python3 -m json.tool 2>/dev/null || echo "$EXPERT_RESP"

SUB_ACTIVE=$(echo "$EXPERT_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d.get('data',{}).get('subscriptionActive','')).lower())" 2>/dev/null)
if [ "$SUB_ACTIVE" = "true" ]; then
  echo "✅ STEP 5 PASSED — subscriptionActive: true"
else
  echo "❌ STEP 5 FAILED — Expected subscriptionActive: true, got: '$SUB_ACTIVE'"
  PASS=false
fi

# ── Summary ──────────────────────────────────────────────────────
echo ""
echo "========================================"
if [ "$PASS" = true ]; then
  echo " ✅ ALL STEPS PASSED"
else
  echo " ❌ SOME STEPS FAILED — review output above"
fi
echo "========================================"
