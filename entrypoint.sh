#!/bin/sh
set -e

read_config_with_node() {
  node -e "$1" 2>/dev/null || true
}

resolve_minimax_mcp_enabled() {
  if [ -n "${MINIMAX_MCP_ENABLED:-}" ]; then
    echo "${MINIMAX_MCP_ENABLED}"
    return 0
  fi

  read_config_with_node '
const fs = require("fs");
const p = "/home/perplexica/data/config.json";
if (!fs.existsSync(p)) process.exit(0);
const c = JSON.parse(fs.readFileSync(p, "utf8"));
const raw = c?.economy?.minimaxMcpEnabled;
if (raw === true || String(raw).toLowerCase() === "true") {
  process.stdout.write("true");
}
'
}

resolve_minimax_api_key() {
  if [ -n "${MINIMAX_API_KEY:-}" ]; then
    echo "${MINIMAX_API_KEY}"
    return 0
  fi

  read_config_with_node '
const fs = require("fs");
const p = "/home/perplexica/data/config.json";
if (!fs.existsSync(p)) process.exit(0);
const c = JSON.parse(fs.readFileSync(p, "utf8"));
const providers = Array.isArray(c.modelProviders) ? c.modelProviders : [];
const mm = providers.find((x) => x.type === "minimax")
  || providers.find((x) => x.type === "openai" && String(x?.config?.baseURL || "").includes("minimaxi.com"));
const key = String(mm?.config?.apiKey || "").trim();
if (!key || key === "********") process.exit(0);
process.stdout.write(key);
'
}

resolve_minimax_base_url() {
  if [ -n "${MINIMAX_BASE_URL:-}" ]; then
    echo "${MINIMAX_BASE_URL}"
    return 0
  fi

  read_config_with_node '
const fs = require("fs");
const p = "/home/perplexica/data/config.json";
if (!fs.existsSync(p)) process.exit(0);
const c = JSON.parse(fs.readFileSync(p, "utf8"));
const providers = Array.isArray(c.modelProviders) ? c.modelProviders : [];
const mm = providers.find((x) => x.type === "minimax")
  || providers.find((x) => x.type === "openai" && String(x?.config?.baseURL || "").includes("minimaxi.com"));
const base = String(mm?.config?.baseURL || "").trim();
if (!base) process.exit(0);
process.stdout.write(base);
'
}

