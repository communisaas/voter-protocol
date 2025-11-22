#!/usr/bin/env bash
# Shadow Atlas Provenance Query Tool
# Provides jq-based queries for compact NDJSON discovery logs
#
# Usage: ./scripts/query-provenance.sh [command] [options]
#
# SPDX-License-Identifier: MIT

set -euo pipefail

# Color output support
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default configuration
DEFAULT_MONTH=$(date +%Y-%m)
LOG_DIR="discovery-attempts"
LOG_FILE="discovery-log.ndjson.gz"

# Detect zcat command (gzcat on macOS, zcat on Linux)
if command -v gzcat &> /dev/null; then
  ZCAT_CMD="gzcat"
elif command -v zcat &> /dev/null; then
  ZCAT_CMD="zcat"
else
  echo "Error: Neither zcat nor gzcat found. Please install gzip utilities." >&2
  exit 1
fi

# Usage information
usage() {
  cat << 'EOF'
Shadow Atlas Provenance Query Tool

USAGE:
  ./scripts/query-provenance.sh [COMMAND] [OPTIONS]

COMMANDS:
  tiers              Show distribution across granularity tiers (0-4)
  blockers           Analyze blocker codes preventing higher tiers
  state <STATE>      Show cities discovered for specific state (e.g., CA)
  authority          Breakdown by authority level (0-5)
  confidence         Histogram of confidence scores
  failures           Show last 20 blocked discovery attempts with reasoning
  search <FIPS>      Search by FIPS code or city name
  quality            Analyze quality metrics (topology, validation)
  recent [N]         Show N most recent discoveries (default: 20)
  stats              Overall statistics summary
  help               Show this help message

OPTIONS:
  --month YYYY-MM    Query specific month (default: current month)
  --all-months       Query all available months
  --no-color         Disable colored output
  --json             Output raw JSON (no formatting)

EXAMPLES:
  # Show tier distribution for current month
  ./scripts/query-provenance.sh tiers

  # Analyze blockers from October 2025
  ./scripts/query-provenance.sh blockers --month 2025-10

  # Find all California cities
  ./scripts/query-provenance.sh state CA

  # Search for specific city
  ./scripts/query-provenance.sh search "San Diego"

  # Show recent failures across all months
  ./scripts/query-provenance.sh failures --all-months

  # Get raw JSON stats
  ./scripts/query-provenance.sh stats --json

DATA FORMAT:
  Compressed NDJSON logs stored in: discovery-attempts/YYYY-MM/discovery-log.ndjson.gz
  Field reference: See PROVENANCE-SPEC.md for complete schema

EOF
  exit 0
}

# Parse options
MONTH="$DEFAULT_MONTH"
ALL_MONTHS=false
USE_COLOR=true
OUTPUT_JSON=false

parse_options() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      --month)
        MONTH="$2"
        shift 2
        ;;
      --all-months)
        ALL_MONTHS=true
        shift
        ;;
      --no-color)
        USE_COLOR=false
        shift
        ;;
      --json)
        OUTPUT_JSON=true
        shift
        ;;
      *)
        break
        ;;
    esac
  done

  # Return remaining args
  echo "$@"
}

# Color wrapper
color_print() {
  local color=$1
  shift
  if [[ "$USE_COLOR" == "true" ]]; then
    echo -e "${color}$*${NC}"
  else
    echo "$*"
  fi
}

# Get log file path(s)
get_log_path() {
  if [[ "$ALL_MONTHS" == "true" ]]; then
    find "$LOG_DIR" -name "$LOG_FILE" 2>/dev/null | sort
  else
    local path="$LOG_DIR/$MONTH/$LOG_FILE"
    if [[ -f "$path" ]]; then
      echo "$path"
    else
      color_print "$RED" "Error: Log file not found: $path"
      color_print "$YELLOW" "Available months:"
      find "$LOG_DIR" -name "$LOG_FILE" 2>/dev/null | sed 's|.*/\([0-9-]*\)/.*|  \1|' | sort -u
      exit 1
    fi
  fi
}

# Decompress and stream log(s)
stream_logs() {
  local paths
  paths=$(get_log_path)

  if [[ -z "$paths" ]]; then
    color_print "$RED" "Error: No log files found"
    exit 1
  fi

  while IFS= read -r path; do
    "$ZCAT_CMD" "$path"
  done <<< "$paths"
}

