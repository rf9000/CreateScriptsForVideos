FROM oven/bun:1

WORKDIR /app

# git for the continia-banking clone operations, curl/bash for Claude Code install,
# libicu for the .NET AL compiler (alc) mounted at runtime — without it alc aborts
# with a globalization/ICU error inside the container.
RUN apt-get update && apt-get install -y git curl bash libicu-dev && rm -rf /var/lib/apt/lists/*

# Install dependencies (as root, before switching user)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy application source
COPY . .

# Non-root user — Claude Code refuses --dangerously-skip-permissions (used by the
# Agent SDK) when running as root, so the watcher must run as an unprivileged user.
# Align claude to UID/GID 1000 so it matches the host user that owns the bind-mounted
# ~/.claude — otherwise the host (1000) and container clash over that shared dir (EACCES).
# The base oven/bun image already holds 1000 for its `bun` user, so renumber it out first.
RUN usermod -u 1100 bun && groupmod -g 1100 bun && \
    useradd -m -s /bin/bash -u 1000 -U claude && \
    chown -R claude:claude /app && \
    mkdir -p /repos /opt/continia && \
    mkdir -p /tmp && chmod 1777 /tmp

# Install Claude Code CLI as the non-root user (auth via ANTHROPIC_API_KEY from the env)
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
# `continia compile` / `continia deploy` need a Linux `alc`. Provisioned by mounting the
# AL Language extension's `bin/` from the host (see DEPLOY.md / docker-compose.yml) and
# setting CONTINIA_ALC_PATH=/opt/al/bin/linux/alc. The whole bin/ is mounted so the
# analyzer DLLs in bin/Analyzers/ resolve relative to alc. libicu (above) is its runtime dep.

# Persist generated output and Claude CLI state across restarts (no processed-item
# state — the work-item tag is the queue, removed after each attempt)
VOLUME /app/output
VOLUME /home/claude/.claude

COPY --chmod=755 entrypoint.sh /entrypoint.sh

# Start as root to fix volume ownership, then the entrypoint drops to the claude user
ENTRYPOINT ["/entrypoint.sh"]