is_truthy() {
  case "$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

start_minimax_mcp() {
  MCP_MODE="${MINIMAX_MCP_MODE:-media}"
  MCP_PORT="${MINIMAX_MCP_PORT:-18190}"
  MCP_LOG_FILE="/home/perplexica/logs/minimax-mcp-runtime.log"
  mkdir -p /home/perplexica/logs

  API_KEY="$(resolve_minimax_api_key)"
  if [ -z "${API_KEY}" ]; then
    echo "MiniMax MCP skipped: missing MINIMAX_API_KEY."
    return 1
  fi

  if [ -z "${MINIMAX_MCP_URL:-}" ]; then
    if [ "${MCP_MODE}" = "coding-plan" ]; then
      export MINIMAX_MCP_URL="http://127.0.0.1:${MCP_PORT}/mcp"
    else
      export MINIMAX_MCP_URL="http://127.0.0.1:${MCP_PORT}/rest"
    fi
  fi

  if [ "${MCP_MODE}" = "coding-plan" ]; then
    MCP_PYTHON_BIN="${MINIMAX_MCP_PYTHON:-python3}"
    if [ -x "/home/perplexica/.venv/minimax-mcp/bin/python" ]; then
      MCP_PYTHON_BIN="/home/perplexica/.venv/minimax-mcp/bin/python"
    fi

    BASE_URL="$(resolve_minimax_base_url)"
    if [ -z "${BASE_URL}" ]; then
      BASE_URL="https://api.minimaxi.com/v1"
    fi
    API_HOST="$(echo "${BASE_URL}" | sed -E 's#/*$##' | sed -E 's#/v1$##')"

    echo "Starting MiniMax coding-plan MCP on port ${MCP_PORT}..."
    MINIMAX_API_KEY="${API_KEY}" \
    MINIMAX_API_HOST="${API_HOST}" \
    MINIMAX_MCP_PORT="${MCP_PORT}" \
    "${MCP_PYTHON_BIN}" /home/perplexica/scripts/minimax-coding-plan-mcp-http.py \
      >"${MCP_LOG_FILE}" 2>&1 &
    MINIMAX_MCP_PID=$!

    COUNTER=0
    MAX_TRIES=25
    until curl -sS -X POST "http://127.0.0.1:${MCP_PORT}/mcp" \
      -H 'Content-Type: application/json' \
      -H 'Accept: application/json, text/event-stream' \
      -d '{"jsonrpc":"2.0","id":"probe-init","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"perplexica-entrypoint","version":"1.0.0"}}}' \
      | grep -q '"result"'; do
      COUNTER=$((COUNTER+1))
      if [ $COUNTER -ge $MAX_TRIES ]; then
        echo "MiniMax coding-plan MCP health check timeout."
        kill "${MINIMAX_MCP_PID}" 2>/dev/null || true
        return 1
      fi
      sleep 1
    done
  else
    echo "Starting MiniMax media MCP on port ${MCP_PORT}..."
    MINIMAX_API_KEY="${API_KEY}" \
    npx -y minimax-mcp-js --mode rest --port "${MCP_PORT}" \
      >"${MCP_LOG_FILE}" 2>&1 &
    MINIMAX_MCP_PID=$!

    COUNTER=0
    MAX_TRIES=20
    until curl -sS -X POST "http://127.0.0.1:${MCP_PORT}/rest" \
      -H 'Content-Type: application/json' \
      -H 'Accept: application/json, text/event-stream' \
      -d '{"jsonrpc":"2.0","id":"probe-tools","method":"tools/list","params":{}}' \
      > /dev/null 2>&1; do
      COUNTER=$((COUNTER+1))
      if [ $COUNTER -ge $MAX_TRIES ]; then
        echo "MiniMax media MCP health check timeout."
        kill "${MINIMAX_MCP_PID}" 2>/dev/null || true
        return 1
      fi
      sleep 1
    done
  fi

  echo "MiniMax MCP started successfully (mode=${MCP_MODE}, pid=${MINIMAX_MCP_PID}, url=${MINIMAX_MCP_URL})"
  return 0
}

# =============================================================================
# Start SearXNG
# =============================================================================
echo "Starting SearXNG..."

sudo -H -u searxng bash -c "cd /usr/local/searxng/searxng-src && export SEARXNG_SETTINGS_PATH='/etc/searxng/settings.yml' && export FLASK_APP=searx/webapp.py && /usr/local/searxng/searx-pyenv/bin/python -m flask run --host=0.0.0.0 --port=8080" &
SEARXNG_PID=$!

echo "Waiting for SearXNG to be ready..."
sleep 5

COUNTER=0
MAX_TRIES=30
until curl -s http://localhost:8080 > /dev/null 2>&1; do
  COUNTER=$((COUNTER+1))
  if [ $COUNTER -ge $MAX_TRIES ]; then
    echo "Warning: SearXNG health check timeout, but continuing..."
    break
  fi
  sleep 1
done

if curl -s http://localhost:8080 > /dev/null 2>&1; then
  echo "SearXNG started successfully (PID: $SEARXNG_PID)"
else
  echo "SearXNG may not be fully ready, but continuing (PID: $SEARXNG_PID)"
fi

# =============================================================================
# Start MiniMax MCP (if enabled)
# =============================================================================
cd /home/perplexica
echo "Starting MiniMax MCP..."

MCP_ENABLED_RAW="$(resolve_minimax_mcp_enabled)"
if is_truthy "${MCP_ENABLED_RAW}"; then
  if ! start_minimax_mcp; then
    if is_truthy "${MINIMAX_MCP_REQUIRED:-false}"; then
      echo "MiniMax MCP failed and MINIMAX_MCP_REQUIRED=true, exiting."
      exit 1
    fi
    echo "MiniMax MCP failed to start, continuing with MiniMax direct API fallback."
  fi
else
  echo "MiniMax MCP disabled."
fi

# =============================================================================
# Start Cache Worker
# =============================================================================
if [ "${CACHE_WORKER_ENABLED:-true}" != "false" ]; then
  echo "Starting cache worker..."
  node /home/perplexica/scripts/cache-worker.js &
fi

# =============================================================================
# Start Next.js App
# =============================================================================
exec node server.js