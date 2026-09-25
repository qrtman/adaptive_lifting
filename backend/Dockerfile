FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --system app \
    && useradd --system --gid app --home-dir /app app \
    && mkdir -p /data \
    && chown app:app /data
COPY alembic.ini ./alembic.ini
COPY backend ./backend
USER app
EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
