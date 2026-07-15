FROM python:3.11-slim

WORKDIR /app

# Install basic build tools and dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy python dependency list
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Download the spaCy model used for Entity Extraction
RUN python -m spacy download en_core_web_sm

# Copy project files
COPY . .

# Expose the API port
EXPOSE 8000

# Configure environment variables
ENV PYTHONUNBUFFERED=1
ENV APP_ENV=production

# Command to start the FastAPI backend
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
