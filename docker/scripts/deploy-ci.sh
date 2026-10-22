#!/bin/bash
# Déploiement de main sur serveurproduction, appelé par la CI (GitHub Actions ou GitLab).
#
#   docker/scripts/deploy-ci.sh [SHA_ATTENDU]
#
# - Met le dépôt sur main en fast-forward uniquement. Les retouches locales non commitées
#   sont conservées telles quelles ; si elles entrent en conflit avec main, on s'arrête
#   sans rien toucher (pas de stash/pop silencieux).
# - Reconstruit et relance les conteneurs applicatifs dans le projet compose déjà en place
#   (pas de deuxième copie, pas de suppression forcée des conteneurs sedi-*).
# - Attend que le backend soit "healthy" ; sinon code de sortie 1 et derniers logs affichés.

set -Eeuo pipefail

# FSOP_ROOT permet d'exécuter la version de main du script avant le checkout :
#   git show origin/main:docker/scripts/deploy-ci.sh > "$S" && FSOP_ROOT=$PWD bash "$S" "$SHA"
ROOT="${FSOP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
DOCKER_DIR="$ROOT/docker"
PROD_COMPOSE="$DOCKER_DIR/docker-compose.production.yml"
BRANCH="${DEPLOY_BRANCH:-main}"
REMOTE="${DEPLOY_REMOTE:-origin}"
EXPECTED_SHA="${1:-}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-sedi-tablette-backend}"
HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-180}"

log() { printf '[%(%Y-%m-%d %H:%M:%S)T] %s\n' -1 "$*"; }
die() { log "❌ $*"; exit 1; }

cd "$ROOT"

log "📥 Mise à jour du dépôt ($REMOTE/$BRANCH)"
git fetch --quiet "$REMOTE" "$BRANCH"
TARGET="$(git rev-parse "$REMOTE/$BRANCH")"
if [[ -n "$EXPECTED_SHA" && "$TARGET" != "$EXPECTED_SHA"* ]]; then
  log "⚠️  $REMOTE/$BRANCH = ${TARGET:0:8}, pipeline = ${EXPECTED_SHA:0:8} (un commit plus récent est arrivé)"
fi

CURRENT_BRANCH="$(git symbolic-ref --quiet --short HEAD || echo DETACHED)"
if [[ "$CURRENT_BRANCH" != "$BRANCH" ]]; then
  git merge-base --is-ancestor HEAD "$TARGET" \
    || die "La branche serveur '$CURRENT_BRANCH' contient des commits absents de $BRANCH. Déploiement annulé."
  if git rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
    git merge-base --is-ancestor "$BRANCH" "$TARGET" \
      || die "Le $BRANCH local du serveur a des commits absents de $REMOTE/$BRANCH. Déploiement annulé."
  fi
  log "🔀 Passage de '$CURRENT_BRANCH' à '$BRANCH'"
  # checkout garde les retouches locales et refuse (sans rien toucher) si elles sont en conflit.
  git checkout --quiet -B "$BRANCH" "$TARGET" || die "Changement de branche impossible (retouches locales en conflit ?)"
  git branch --quiet -u "$REMOTE/$BRANCH"
else
  git merge --ff-only --quiet "$TARGET" \
    || die "Fast-forward impossible : main local a divergé ou des retouches locales sont en conflit."
fi
log "✅ Dépôt sur $(git log --oneline -1)"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  log "ℹ️  Retouches locales conservées :"
  git status --short --untracked-files=no
fi

# Réutiliser le projet compose qui tourne déjà (son nom dépend de la façon dont il a été lancé).
PROJECT="${COMPOSE_PROJECT:-$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$BACKEND_CONTAINER" 2>/dev/null || true)}"
PROJECT="${PROJECT:-docker}"
log "🐳 Projet compose : $PROJECT"

log "🔨 Build + redémarrage des conteneurs applicatifs"
docker compose -p "$PROJECT" -f "$PROD_COMPOSE" up -d --build --remove-orphans

log "🩺 Attente du backend (max ${HEALTH_TIMEOUT_SEC}s)"
deadline=$(( SECONDS + HEALTH_TIMEOUT_SEC ))
status=""
while (( SECONDS < deadline )); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$BACKEND_CONTAINER" 2>/dev/null || echo absent)"
  [[ "$status" == "healthy" ]] && break
  sleep 5
done

if [[ "$status" != "healthy" ]]; then
  log "❌ Backend non healthy ($status). Derniers logs :"
  docker logs --tail 60 "$BACKEND_CONTAINER" 2>&1 || true
  exit 1
fi

docker ps --filter "name=sedi-tablette" --format 'table {{.Names}}\t{{.Status}}'
log "✅ Déploiement terminé : $(git rev-parse --short HEAD)"
