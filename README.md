# SEDI Tablette (FSOP)

Application web pour l'atelier SEDI : pointage des temps sur les lancements de production (LT), formulaires FSOP de traçabilité, et remontée des données vers SILOG / l'ERP.

**Production :** [https://fsop.sedi-ati.com](https://fsop.sedi-ati.com)

## Fonctionnalités

- **Opérateur** — saisie d'un code LT, démarrage / pause / fin d'étape, suivi du temps journalier
- **Temps restant** — estimation par lancement (LCTC + temps consommés ETEMPS / ABTEMPS)
- **FSOP** — remplissage des fiches de traçabilité (composants, lots, mesures)
- **Admin** — supervision des opérateurs, consolidation et transfert vers SILOG
- **Documentation** — guide utilisateur et doc technique servis sous `/docs/`

## Structure du dépôt

| Dossier | Rôle |
|---------|------|
| `frontend/` | Interface tablette (SPA vanilla JS, Nginx en prod) |
| `backend/` | API Express (Node.js, port 3001) |
| `docker/` | Images Docker, Compose prod/test/monitoring |
| `docs/web/` | Documentation HTML (utilisateur + technique) |
| `agent/fsop-sync-agent/` | Agent de synchronisation FSOP |
| `ansible/`, `terraform/` | Provisionnement et inventaires |
| `jenkins/` | Pipelines CI |

## Prérequis

- Node.js 18+
- SQL Server (bases `SEDI_APP_INDEPENDANTE` et `SEDI_ERP`)
- Docker & Docker Compose (déploiement)

## Démarrage rapide (dev)

```bash
# Backend
cd backend
cp env.example .env   # adapter DB_SERVER, identifiants, etc.
npm install
npm run dev           # http://localhost:3001

# Frontend (autre terminal)
cd frontend
npm install
npm run dev           # http://localhost:8080
```

## Tests

```bash
# Backend (suite native FSOP)
cd backend && npm test

# Frontend
cd frontend && npm run test:run
```

> Sur Windows avec projet sur lecteur réseau mappé, Vitest 4 peut échouer à résoudre les chemins. Les tests passent en CI Linux et sur le serveur.

## Déploiement (production)

```bash
cd docker
cp .env.example .env   # secrets, DB, chemins FSOP
docker compose --env-file .env -f docker-compose.production.yml build backend frontend
docker compose --env-file .env -f docker-compose.production.yml up -d
```

Watchdog optionnel (systemd) :

```bash
sudo ./docker/scripts/install-systemd-watchdog.sh
```

## Documentation

| Public | Fichier | URL en prod |
|--------|---------|-------------|
| Atelier / bureau | `docs/web/index.html` | `/docs/` |
| Développeurs / ops | `docs/web/dev.html` | `/docs/dev.html` |
| Incidents backend | `backend/docs/RUNBOOK_INCIDENT_RAPIDE.md` | — |

## Stack technique

- **Frontend** — HTML/CSS/JS, Vitest
- **Backend** — Express 5, `mssql`, JWT, Redis (optionnel)
- **Infra** — Docker, Nginx, Prometheus/Grafana, Jenkins, SonarQube

## Licence

MIT — SEDI
