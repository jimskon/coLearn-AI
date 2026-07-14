FROM python:3.11-slim

RUN useradd -m runner

RUN apt-get update && \
    apt-get install -y --no-install-recommends bash coreutils procps && \
    rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir fastapi "uvicorn[standard]" "redis>=5.0.0" numpy pandas

WORKDIR /srv
COPY app.py /srv/app.py

USER runner
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 8000

CMD ["uvicorn","app:app","--host","0.0.0.0","--port","8000","--workers","2"]
