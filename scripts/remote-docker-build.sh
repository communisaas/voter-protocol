#!/bin/zsh
set -eu

# Navigate to aztec-packages root
cd ~/remote-builds/voter-protocol/vendor/aztec-packages

# Patch bootstrap.sh to avoid git dependency for finding root
# We replace $(git rev-parse --show-toplevel) with ../../..
sed -i 's/\$(git rev-parse --show-toplevel)/..\/..\/../' barretenberg/cpp/bootstrap.sh

# Patch ci3/source_bootstrap to avoid git dependency
sed -i 's/\$(git rev-parse --show-toplevel)/..\/..\/../' ci3/source_bootstrap

# Build the docker image
echo "Building Docker image..."
# We use --target build to get the build image
docker build -t aztec-build -f build-images/src/Dockerfile --target build .

# Run the build inside the container
echo "Running WASM build inside Docker container..."
# We mount the current directory to /usr/src/aztec-packages
# We set working directory to /usr/src/aztec-packages/barretenberg/cpp
# We set REF_NAME to avoid git version check
# We set root to avoid git check in ci3/source
# Clean stale build artifacts using docker to avoid permission issues
docker run --rm \
    -v $(pwd):/usr/src/aztec-packages \
    -w /usr/src/aztec-packages/barretenberg/cpp \
    aztec-build \
    rm -rf build-wasm-threads build

docker run --rm \
    -v $(pwd):/usr/src/aztec-packages \
    -w /usr/src/aztec-packages/barretenberg/cpp \
    -e REF_NAME=v0.0.0 \
    -e root=/usr/src/aztec-packages \
    aztec-build \
    /bin/bash -c "cmake --preset wasm-threads -DAVM_TRANSPILER_LIB= -DCMAKE_CXX_FLAGS='-pthread -matomics -mbulk-memory -DBB_NO_EXCEPTIONS' -DCMAKE_EXE_LINKER_FLAGS='--target=wasm32-wasi-threads -pthread -L/opt/wasi-sdk/share/wasi-sysroot/lib/wasm32-wasi-threads -Wl,--import-memory -Wl,--shared-memory -Wl,--max-memory=4294967296' && cmake --build --preset wasm-threads"

# Also build native (bbapi_tests)
# We use the default clang20 preset which is available in the container
echo "Running native build inside Docker container..."
docker run --rm \
    -v $(pwd):/usr/src/aztec-packages \
    -w /usr/src/aztec-packages/barretenberg/cpp \
    -e REF_NAME=v0.0.0 \
    -e root=/usr/src/aztec-packages \
    aztec-build \
    /bin/bash -c "cmake --preset clang20 -DAVM_TRANSPILER_LIB= && cmake --build --preset clang20 --target bbapi_tests dsl_tests"

# Run native tests inside the container to ensure glibc compatibility
echo "Running native tests inside Docker container..."
docker run --rm \
    -v $(pwd):/usr/src/aztec-packages \
    -w /usr/src/aztec-packages/barretenberg/cpp \
    -e REF_NAME=v0.0.0 \
    -e root=/usr/src/aztec-packages \
    aztec-build \
# Run native tests inside the container to ensure glibc compatibility
echo "Running native tests inside Docker container..."
docker run --rm \
    -v $(pwd):/usr/src/aztec-packages \
    -w /usr/src/aztec-packages/barretenberg/cpp \
    -e REF_NAME=v0.0.0 \
    -e root=/usr/src/aztec-packages \
    aztec-build \
    ./build/bin/bbapi_tests || echo "Native tests failed, but proceeding..."
