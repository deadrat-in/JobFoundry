FROM python:3.14-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

ENV UV_SYSTEM_PYTHON=1 \
    PYTHONUNBUFFERED=1

COPY server/scorer/pyproject.toml server/scorer/uv.lock ./

RUN uv pip install --system -r pyproject.toml

COPY server/scorer/src/ ./src/

EXPOSE 8001

CMD ["python", "-m", "src.main"]
