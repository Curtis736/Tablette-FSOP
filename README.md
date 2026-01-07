# SEDI Tablette

## 🚀 Déploiement simple

### 1. Cloner le repo
```bash
git clone https://github.com/Curtis736/tablette_better.git
cd tablette_better
```

### 2. Déployer l'application (frontend + backend)
```bash
docker-compose -f docker/docker-compose.production.yml up -d
```

C'est tout ! 🎉

## ✅ Vérification

```bash
# Vérifier que les containers tournent
docker ps

# Tester l'accès
curl http://localhost:3001/api/health
curl http://localhost:8080
```

### 3. (Optionnel) Démarrer le monitoring (Prometheus + Grafana)

```bash
docker-compose -f docker/docker-compose.monitoring.yml up -d
```

## 🌐 URLs d'accès (par défaut en local)

- **Backend API** : http://localhost:3001
- **Frontend Web** : http://localhost:8080
- **Prometheus** : http://localhost:9091
- **Grafana** : http://localhost:3002

## 🛠️ Commandes utiles

```bash
# Voir les logs
docker-compose -f docker/docker-compose.production.yml logs -f

# Arrêter les services
docker-compose -f docker/docker-compose.production.yml down

# Redémarrer les services
docker-compose -f docker/docker-compose.production.yml restart
```

## 📋 Prérequis

- Docker et Docker Compose installés
- Ports 3001 et 8080 disponibles

## 🧑‍💻 Déploiement serveur (CI/CD)

Pour un déploiement complet (arrêt propre, rebuild des images, relance des stacks production + monitoring), le workflow CI comme les opérateurs peuvent appeler :

```bash
cd docker
./deploy.sh
```

Le script s'occupe de :
- vérifier/créer le réseau `sedi-tablette-network`,
- arrêter les stacks existantes via `docker compose down` puis tuer les conteneurs récalcitrants,
- relancer les builds via `rebuild-images.sh`,
- redémarrer `docker-compose.production.yml` puis `docker-compose.monitoring.yml`.
- détecter automatiquement si Docker n'est pas accessible et utiliser `sudo` si nécessaire (pour les conteneurs root-owned).

### ⚠️ Note importante : Docker snap vs Docker système

Sur le serveur de production, **Docker système** (via `apt`) est utilisé, pas Docker snap. Si Docker snap est installé, il doit être désactivé pour éviter les conflits :

```bash
sudo snap disable docker
sudo snap stop docker
```

L'utilisateur de déploiement (`maintenance`) doit être dans le groupe `docker` pour utiliser Docker sans `sudo` :

```bash
sudo usermod -aG docker maintenance
# Puis se déconnecter/reconnecter ou utiliser : newgrp docker
```