FROM node:20-bookworm

# System dependencies
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    libreoffice-core libreoffice-writer libreoffice-calc \
    poppler-utils pandoc \
    && rm -rf /var/lib/apt/lists/*

# Python packages (office skills)
RUN pip3 install --break-system-packages --no-cache-dir \
    pypdf pdfplumber reportlab pytesseract pypdfium2 \
    openpyxl pandas \
    python-docx python-pptx Pillow markitdown

# Node packages (office skills)
RUN npm install -g docx pptxgenjs

WORKDIR /workspace
CMD ["/bin/bash"]
