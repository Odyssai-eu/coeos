FROM python:3.12-slim

# Console only — stdlib, no pip deps. The pipeline itself (coeos-run) runs on
# the host next to your engine: see install.sh.
WORKDIR /app
COPY . .
EXPOSE 4800

CMD ["python3", "console/server.py"]
