FROM node:20-bookworm-slim

# System dependencies (minimal: Python + Bash)
RUN apt-get update && apt-get install -y \
    python3 python3-pip bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
CMD ["/bin/bash"]
