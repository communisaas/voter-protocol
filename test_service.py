#!/usr/bin/env python3
"""
Test script for VOTER Protocol Service Provider API
Tests the unified architecture without full agent dependencies
"""

import asyncio
import json
import sys
from pathlib import Path

# Add current directory to path
sys.path.insert(0, str(Path(__file__).parent))

import requests
import time
from subprocess import Popen, PIPE

def test_service_endpoints():
    """Test all service endpoints"""
    base_url = "http://localhost:8000"
    
    print("🧪 Testing VOTER Protocol Service Provider API")
    print("=" * 50)
    
    # Test 1: Health check
    try:
        response = requests.get(f"{base_url}/health")
        print(f"✅ Health Check: {response.status_code}")
        if response.status_code == 200:
            health_data = response.json()
            print(f"   Service: {health_data.get('service')}")
            print(f"   Integration: {health_data.get('integration')}")
        print()
    except Exception as e:
        print(f"❌ Health Check Failed: {e}")
        return False
    
    # Test 2: List services
    try:
        response = requests.get(f"{base_url}/api/services")
        print(f"✅ List Services: {response.status_code}")
        if response.status_code == 200:
            services_data = response.json()
            for service, details in services_data.get('services', {}).items():
                print(f"   - {service}: {details['description']}")
        print()
    except Exception as e:
        print(f"❌ List Services Failed: {e}")
    
    # Test 3: Advanced consensus
    try:
        consensus_request = {
            "verification_id": "test_123",
            "template_data": {
                "message": "Test congressional message about healthcare",
                "representative": "Rep. Test",
                "district": "XX-01"
            },
            "severity_level": 8,
            "existing_votes": {}
        }
        
        response = requests.post(
            f"{base_url}/api/consensus",
            json=consensus_request,
            headers={"Content-Type": "application/json"}
        )
        print(f"✅ Advanced Consensus: {response.status_code}")
        if response.status_code == 200:
            consensus_data = response.json()
            print(f"   Approved: {consensus_data.get('approved')}")
            print(f"   Consensus Score: {consensus_data.get('consensus_score'):.2f}")
            print(f"   Recommendation: {consensus_data.get('recommendation')}")
        print()
    except Exception as e:
        print(f"❌ Advanced Consensus Failed: {e}")
    
    # Test 4: Reputation calculation
    try:
        reputation_request = {
            "user_address": "0x123456789abcdef",
            "verification_id": "test_123",
            "consensus_result": {"consensus_score": 0.85},
            "template_quality": 78
        }
        
        response = requests.post(
            f"{base_url}/api/reputation", 
            json=reputation_request,
            headers={"Content-Type": "application/json"}
        )
        print(f"✅ Reputation Calculation: {response.status_code}")
        if response.status_code == 200:
            reputation_data = response.json()
            print(f"   Reputation Delta: +{reputation_data.get('reputation_delta'):.2f}")
            print(f"   New Total: {reputation_data.get('total_reputation'):.2f}")
            print(f"   Explanation: {reputation_data.get('explanation')}")
        print()
    except Exception as e:
        print(f"❌ Reputation Calculation Failed: {e}")
    
    # Test 5: Verification enhancement
    try:
        enhancement_request = {
            "template_id": "template_123",
            "verification_id": "test_123", 
            "template_data": {
                "message": "Test message for enhancement",
                "subject": "Healthcare Reform Discussion"
            },
            "current_severity": 6
        }
        
        response = requests.post(
            f"{base_url}/api/enhance",
            json=enhancement_request,
            headers={"Content-Type": "application/json"}
        )
        print(f"✅ Verification Enhancement: {response.status_code}")
        if response.status_code == 200:
            enhancement_data = response.json()
            print(f"   Enhanced Severity: {enhancement_data.get('enhanced_severity')}")
            print(f"   Confidence: {enhancement_data.get('confidence'):.2f}")
            print(f"   Recommendations: {enhancement_data.get('recommendations')}")
        print()
    except Exception as e:
        print(f"❌ Verification Enhancement Failed: {e}")
    
    print("🎉 Service Provider API Testing Complete!")
    print("\n📋 Architecture Summary:")
    print("   Role: Service Provider for Communiqué N8N Pipeline")
    print("   Orchestration: Handled by Communiqué (not VOTER Protocol)")
    print("   Services: Advanced consensus, reputation, verification enhancement")
    print("   Integration: Optional calls from Communiqué for complex cases")
    
    return True

if __name__ == "__main__":
    print("🚀 VOTER Protocol Service Provider Test")
    print("Note: This tests the API structure without full agent dependencies")
    print()
    
    # For demo purposes, just test the endpoints are structured correctly
    # In production, these would connect to actual agents
    test_service_endpoints()