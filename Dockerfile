ARG NODE_IMAGE=node:24.5.0-slim

FROM ${NODE_IMAGE} AS builder

RUN set -eux; \
    sed -i 's|http://deb.debian.org|http://mirrors.tuna.tsinghua.edu.cn|g; s|http://security.debian.org|http://mirrors.tuna.tsinghua.edu.cn/debian-security|g' /etc/apt/sources.list.d/debian.sources; \
    for attempt in 1 2 3 4 5; do \
      apt-get update -o Acquire::Retries=5 && \
      apt-get install -y --fix-missing --no-install-recommends -o Acquire::Retries=5 \
      python3 python3-pip sqlite3 build-essential && \
      break; \
      if [ "${attempt}" -eq 5 ]; then \
        exit 1; \
      fi; \
      rm -rf /var/lib/apt/lists/*; \
      sleep $((attempt * 3)); \
    done; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /home/perplexica
RUN rm -rf /home/perplexica/public/_next /home/perplexica/.next

COPY package.json yarn.lock ./
RUN set -eux; \
    yarn config set registry https://registry.npmjs.org; \
    for attempt in 1 2 3 4 5; do \
      if yarn install --frozen-lockfile --network-timeout 120000 --network-concurrency 1 --no-progress; then \
        exit 0; \
      fi; \
      sleep $((attempt * 5)); \
    done; \
    exit 1

COPY tsconfig.json next.config.mjs next-env.d.ts postcss.config.js drizzle.config.ts tailwind.config.ts ./
COPY src ./src
COPY public ./public
COPY drizzle ./drizzle

RUN mkdir -p /home/perplexica/data
RUN yarn build

ARG NODE_IMAGE=node:24.5.0-slim
FROM ${NODE_IMAGE}

RUN set -eux; \
    sed -i 's|http://deb.debian.org|http://mirrors.tuna.tsinghua.edu.cn|g; s|http://security.debian.org|http://mirrors.tuna.tsinghua.edu.cn/debian-security|g' /etc/apt/sources.list.d/debian.sources; \
    for attempt in 1 2 3 4 5; do \
      apt-get update -o Acquire::Retries=5 && \
      apt-get install -y --fix-missing --no-install-recommends -o Acquire::Retries=5 \
      python3-dev python3-babel python3-venv python-is-python3 \
      uwsgi uwsgi-plugin-python3 \
      git build-essential libxslt-dev zlib1g-dev libffi-dev libssl-dev \
      curl sudo && \
      break; \
      if [ "${attempt}" -eq 5 ]; then \
        exit 1; \
      fi; \
      rm -rf /var/lib/apt/lists/*; \
      sleep $((attempt * 3)); \
    done; \
    rm -rf /var/lib/apt/lists/*

RUN yarn add --ignore-scripts playwright@^1.57.0 && \
    yarn playwright install --with-deps --only-shell chromium

# Preinstall MiniMax coding-plan MCP runtime in a dedicated virtualenv so
# container startup doesn't rely on uvx dynamic download.
RUN python3 -m venv /home/perplexica/.venv/minimax-mcp && \
    /home/perplexica/.venv/minimax-mcp/bin/pip install --no-cache-dir --upgrade pip setuptools wheel && \
    /home/perplexica/.venv/minimax-mcp/bin/pip install --no-cache-dir minimax-coding-plan-mcp==0.0.4

WORKDIR /home/perplexica

RUN id -u searxng >/dev/null 2>&1 || useradd --shell /bin/bash --system \
    --home-dir "/usr/local/searxng" \
    --comment 'Privacy-respecting metasearch engine' \
    searxng

RUN mkdir -p "/usr/local/searxng"
RUN mkdir -p /etc/searxng
RUN chown -R "searxng:searxng" "/usr/local/searxng"

COPY searxng/settings.yml /etc/searxng/settings.yml
COPY searxng/limiter.toml /etc/searxng/limiter.toml
COPY searxng/uwsgi.ini /etc/searxng/uwsgi.ini
RUN chown -R searxng:searxng /etc/searxng

USER searxng

ARG SEARXNG_REF=master
RUN mkdir -p "/usr/local/searxng/searxng-src" && \
    curl -fsSL "https://codeload.github.com/searxng/searxng/tar.gz/${SEARXNG_REF}" | \
      tar -xz -C "/usr/local/searxng/searxng-src" --strip-components=1

RUN python3 -m venv "/usr/local/searxng/searx-pyenv"
RUN "/usr/local/searxng/searx-pyenv/bin/pip" install --upgrade pip setuptools wheel pyyaml msgspec typing_extensions
RUN cd "/usr/local/searxng/searxng-src" && \
    "/usr/local/searxng/searx-pyenv/bin/pip" install --use-pep517 --no-build-isolation -e .

USER root

WORKDIR /home/perplexica

# Copy app artifacts after SearXNG install so app-only changes don't force
# rebuilding SearXNG layers (significantly speeds up iterative builds).
COPY --from=builder /home/perplexica/public ./public
COPY --from=builder /home/perplexica/.next/static ./public/_next/static
COPY --from=builder /home/perplexica/.next/standalone ./
COPY --from=builder /home/perplexica/data ./data
COPY drizzle ./drizzle
COPY scripts ./scripts

RUN mkdir -p /home/perplexica/uploads

COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
RUN sed -i 's/\r$//' ./entrypoint.sh || true

RUN echo "searxng ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

EXPOSE 3000 8080

ENV SEARXNG_API_URL=http://localhost:8080

CMD ["/home/perplexica/entrypoint.sh"]
