FROM node:20-bookworm

# System dependencies
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    poppler-utils pandoc \
    && rm -rf /var/lib/apt/lists/*

# Python packages (PDF processing)
RUN pip3 install --break-system-packages --no-cache-dir \
    pypdf pdfplumber reportlab pytesseract pypdfium2 markitdown

WORKDIR /workspace
CMD ["/bin/bash"]
