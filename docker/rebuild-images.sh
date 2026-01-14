#!/bin/bash
# Script pour reconstruire les images Docker backend et frontend

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🧹 Nettoyage complet et reconstruction des images Docker SEDI Tablette"
echo ""

cd "$PROJECT_ROOT"

# 1. Arrêter tous les conteneurs
echo "🛑 Arrêt de tous les conteneurs SEDI..."
docker ps -a --filter "name=sedi-" --format "{{.ID}}" | while read id; do
    if [ ! -z "$id" ]; then
        echo "   Arrêt du conteneur $id..."
        docker stop "$id" 2>/dev/null || true
        docker rm -f "$id" 2>/dev/null || true
    fi
done

# 2. Arrêter via docker-compose
echo ""
echo "🛑 Arrêt via docker-compose..."
if [ -f "docker/docker-compose.production.yml" ]; then
    cd docker
    docker compose -f docker-compose.production.yml down --remove-orphans 2>/dev/null || true
    docker compose -f docker-compose.monitoring.yml down --remove-orphans 2>/dev/null || true
    cd ..
fi

# 3. Supprimer les images existantes
echo ""
echo "🗑️  Suppression des images existantes..."
docker rmi docker-sedi-backend:latest 2>/dev/null || echo "   Image backend non trouvée (ok)"
docker rmi docker-sedi-frontend:latest 2>/dev/null || echo "   Image frontend non trouvée (ok)"
docker rmi sedi-prometheus:latest 2>/dev/null || echo "   Image prometheus non trouvée (ok)"

# 4. Nettoyer les images non utilisées (optionnel mais recommandé)
echo ""
echo "🧹 Nettoyage des images non utilisées..."
docker image prune -f || true

# 5. Mettre à jour le code (optionnel)
echo ""
echo "📥 Mise à jour du code..."
git pull || true

# 6. Reconstruire l'image backend (sans cache pour éviter les superpositions)
echo ""
echo "🔨 Reconstruction de l'image backend (sans cache)..."
docker build --no-cache -t docker-sedi-backend:latest -f docker/Dockerfile.backend .

# 7. Reconstruire l'image frontend (sans cache pour éviter les superpositions)
echo ""
echo "🔨 Reconstruction de l'image frontend (sans cache)..."
docker build --no-cache -t docker-sedi-frontend:latest -f docker/Dockerfile.frontend .

echo ""
echo "✅ Images reconstruites avec succès!"
echo ""
echo "📋 Images disponibles:"
docker images | grep -E "docker-sedi-(backend|frontend)"

echo ""
echo "🔄 Pour redémarrer les conteneurs applicatifs:"
echo "   cd docker"
echo "   docker compose -f docker-compose.production.yml up -d"
echo ""
echo "📊 Pour démarrer le monitoring (Prometheus + Grafana):"
echo "   docker compose -f docker-compose.monitoring.yml up -d"














