FROM python:3.11-slim
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update && apt-get install -y \
      git openssh-client ssh dos2unix curl zip jq \
      file build-essential libstdc++6 binutils && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN pip install --no-cache-dir platformio && \
    pio platform install espressif32 \
      --with-package framework-arduinoespressif32 \
      --with-package toolchain-xtensa-esp32 \
      --with-package tool-mkspiffs
# we want to create a dummy project and build it to ensure that all packages are properly set up
RUN mkdir /workspace/dummy_fs_project && \
    cd /workspace/dummy_fs_project && \
    printf "[env:esp32dev]\nplatform = espressif32\nboard = esp32dev\nframework = arduino\n" > platformio.ini && \
    mkdir src data && \
    echo 'void setup() {} void loop() {}' > src/main.cpp && \
    echo 'dummyfile' > data/placeholder.txt && \
    pio run || true && \
    pio run -t buildfs || true

# Fix mkspiffs binary
RUN HOST_ARCH=$(uname -m) && \
    echo "Host architecture: $HOST_ARCH" && \
    MKP_DIR="$HOME/.platformio/packages/tool-mkspiffs" && \
    mkdir -p "$MKP_DIR" && \
    git clone --recursive https://github.com/igrr/mkspiffs.git /opt/mkspiffs && \
    cd /opt/mkspiffs && \
    make dist BUILD_CONFIG_NAME="-arduino-esp32" && \
    cp mkspiffs "$MKP_DIR/mkspiffs_espressif32_arduino" && chmod +x "$MKP_DIR/mkspiffs_espressif32_arduino" && \
    echo "Replaced mkspiffs binary for host $HOST_ARCH" && \
    file "$MKP_DIR/mkspiffs_espressif32_arduino" && \
    echo "Fixed mkspiffs, now will build filesystems correctly"

COPY server.py .
EXPOSE 8080

RUN update-ca-certificates

# CMD ["uvicorn","server:app","--host","0.0.0.0","--port","8080"]
CMD ["python", "server.py"]
# FROM python:3.11-slim

# SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# # Install system dependencies
# RUN apt-get update && \
#     apt-get install -y \
#       git \
#       openssh-client \
#       ssh \
#       dos2unix \
#       curl \
#       zip \
#       jq \
#       file \
#       build-essential \
#       libstdc++6 \
#       binutils && \
#     rm -rf /var/lib/apt/lists/*

# WORKDIR /workspace

# # Install Python dependencies
# COPY requirements.txt .
# RUN pip install --no-cache-dir -r requirements.txt

# # Install PlatformIO and required ESP32 platform/tools
# RUN pip install --no-cache-dir platformio && \
#     pio platform install espressif32 \
#       --with-package framework-arduinoespressif32 \
#       --with-package toolchain-xtensa-esp32 \
#       --with-package tool-mkspiffs

# # Fix the mkspiffs tool if incompatible
# RUN HOST_ARCH=$(uname -m) && \
#     echo "Host architecture: $HOST_ARCH" && \
#     MKP_DIR="$HOME/.platformio/packages/tool-mkspiffs" && \
#     mkdir -p "$MKP_DIR" && \
#     echo "Contents of $MKP_DIR:" && \
#     ls -l "$MKP_DIR" || true && \
#     MKP_BIN=$(find "$MKP_DIR" -type f -name 'mkspiffs_espressif32_arduino' -print -quit) && \
#     if [ -z "$MKP_BIN" ]; then \
#       echo "mkspiffs binary not found; rebuilding for host $HOST_ARCH"; \
#       git clone --recursive https://github.com/igrr/mkspiffs.git /opt/mkspiffs && \
#       cd /opt/mkspiffs && \
#       make dist BUILD_CONFIG_NAME="-arduino-esp32" && \
#       cp mkspiffs "$MKP_DIR/mkspiffs_espressif32_arduino" && \
#       chmod +x "$MKP_DIR/mkspiffs_espressif32_arduino" && \
#       MKP_BIN="$MKP_DIR/mkspiffs_espressif32_arduino"; \
#     else \
#       echo "Found mkspiffs binary: $MKP_BIN"; \
#     fi && \
#     file "$MKP_BIN" && \
#     if file "$MKP_BIN" | grep -q "32-bit.*ARM.*EABI5"; then \
#       echo "Incompatible ARM32 binary detected; rebuilding for host $HOST_ARCH"; \
#       cd /opt/mkspiffs && \
#       make dist BUILD_CONFIG_NAME="-arduino-esp32" && \
#       cp mkspiffs "$MKP_BIN" && \
#       chmod +x "$MKP_BIN"; \
#     else \
#       echo "Binary architecture is compatible; skipping rebuild"; \
#     fi

