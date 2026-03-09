#!/bin/bash
set -e

NAMESPACE_ID="0fec6982d8644118aba1830afd4a58cb"
DIR="$(cd "$(dirname "$0")/data" && pwd)"

echo "🌱 Seeding Bella KV brain — namespace: $NAMESPACE_ID"
echo ""

echo "→ brain:bella:prompt"
wrangler kv key put "brain:bella:prompt" --namespace-id="$NAMESPACE_ID" --path="$DIR/01_system_prompt.txt" --remote

echo "→ brain:bella:state_machine"
wrangler kv key put "brain:bella:state_machine" --namespace-id="$NAMESPACE_ID" --path="$DIR/02_state_machine.json" --remote

echo "→ brain:bella:trigger_matrix"
wrangler kv key put "brain:bella:trigger_matrix" --namespace-id="$NAMESPACE_ID" --path="$DIR/03_trigger_matrix.json" --remote

echo "→ brain:bella:calc_rules"
wrangler kv key put "brain:bella:calc_rules" --namespace-id="$NAMESPACE_ID" --path="$DIR/04_calc_rules.json" --remote

echo "→ brain:bella:fallback_lines"
wrangler kv key put "brain:bella:fallback_lines" --namespace-id="$NAMESPACE_ID" --path="$DIR/05_fallback_lines.txt" --remote

echo "→ brain:bella:script_kb"
wrangler kv key put "brain:bella:script_kb" --namespace-id="$NAMESPACE_ID" --path="$DIR/06_script_kb.txt" --remote

echo "→ brain:bella:voice_rag"
wrangler kv key put "brain:bella:voice_rag" --namespace-id="$NAMESPACE_ID" --path="$DIR/07_voice_rag.json" --remote

echo ""
echo "✅ All 7 brain keys seeded successfully."
