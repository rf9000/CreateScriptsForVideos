FROM oven/bun:1

WORKDIR /app

# git for the continia-banking clone operations, curl/bash for Claude Code install
RUN apt-get update && apt-get install -y git curl bash && rm -rf /var/lib/apt/lists/*

# Install dependencies (as root, before switching user)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy application source
COPY . .

# Non-root user — Claude Code refuses --dangerously-skip-permissions (used by the
# Agent SDK) when running as root, so the watcher must run as an unprivileged user.
RUN useradd -m -s /bin/bash claude && \
    chown -R claude:claude /app && \
    mkdir -p /repos /opt/continia && \
    mkdir -p /tmp && chmod 1777 /tmp

# Install Claude Code CLI as the non-root user (OAuth creds live under ~/.claude)
USER claude
RUN curl -fsSL https://claude.ai/install.sh | bash
USER root

# /opt/continia holds the continia-linux binary (see below); /home/claude/.local/bin holds `claude`
ENV PATH="/opt/continia:/home/claude/.local/bin:$PATH"

# --- continia CLI (Linux build) -------------------------------------------------
# The binary is gitignored (.tools/, *.exe) and provisioned out of band. The skills
# invoke it as a bare `continia ...`, so it must resolve on PATH at /opt/continia/continia.
# Pick ONE:
#   A) Mount it at runtime (preferred, see docker-compose.yml volumes):
#        /home/azureuser/tools/continia-linux:/opt/continia/continia:ro
#   B) Bake it into the image — drop the linux build at .tools/continia-linux first, then:
#        COPY .tools/continia-linux /opt/continia/continia
#        RUN chmod +x /opt/continia/continia

# --- AL compiler (alc) ----------------------------------------------------------
# `continia compile` / `continia deploy` need a Linux `alc`. continia-deploy resolves it
# via CONTINIA_ALC_PATH, else the AL VS Code extension's bundled alc, else altool `al compile`.
# TODO: provision a Linux alc (extract bin/linux from the AL Language .vsix, or install altool)
# and set CONTINIA_ALC_PATH in .env.create-scripts to its absolute path.

# Persist processed-item state, generated output, and Claude auth across restarts
VOLUME /app/.state
VOLUME /app/output
VOLUME /home/claude/.claude

COPY --chmod=755 entrypoint.sh /entrypoint.sh

# Start as root to fix volume ownership, then the entrypoint drops to the claude user
ENTRYPOINT ["/entrypoint.sh"]