# Command: Tier distribution
cmd_tiers() {
  color_print "$CYAN" "=== Granularity Tier Distribution ==="
  echo

  if [[ "$OUTPUT_JSON" == "true" ]]; then
    stream_logs | jq -s 'group_by(.g) | map({tier: .[0].g, count: length, cities: map(.n), total_pop: (map(.p) | add)})'
  else
    color_print "$BLUE" "TIER  COUNT  DESCRIPTION                 TOTAL POPULATION"
    color_print "$BLUE" "----  -----  --------------------------  ----------------"

    stream_logs | jq -r '.g' | sort | uniq -c | while read -r count tier; do
      local desc
      case $tier in
        0) desc="Precinct (finest)";;
        1) desc="Council district";;
        2) desc="Municipal boundary";;
        3) desc="County subdivision";;
        4) desc="County (fallback)";;
        *) desc="Unknown";;
      esac

      # Get total population for this tier
      local total_pop
      total_pop=$(stream_logs | jq -r "select(.g == $tier) | .p" | awk '{sum+=$1} END {printf "%.0f", sum}')

      # Format population with thousands separator (fallback to raw if printf doesn't support)
      local pop_fmt
      pop_fmt=$(printf "%'d" "$total_pop" 2>/dev/null || echo "$total_pop")

      printf "  %-4s  %-5s  %-26s  %16s\n" "$tier" "$count" "$desc" "$pop_fmt"
    done

    echo
    color_print "$GREEN" "Total cities: $(stream_logs | wc -l | tr -d ' ')"
  fi
}

# Command: Blocker analysis
cmd_blockers() {
  color_print "$CYAN" "=== Blocker Code Analysis ==="
  echo

  if [[ "$OUTPUT_JSON" == "true" ]]; then
    stream_logs | jq -s 'map(select(.blocked != null)) | group_by(.blocked) | map({blocker: .[0].blocked, count: length, avg_tier: (map(.g) | add / length), examples: (map(.n) | .[0:3])})'
  else
    color_print "$BLUE" "COUNT  BLOCKER CODE                    AVG TIER  EXAMPLES"
    color_print "$BLUE" "-----  ------------------------------  --------  --------"

    stream_logs | jq -r 'select(.blocked != null) | .blocked' | sort | uniq -c | sort -rn | while read -r count blocker; do
      # Calculate average tier for this blocker
      local avg_tier
      avg_tier=$(stream_logs | jq -r "select(.blocked == \"$blocker\") | .g" | awk '{sum+=$1; n++} END {if(n>0) printf "%.1f", sum/n; else print "N/A"}')

      # Get example cities
      local examples
      examples=$(stream_logs | jq -r "select(.blocked == \"$blocker\") | .n" | head -3 | paste -sd "," -)

      printf "%-5s  %-30s  %-8s  %s\n" "$count" "$blocker" "$avg_tier" "$examples"
    done

    echo
    local total_blocked
    total_blocked=$(stream_logs | jq -r 'select(.blocked != null)' | wc -l | tr -d ' ')
    color_print "$YELLOW" "Total blocked attempts: $total_blocked"
  fi
}

# Command: State coverage
cmd_state() {
  local state="$1"

  if [[ -z "$state" ]]; then
    color_print "$RED" "Error: State code required (e.g., CA, NY, TX)"
    echo
    color_print "$YELLOW" "Available states:"
    stream_logs | jq -r '.s' | sort -u | paste -sd ", " -
    exit 1
  fi

  color_print "$CYAN" "=== Cities in $state ==="
  echo

  if [[ "$OUTPUT_JSON" == "true" ]]; then
    stream_logs | jq -c "select(.s == \"$state\")"
  else
    color_print "$BLUE" "FIPS      CITY                     POP        TIER  CONF  AUTH  SOURCE"
    color_print "$BLUE" "--------  -----------------------  ---------  ----  ----  ----  ------"

    stream_logs | jq -r "select(.s == \"$state\") | [.f, .n, .p, .g, .conf, .auth, .src] | @tsv" | \
      while IFS=$'\t' read -r fips name pop tier conf auth src; do
        # Format population with thousands separator
        local pop_fmt
        pop_fmt=$(printf "%'d" "$pop" 2>/dev/null || echo "$pop")
        printf "%-8s  %-23s  %9s  %-4s  %-4s  %-4s  %s\n" "$fips" "$name" "$pop_fmt" "$tier" "$conf" "$auth" "$src"
      done

    echo
    local count
    count=$(stream_logs | jq -r "select(.s == \"$state\")" | wc -l | tr -d ' ')
    color_print "$GREEN" "Total cities in $state: $count"
  fi
}

