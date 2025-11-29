#!/bin/bash
# Shadow Atlas Discovery Agent Launcher
# Runs Phoenix observability dashboard + discovery agent

set -e
cd "$(dirname "$0")"

# Activate virtual environment
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3.13 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
else
    source .venv/bin/activate
fi

# Check if Phoenix server is running
if ! curl -s http://localhost:6006/health > /dev/null 2>&1; then
    echo ""
    echo "=== Starting Phoenix Observability Dashboard ==="
    echo "Dashboard will be available at: http://localhost:6006"
    echo ""

    # Start Phoenix in background
    python -m phoenix.server.main serve &
    PHOENIX_PID=$!

    # Wait for Phoenix to start
    echo "Waiting for Phoenix to start..."
    for i in {1..30}; do
        if curl -s http://localhost:6006/health > /dev/null 2>&1; then
            echo "Phoenix started successfully!"
            break
        fi
        sleep 1
    done
else
    echo "Phoenix already running at http://localhost:6006"
fi

echo ""
echo "=== Starting Boundary Discovery Agent ==="
echo ""

# Run the agent with provided arguments
python agent.py "$@"

# Keep Phoenix running for inspection
if [ ! -z "$PHOENIX_PID" ]; then
    echo ""
    echo "Phoenix dashboard still running at http://localhost:6006"
    echo "Press Ctrl+C to stop Phoenix, or run 'kill $PHOENIX_PID'"
fi
