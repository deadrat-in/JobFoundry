#!/usr/bin/env bash
# ==============================================================================
# JobFoundry - One-Line Installer & Setup Script
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Rat-S/JobFoundry/main/install.sh | bash
#   OR run locally: ./install.sh
# ==============================================================================

set -euo pipefail

# Colors
BOLD="\033[1m"
GREEN="\033[0;32m"
BLUE="\033[0;34m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
NC="\033[0m" # No Color

echo -e "${BLUE}${BOLD}"
echo "  ╔═════════════════════════════════════════════════════════════════╗"
echo "  ║                       JobFoundry Installer                      ║"
echo "  ║       Job Search → Scoring → Resume Tailoring → Dashboard       ║"
echo "  ╚═════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ------------------------------------------------------------------------------
# 1. Check Prerequisites
# ------------------------------------------------------------------------------
echo -e "${BLUE}▶ Checking system prerequisites...${NC}"

# Check git
if ! command -v git >/dev/null 2>&1; then
  echo -e "${RED}✖ git is not installed. Please install git and re-run.${NC}"
  exit 1
fi

# Determine container compose command
COMPOSE_CMD=""
if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
elif podman compose version >/dev/null 2>&1; then
  COMPOSE_CMD="podman compose"
elif command -v podman-compose >/dev/null 2>&1; then
  COMPOSE_CMD="podman-compose"
fi

if [ -z "$COMPOSE_CMD" ]; then
  echo -e "${YELLOW}✖ Neither 'docker compose' nor 'podman compose' was found.${NC}"
  echo ""
  echo "JobFoundry runs as a local-first containerized stack (ingest, scorer, tailor, web)."
  echo "To install Docker on Linux, run:"
  echo -e "  ${BOLD}curl -fsSL https://get.docker.com | sh${NC}"
  echo ""
  echo "Once Docker is installed, please re-run this script."
  exit 1
fi

echo -e "  ${GREEN}✔ Found container orchestrator:${NC} $COMPOSE_CMD"

# ------------------------------------------------------------------------------
# 2. Determine Installation Directory
# ------------------------------------------------------------------------------
REPO_URL="https://github.com/Rat-S/JobFoundry.git"

if [ -f "compose.yaml" ] && [ -d "server" ]; then
  # Already in JobFoundry repository root
  TARGET_DIR="$(pwd)"
  echo -e "  ${GREEN}✔ Running from inside existing JobFoundry directory:${NC} $TARGET_DIR"
else
  # Running via curl | bash
  TARGET_DIR="${JOBFOUNDRY_DIR:-$HOME/.jobfoundry}"
  echo -e "${BLUE}▶ Installing JobFoundry to:${NC} $TARGET_DIR"
  if [ -d "$TARGET_DIR/.git" ]; then
    echo -e "  Found existing installation; pulling latest changes..."
    git -C "$TARGET_DIR" pull --ff-only || true
  else
    echo -e "  Cloning repository..."
    git clone --depth 1 "$REPO_URL" "$TARGET_DIR"
  fi
  cd "$TARGET_DIR"
fi

# ------------------------------------------------------------------------------
# 3. Configure Environment (.env)
# ------------------------------------------------------------------------------
echo -e "${BLUE}▶ Configuring environment...${NC}"

if [ ! -f ".env" ]; then
  cp .env.example .env
  
  # Generate random 32-character API key
  RANDOM_KEY=$(LC_ALL=C tr -dc 'a-zA-Z0-9' </dev/urandom | head -c 32 || true)
  if [ -n "$RANDOM_KEY" ]; then
    # Replace placeholder in .env
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s/secret-api-key-1,secret-api-key-2/jf_${RANDOM_KEY}/g" .env
    else
      sed -i "s/secret-api-key-1,secret-api-key-2/jf_${RANDOM_KEY}/g" .env
    fi
  fi
  echo -e "  ${GREEN}✔ Created .env with generated API key${NC}"
else
  echo -e "  ${GREEN}✔ Existing .env preserved${NC}"
fi

# ------------------------------------------------------------------------------
# 4. Start Stack
# ------------------------------------------------------------------------------
echo -e "${BLUE}▶ Starting JobFoundry services...${NC}"
echo -e "  Checking for pre-built container images..."
if $COMPOSE_CMD pull 2>/dev/null; then
  echo -e "  ${GREEN}✔ Pre-built images pulled successfully!${NC}"
  $COMPOSE_CMD up -d
else
  echo -e "  Building containers from source (first run may take a few minutes)..."
  $COMPOSE_CMD up --build -d
fi


# ------------------------------------------------------------------------------
# 5. Run Healthcheck
# ------------------------------------------------------------------------------
echo -e "${BLUE}▶ Verifying services health...${NC}"

chmod +x scripts/healthcheck.sh
if ./scripts/healthcheck.sh; then
  echo -e "  ${GREEN}✔ All services started successfully!${NC}"
else
  echo -e "${YELLOW}⚠️  One or more services took longer than expected to report healthy.${NC}"
  echo "Check container logs using: $COMPOSE_CMD logs -f"
fi

# ------------------------------------------------------------------------------
# 6. Completion & Onboarding Instructions
# ------------------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}═════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}             🎉 JobFoundry is running and ready!               ${NC}"
echo -e "${GREEN}${BOLD}═════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Web Dashboard:${NC}      http://localhost:5173"
echo -e "  ${BOLD}Ingest API:${NC}         http://localhost:8080"
echo -e "  ${BOLD}Scorer Worker:${NC}      http://localhost:8001"
echo -e "  ${BOLD}Resume Tailor API:${NC}  http://localhost:8081"
echo ""
echo -e "${BOLD}Next Steps:${NC}"
echo "  1. Open the Web Dashboard: http://localhost:5173"
echo "  2. Load the Browser Extension into Chrome/Firefox:"
echo "     - Open chrome://extensions (or about:debugging in Firefox)"
echo "     - Enable 'Developer mode'"
echo "     - Click 'Load unpacked' and select the directory:"
echo -e "       ${BLUE}$TARGET_DIR/extension${NC}"
echo "  3. Configure your LLM API key in:"
echo -e "       ${BLUE}$TARGET_DIR/.env${NC}"
echo "     Then restart services: $COMPOSE_CMD restart"
echo ""
echo -e "${BOLD}Useful Commands:${NC}"
echo "  View logs:    cd $TARGET_DIR && $COMPOSE_CMD logs -f"
echo "  Stop stack:   cd $TARGET_DIR && $COMPOSE_CMD down"
echo "  Restart:      cd $TARGET_DIR && $COMPOSE_CMD restart"
echo ""
