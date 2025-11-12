FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies for FreeTDS (required for pymssql)
RUN apt-get update && apt-get install -y \
    freetds-dev \
    freetds-bin \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app /app/app

# Expose port (will be mapped to 5000-5100 range)
EXPOSE 5000

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV FLASK_APP=app.main:app

# Run the Flask application
CMD ["python", "-m", "flask", "run", "--host=0.0.0.0", "--port=5000"]
