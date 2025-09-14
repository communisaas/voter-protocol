#!/usr/bin/env python3
"""
Start script for VOTER Protocol Agent API Server
Simplified for N8N integration - no LangChain dependencies
"""

import os
import sys
import uvicorn
from pathlib import Path

# Add current directory to Python path
sys.path.insert(0, str(Path(__file__).parent))

# Import our FastAPI app
from api.server import app

if __name__ == "__main__":
    # Get configuration from environment
    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", 8000))
    reload = os.getenv("API_RELOAD", "true").lower() == "true"
    log_level = os.getenv("LOG_LEVEL", "info")
    
    print("🚀 Starting VOTER Protocol Agent Service")
    print(f"📡 Host: {host}:{port}")
    print(f"🔄 Reload: {reload}")
    print(f"🔍 Log Level: {log_level}")
    print(f"🎯 Role: Service Provider for Communiqué N8N Pipeline")
    print(f"🏗️  Architecture: Specialized Services (not orchestrator)")
    print(f"📋 Available services:")
    print(f"   - GET  /health - Service health check")
    print(f"   - POST /api/consensus - Advanced multi-agent consensus")
    print(f"   - POST /api/reputation - Quadratic reputation calculations")
    print(f"   - POST /api/enhance - Verification enhancement")
    print(f"   - GET  /api/services - List all services")
    print()
    
    # Start the server
    uvicorn.run(
        "api.server:app",
        host=host,
        port=port,
        reload=reload,
        log_level=log_level
    )