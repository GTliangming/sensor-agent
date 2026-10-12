FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FLASK_DEBUG=0 \
    PORT=8080 \
    DATA_DIR=/app/data \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1

WORKDIR /app

# FAISS 的 Linux wheel 使用 OpenMP 运行库。
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/data \
    && chown appuser:appuser /app/data

COPY requirements.txt .
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY --chown=appuser:appuser . .
USER appuser

EXPOSE 8080
CMD ["gunicorn", "--config", "gunicorn.conf.py", "wsgi:app"]