# # Copy your FastAPI server code
# COPY server.py .

# EXPOSE 8080

# CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
# FROM python:3.11-slim
# SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# RUN apt-get update && \
#     apt-get install -y \
#       git openssh-client ssh dos2unix curl zip jq \
#       file build-essential libstdc++6 binutils && \
#     rm -rf /var/lib/apt/lists/*

# WORKDIR /workspace

# COPY requirements.txt .
# RUN pip install --no-cache-dir -r requirements.txt

# # Install PlatformIO and ESP32 platform
# RUN pip install --no-cache-dir platformio && \
#     pio platform install espressif32 \
#       --with-package framework-arduinoespressif32 \
#       --with-package toolchain-xtensa-esp32 \
#       --with-package tool-mkspiffs

# # Check and patch tool-mkspiffs binary if needed
# # RUN MKP_DIRS=$(ls ~/.platformio/packages/tool-mkspiffs/* 2>/dev/null || echo "") && \
# #     if [ -z "$MKP_DIRS" ]; then \
# #       echo "tool-mkspiffs not found; skipping binary check"; \
# #     else \
# #       MKP_BIN=$(ls $MKP_DIRS/mkspiffs_espressif32_arduino 2>/dev/null || echo "") && \
# #       if [ -z "$MKP_BIN" ]; then \
# #         echo "mkspiffs_espressif32_arduino binary not found; skipping patch"; \
# #       else \
# #         echo "mkspiffs path: $MKP_BIN"; \
# #         file "$MKP_BIN"; \
# #         if file "$MKP_BIN" | grep -q "ARM, EABI5"; then \
# #           echo "Detected incompatible mkspiffs binary (armhf) — rebuilding"; \
# #           git clone --recursive https://github.com/igrr/mkspiffs.git /opt/mkspiffs && \
# #           cd /opt/mkspiffs && make dist BUILD_CONFIG_NAME="-arduino-esp32" && \
# #           cp mkspiffs "$MKP_BIN" && chmod +x "$MKP_BIN"; \
# #         else \
# #           echo "Binary architecture looks OK"; \
# #         fi \
# #       fi \
# #     fi
# RUN HOST_ARCH=$(uname -m) && \
#     echo "Host architecture: $HOST_ARCH" && \
#     MKP_DIR="$HOME/.platformio/packages/tool-mkspiffs" && \
#     mkdir -p "$MKP_DIR" && \
#     echo "Contents of $MKP_DIR:" && \
#     ls -l "$MKP_DIR" || true && \
#     MKP_BIN=$(find "$MKP_DIR" -type f -name 'mkspiffs_espressif32_arduino' -print -quit) && \
#     if [ -z "$MKP_BIN" ]; then \
#       echo "mkspiffs binary not found; rebuilding for host $HOST_ARCH"; \
#       git clone --recursive https://github.com/igrr/mkspiffs.git /opt/mkspiffs && \
#       cd /opt/mkspiffs && \
#       make dist BUILD_CONFIG_NAME="-arduino-esp32" && \
#       cp mkspiffs "$MKP_DIR/mkspiffs_espressif32_arduino" && \
#       chmod +x "$MKP_DIR/mkspiffs_espressif32_arduino" && \
#       MKP_BIN="$MKP_DIR/mkspiffs_espressif32_arduino"; \
#     else \
#       echo "Found mkspiffs binary: $MKP_BIN"; \
#     fi && \
#     file "$MKP_BIN" && \
#     if file "$MKP_BIN" | grep -q "32-bit.*ARM.*EABI5"; then \
#       echo "Incompatible ARM32 binary detected; rebuilding for host $HOST_ARCH"; \
#       cd /opt/mkspiffs && \
#       make dist BUILD_CONFIG_NAME="-arduino-esp32" && \
#       cp mkspiffs "$MKP_BIN" && \
#       chmod +x "$MKP_BIN"; \
#     else \
#       echo "Binary architecture is compatible; skipping rebuild"; \
#     fi

    
# COPY server.py .

# EXPOSE 8080

# CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]