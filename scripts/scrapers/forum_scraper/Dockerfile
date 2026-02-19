# Forum scraper runtime image.
# This image is intentionally generic (Python + Chromium + Selenium)
# so it can be reused later for JS-heavy non-forum scraping tasks too.
FROM python:3.9-slim-bullseye

LABEL maintainer="PM Intelligence Team"
LABEL description="Forum scraper with Selenium and Chromium"

RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    unzip \
    curl \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    && rm -rf /var/lib/apt/lists/*

RUN chromium --version || chromium-browser --version
RUN ln -s /usr/bin/chromium /usr/bin/google-chrome || \
    ln -s /usr/bin/chromium-browser /usr/bin/google-chrome || true

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY forum_dump.py .

RUN mkdir -p /app/output /app/config

ENV PYTHONUNBUFFERED=1

CMD ["python", "forum_dump.py", "--forum", "aem-forms", "--config", "/app/config/forum_sources.json", "--output", "/app/output/aem-forms_dump.json"]
