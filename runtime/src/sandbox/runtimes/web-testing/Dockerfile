FROM node:20-bookworm

# System dependencies
RUN apt-get update && apt-get install -y \
    python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Python packages (Playwright + testing)
RUN pip3 install --break-system-packages --no-cache-dir playwright pytest

# Install Playwright browsers (Chromium with dependencies)
RUN playwright install chromium --with-deps

WORKDIR /workspace
CMD ["/bin/bash"]
