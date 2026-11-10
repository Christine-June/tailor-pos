FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1

WORKDIR /srv
COPY requirements.txt requirements-dev.txt ./
ARG INSTALL_DEV=false
RUN if [ "$INSTALL_DEV" = "true" ]; then pip install -r requirements-dev.txt; else pip install -r requirements.txt; fi

COPY . .

RUN useradd --create-home --uid 1000 app && chown -R app /srv
USER app

ENV FLASK_APP=run.py
EXPOSE 5000

# Applying migrations at start is safe: Alembic takes a lock, and a failed migration stops the boot.
CMD ["sh", "-c", "flask db upgrade && exec gunicorn run:app --bind 0.0.0.0:5000 --workers ${WEB_WORKERS:-3} --threads 4 --timeout 60 --access-logfile - --error-logfile -"]