# Command: Authority breakdown
cmd_authority() {
  color_print "$CYAN" "=== Authority Level Distribution ==="
  echo

  if [[ "$OUTPUT_JSON" == "true" ]]; then
    stream_logs | jq -s 'group_by(.auth) | map({authority: .[0].auth, count: length, avg_conf: (map(.conf) | add / length), avg_tier: (map(.g) | add / length)})'
  else
    color_print "$BLUE" "AUTH  COUNT  DESCRIPTION              AVG CONF  AVG TIER"
    color_print "$BLUE" "----  -----  -----------------------  --------  --------"

    for auth in {0..5}; do
      local count
      count=$(stream_logs | jq -r "select(.auth == $auth)" | wc -l | tr -d ' ')

      if [[ "$count" -gt 0 ]]; then
        local desc
        case $auth in
          5) desc="Federal mandate";;
          4) desc="State mandate";;
          3) desc="Municipal official";;
          2) desc="Hub aggregator";;
          1) desc="Community maintained";;
          0) desc="Unknown";;
        esac

        local avg_conf avg_tier
        avg_conf=$(stream_logs | jq -r "select(.auth == $auth) | .conf" | awk '{sum+=$1; n++} END {printf "%.1f", sum/n}')
        avg_tier=$(stream_logs | jq -r "select(.auth == $auth) | .g" | awk '{sum+=$1; n++} END {printf "%.1f", sum/n}')

        printf "%-4s  %-5s  %-23s  %-8s  %s\n" "$auth" "$count" "$desc" "$avg_conf" "$avg_tier"
      fi
    done

    echo
    color_print "$GREEN" "Authority levels: 0=Unknown, 1=Community, 2=Hub, 3=Municipal, 4=State, 5=Federal"
  fi
}

# Command: Confidence histogram
cmd_confidence() {
  color_print "$CYAN" "=== Confidence Score Distribution ==="
  echo

  if [[ "$OUTPUT_JSON" == "true" ]]; then
    stream_logs | jq -r '.conf' | awk '{
      bin=int($1/10)*10;
      count[bin]++
    } END {
      for (b in count) {
        printf "{\"range\":\"%d-%d\",\"count\":%d}\n", b, b+9, count[b]
      }
    }' | jq -s 'sort_by(.range)'
  else
    color_print "$BLUE" "RANGE      COUNT  DISTRIBUTION"
    color_print "$BLUE" "---------  -----  ------------"

    local max_count
    max_count=$(stream_logs | jq -r '.conf' | awk '{bin=int($1/10)*10; count[bin]++} END {max=0; for(b in count) if(count[b]>max) max=count[b]; print max}')

    stream_logs | jq -r '.conf' | awk -v max="$max_count" '{
      bin=int($1/10)*10;
      count[bin]++
    } END {
      for (b=0; b<100; b+=10) {
        if (count[b] > 0) {
          printf "%3d-%-3d  %5d  ", b, b+9, count[b]
          bars = int(count[b] / max * 50)
          for (i=0; i<bars; i++) printf "█"
          printf "\n"
        }
      }
    }'

    echo
    local avg
    avg=$(stream_logs | jq -r '.conf' | awk '{sum+=$1; n++} END {printf "%.1f", sum/n}')
    color_print "$GREEN" "Average confidence: $avg"
  fi
}

# Command: Recent failures
cmd_failures() {
  local limit=${1:-20}

  color_print "$CYAN" "=== Recent Blocked Discoveries (Last $limit) ==="
  echo

  if [[ "$OUTPUT_JSON" == "true" ]]; then
    stream_logs | jq -c 'select(.blocked != null)' | tail -n "$limit" | jq -s '.'
  else
    stream_logs | jq -r 'select(.blocked != null) | [.ts, .n, .s, .g, .blocked, (.why | join(" | "))] | @tsv' | \
      tail -n "$limit" | \
      while IFS=$'\t' read -r ts name state tier blocker why; do
        color_print "$YELLOW" "[$ts] $name, $state"
        color_print "$RED" "  Blocked at tier $tier: $blocker"
        color_print "$NC" "  Reasoning: $why"
        echo
      done
  fi
}

