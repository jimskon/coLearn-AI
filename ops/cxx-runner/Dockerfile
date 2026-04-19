FROM python:3.11-slim

# non-root user for safety
RUN useradd -m runner

# toolchain + coreutils (stdbuf) + sanity tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends g++ make procps bash coreutils && \
    rm -rf /var/lib/apt/lists/*

# python deps: fastapi + uvicorn w/ websockets + redis async client
RUN pip install --no-cache-dir fastapi "uvicorn[standard]" "redis>=5.0.0"

WORKDIR /srv
COPY app.py /srv/app.py

USER runner
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 8000

# we’ll override with docker-compose, but this is sensible default
CMD ["uvicorn","app:app","--host","0.0.0.0","--port","8000","--workers","2"]
