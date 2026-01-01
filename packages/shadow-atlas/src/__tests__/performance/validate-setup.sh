#!/bin/bash
#
# Performance Benchmark Setup Validator
#
# USAGE: ./validate-setup.sh
#
# Validates that all prerequisites are met for running performance benchmarks

set -e

echo "🔍 Validating Shadow Atlas Performance Benchmark Setup..."
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

# Function to check command exists
check_command() {
    local cmd=$1
    local name=$2
    local install_hint=$3

    if command -v "$cmd" &> /dev/null; then
        echo -e "${GREEN}✓${NC} $name installed"
        return 0
    else
        echo -e "${RED}✗${NC} $name NOT installed"
        echo -e "  ${YELLOW}→${NC} Install: $install_hint"
        ((ERRORS++))
        return 1
    fi
}

# Function to check Node.js version
check_node_version() {
    if ! command -v node &> /dev/null; then
        echo -e "${RED}✗${NC} Node.js not installed"
        ((ERRORS++))
        return 1
    fi

    local version=$(node --version | sed 's/v//')
    local major=$(echo "$version" | cut -d. -f1)

    if [ "$major" -ge 20 ]; then
        echo -e "${GREEN}✓${NC} Node.js $version (>= 20 required)"
        return 0
    else
        echo -e "${RED}✗${NC} Node.js $version (>= 20 required)"
        ((ERRORS++))
        return 1
    fi
}

# Function to check disk space
check_disk_space() {
    local required_gb=10

    if command -v df &> /dev/null; then
        local available_mb=$(df -m . | tail -1 | awk '{print $4}')
        local available_gb=$((available_mb / 1024))

        if [ "$available_gb" -ge "$required_gb" ]; then
            echo -e "${GREEN}✓${NC} Disk space: ${available_gb}GB available (>= ${required_gb}GB required)"
            return 0
        else
            echo -e "${YELLOW}⚠${NC} Disk space: ${available_gb}GB available (>= ${required_gb}GB recommended)"
            echo -e "  ${YELLOW}→${NC} Benchmarks may fail if cache grows large"
            ((WARNINGS++))
            return 1
        fi
    else
        echo -e "${YELLOW}⚠${NC} Cannot check disk space (df command not available)"
        ((WARNINGS++))
        return 1
    fi
}

# Function to check memory
check_memory() {
    local required_mb=4096

    if command -v sysctl &> /dev/null; then
        # macOS
        local total_mb=$(sysctl -n hw.memsize | awk '{print $1/1024/1024}')
        local total_gb=$((total_mb / 1024))
        local required_gb=$((required_mb / 1024))

        if [ "$total_mb" -ge "$required_mb" ]; then
            echo -e "${GREEN}✓${NC} Memory: ${total_gb}GB total (>= ${required_gb}GB required)"
            return 0
        else
            echo -e "${RED}✗${NC} Memory: ${total_gb}GB total (>= ${required_gb}GB required)"
            echo -e "  ${YELLOW}→${NC} Benchmarks will likely fail due to memory constraints"
            ((ERRORS++))
            return 1
        fi
    elif [ -f /proc/meminfo ]; then
        # Linux
        local total_mb=$(grep MemTotal /proc/meminfo | awk '{print $2/1024}')
        local total_gb=$((total_mb / 1024))
        local required_gb=$((required_mb / 1024))

        if [ "$total_mb" -ge "$required_mb" ]; then
            echo -e "${GREEN}✓${NC} Memory: ${total_gb}GB total (>= ${required_gb}GB required)"
            return 0
        else
            echo -e "${RED}✗${NC} Memory: ${total_gb}GB total (>= ${required_gb}GB required)"
            echo -e "  ${YELLOW}→${NC} Benchmarks will likely fail due to memory constraints"
            ((ERRORS++))
            return 1
        fi
    else
        echo -e "${YELLOW}⚠${NC} Cannot check memory (sysctl/meminfo not available)"
        ((WARNINGS++))
        return 1
    fi
}

# Function to check network connectivity
check_network() {
    local host="ftp2.census.gov"

    if command -v nc &> /dev/null; then
        if timeout 5 nc -z "$host" 21 2>/dev/null; then
            echo -e "${GREEN}✓${NC} Network: Can reach Census Bureau FTP ($host:21)"
            return 0
        else
            echo -e "${RED}✗${NC} Network: Cannot reach Census Bureau FTP ($host:21)"
            echo -e "  ${YELLOW}→${NC} Check firewall and network connectivity"
            ((ERRORS++))
            return 1
        fi
    else
        echo -e "${YELLOW}⚠${NC} Cannot check network (nc command not available)"
        ((WARNINGS++))
        return 1
    fi
}

# Function to check GDAL
check_gdal() {
    if check_command "ogr2ogr" "GDAL (ogr2ogr)" "brew install gdal (macOS) or apt install gdal-bin (Ubuntu)"; then
        local version=$(ogr2ogr --version | head -1)
        echo -e "  ${GREEN}→${NC} $version"
        return 0
    else
        return 1
    fi
}

echo "=== Required Software ==="
check_node_version
check_gdal
echo ""

echo "=== Hardware Resources ==="
check_memory
check_disk_space
echo ""

echo "=== Network Connectivity ==="
check_network
echo ""

# Summary
echo "=== Summary ==="
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✓${NC} All prerequisites met!"
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}⚠${NC} $WARNINGS warning(s) - benchmarks may run slower than expected"
    fi
    echo ""
    echo "Run benchmarks with:"
    echo "  RUN_BENCHMARKS=true npm run test:performance"
    exit 0
else
    echo -e "${RED}✗${NC} $ERRORS error(s) found - please fix before running benchmarks"
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}⚠${NC} $WARNINGS warning(s) - benchmarks may run slower than expected"
    fi
    echo ""
    echo "See BENCHMARKING.md for setup instructions"
    exit 1
fi