# Command: Search
cmd_search() {
  local query="$1"

  if [[ -z "$query" ]]; then
    color_print "$RED" "Error: Search query required"
    exit 1
  fi

  color_print "$CYAN" "=== Search Results: '$query' ==="
  echo

  # Convert query to lowercase using tr for compatibility
  local query_lower
  query_lower=$(echo "$query" | tr '[:upper:]' '[:lower:]')

  if [[ "$OUTPUT_JSON" == "true" ]]; then
    stream_logs | jq -c "select(.f | contains(\"$query\")) or select(.n | ascii_downcase | contains(\"$query_lower\"))"
  else
    local results
    results=$(stream_logs | jq -c "select(.f | contains(\"$query\")) or select(.n | ascii_downcase | contains(\"$query_lower\"))")

    if [[ -z "$results" ]]; then
      color_print "$YELLOW" "No results found for: $query"
      exit 0
    fi

    echo "$results" | jq -r '[.f, .n, .s, .p, .g, .conf, .auth, .src] | @tsv' | \
      while IFS=$'\t' read -r fips name state pop tier conf auth src; do
        # Format population with thousands separator
        local pop_formatted
        pop_formatted=$(printf "%'d" "$pop" 2>/dev/null || echo "$pop")
        color_print "$GREEN" "FIPS: $fips | $name, $state | Pop: $pop_formatted"
        echo "  Tier: $tier | Confidence: $conf | Authority: $auth | Source: $src"
        echo
      done

    local count
    count=$(echo "$results" | wc -l | tr -d ' ')
    color_print "$BLUE" "Total results: $count"
  fi
}

# Command: Quality metrics
cmd_quality() {
  color_print "$CYAN" "=== Quality Metrics Analysis ==="
  echo

  if [[ "$OUTPUT_JSON" == "true" ]]; then
    stream_logs | jq -s '{
      valid_geojson: (map(select(.q.v == true)) | length),
      topology_clean: (map(select(.q.t == 1)) | length),
      topology_gaps: (map(select(.q.t == 0)) | length),
      topology_overlaps: (map(select(.q.t == 2)) | length),
      avg_response_time: (map(.q.r) | add / length),
      with_vintage: (map(select(.q.d != null)) | length)
    }'
  else
    local total valid_geo topo_clean topo_gaps topo_overlaps avg_response with_vintage

    total=$(stream_logs | wc -l | tr -d ' ')
    valid_geo=$(stream_logs | jq -r 'select(.q.v == true)' | wc -l | tr -d ' ')
    topo_clean=$(stream_logs | jq -r 'select(.q.t == 1)' | wc -l | tr -d ' ')
    topo_gaps=$(stream_logs | jq -r 'select(.q.t == 0)' | wc -l | tr -d ' ')
    topo_overlaps=$(stream_logs | jq -r 'select(.q.t == 2)' | wc -l | tr -d ' ')
    avg_response=$(stream_logs | jq -r '.q.r' | awk '{sum+=$1; n++} END {printf "%.0f", sum/n}')
    with_vintage=$(stream_logs | jq -r 'select(.q.d != null)' | wc -l | tr -d ' ')

    color_print "$BLUE" "Total discoveries: $total"
    echo

    # Calculate percentages using awk
    local pct_valid pct_clean pct_gaps pct_overlaps pct_vintage
    pct_valid=$(echo "$valid_geo $total" | awk '{printf "%.1f", ($1/$2)*100}')
    pct_clean=$(echo "$topo_clean $total" | awk '{printf "%.1f", ($1/$2)*100}')
    pct_gaps=$(echo "$topo_gaps $total" | awk '{printf "%.1f", ($1/$2)*100}')
    pct_overlaps=$(echo "$topo_overlaps $total" | awk '{printf "%.1f", ($1/$2)*100}')
    pct_vintage=$(echo "$with_vintage $total" | awk '{printf "%.1f", ($1/$2)*100}')

    color_print "$GREEN" "Valid GeoJSON: $valid_geo ($pct_valid%)"
    echo
    echo "Topology:"
    color_print "$GREEN" "  Clean: $topo_clean ($pct_clean%)"
    color_print "$YELLOW" "  Gaps: $topo_gaps ($pct_gaps%)"
    color_print "$RED" "  Overlaps: $topo_overlaps ($pct_overlaps%)"
    echo
    echo "Response time (avg): ${avg_response}ms"
    echo "With data vintage: $with_vintage ($pct_vintage%)"
  fi
}

