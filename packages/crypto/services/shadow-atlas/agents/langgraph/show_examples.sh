#!/bin/bash

echo "═══════════════════════════════════════════════════════════════"
echo "  MOST EGREGIOUS MISLABELS - CONCRETE EXAMPLES"
echo "═══════════════════════════════════════════════════════════════"
echo ""

echo "Example 1: Service literally named 'CouncilDistricts'"
echo "────────────────────────────────────────────────────────────────"
jq -r 'select(.service_name == "CouncilDistricts") | 
  "Title: " + .title + "\n" +
  "URL: " + .url + "\n" +
  "Service Name: CouncilDistricts\n" +
  "Labeled As: FALSE ← WRONG\n" +
  "Should Be: TRUE\n" +
  "Confidence: " + (.url_confidence|tostring) + "%\n"' \
  /Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/langgraph/url_validation_details.jsonl | head -20
echo ""

echo "Example 2: Baltimore City Council Districts 2021"
echo "────────────────────────────────────────────────────────────────"
jq -r 'select(.service_name == "Baltimore_City_Council_Districts_2021") | 
  "Title: " + .title + "\n" +
  "URL: " + .url + "\n" +
  "Service Name: Baltimore_City_Council_Districts_2021\n" +
  "Labeled As: FALSE ← WRONG\n" +
  "Should Be: TRUE\n" +
  "Confidence: " + (.url_confidence|tostring) + "%\n" +
  "Evidence: City name + Council_Districts in official service name\n"' \
  /Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/langgraph/url_validation_details.jsonl
echo ""

echo "Example 3: Ward Boundaries (Municipal subdivision = council districts)"
echo "────────────────────────────────────────────────────────────────"
jq -r 'select(.service_name | test("Ward.*Bound"; "i")) | 
  "Title: " + .title + "\n" +
  "Service: " + .service_name + "\n" +
  "Labeled As: " + (if .label then "TRUE" else "FALSE" end) + "\n" +
  "URL Confidence: " + (.url_confidence|tostring) + "%\n"' \
  /Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/langgraph/url_validation_details.jsonl | head -40
echo ""

echo "Example 4: Correct FALSE labels (Thematic overlays)"
echo "────────────────────────────────────────────────────────────────"
jq -r 'select(.service_name | test("Census|Crime|Fire"; "i")) | 
  "Title: " + .title + "\n" +
  "Service: " + .service_name + "\n" +
  "Labeled As: FALSE ← CORRECT\n" +
  "Reasoning: Thematic data ABOUT districts, not district boundaries\n"' \
  /Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/langgraph/url_validation_details.jsonl | head -30
echo ""

echo "═══════════════════════════════════════════════════════════════"