# Command: Recent discoveries
cmd_recent() {
  local limit=${1:-20}

  color_print "$CYAN" "=== Recent Discoveries (Last $limit) ==="
  echo

  if [[ "$OUTPUT_JSON" == "true" ]]; then
    stream_logs | tail -n "$limit" | jq -s '.'
  else
    color_print "$BLUE" "TIME                 CITY                     STATE  TIER  CONF  SOURCE"
    color_print "$BLUE" "-------------------  -----------------------  -----  ----  ----  ------"

    stream_logs | tail -n "$limit" | jq -r '[.ts, .n, .s, .g, .conf, .src] | @tsv' | \
      while IFS=$'\t' read -r ts name state tier conf src; do
        printf "%-19s  %-23s  %-5s  %-4s  %-4s  %s\n" "${ts:0:19}" "$name" "$state" "$tier" "$conf" "$src"
      done
  fi
}

# Command: Statistics summary
cmd_stats() {
  color_print "$CYAN" "=== Overall Statistics ==="
  echo

  if [[ "$OUTPUT_JSON" == "true" ]]; then
    stream_logs | jq -s '{
      total_cities: length,
      total_population: (map(.p) | add),
      avg_confidence: (map(.conf) | add / length),
      tier_distribution: (group_by(.g) | map({tier: .[0].g, count: length})),
      authority_distribution: (group_by(.auth) | map({authority: .[0].auth, count: length})),
      source_distribution: (group_by(.src) | map({source: .[0].src, count: length})),
      blocked_count: (map(select(.blocked != null)) | length),
      success_rate: ((map(select(.blocked == null)) | length) / length * 100)
    }'
  else
    local total total_pop avg_conf blocked success_rate

    total=$(stream_logs | wc -l | tr -d ' ')
    total_pop=$(stream_logs | jq -r '.p' | awk '{sum+=$1} END {printf "%.0f", sum}')
    avg_conf=$(stream_logs | jq -r '.conf' | awk '{sum+=$1; n++} END {printf "%.1f", sum/n}')
    blocked=$(stream_logs | jq -r 'select(.blocked != null)' | wc -l | tr -d ' ')
    success_rate=$(awk "BEGIN {printf \"%.1f\", (($total-$blocked)/$total*100)}")

    # Format numbers with thousands separator (fallback to raw if printf doesn't support)
    local total_fmt total_pop_fmt
    total_fmt=$(printf "%'d" "$total" 2>/dev/null || echo "$total")
    total_pop_fmt=$(printf "%'d" "$total_pop" 2>/dev/null || echo "$total_pop")

    color_print "$GREEN" "Total cities: $total_fmt"
    color_print "$GREEN" "Total population: $total_pop_fmt"
    color_print "$BLUE" "Average confidence: $avg_conf"
    color_print "$YELLOW" "Blocked attempts: $blocked"
    color_print "$GREEN" "Success rate: $success_rate%"
    echo

    color_print "$CYAN" "Top sources:"
    stream_logs | jq -r '.src' | sort | uniq -c | sort -rn | head -5 | while read -r count src; do
      echo "  $src: $count"
    done
  fi
}

# Main dispatcher
main() {
  # Parse global options first
  local remaining
  remaining=$(parse_options "$@")

  # Get command
  local cmd="${1:-help}"
  shift || true

  case "$cmd" in
    tiers)
      cmd_tiers
      ;;
    blockers)
      cmd_blockers
      ;;
    state)
      cmd_state "$@"
      ;;
    authority)
      cmd_authority
      ;;
    confidence)
      cmd_confidence
      ;;
    failures)
      cmd_failures "$@"
      ;;
    search)
      cmd_search "$@"
      ;;
    quality)
      cmd_quality
      ;;
    recent)
      cmd_recent "$@"
      ;;
    stats)
      cmd_stats
      ;;
    help|--help|-h)
      usage
      ;;
    *)
      color_print "$RED" "Error: Unknown command '$cmd'"
      echo
      echo "Run './scripts/query-provenance.sh help' for usage information"
      exit 1
      ;;
  esac
}

# Run main
main "$@"
