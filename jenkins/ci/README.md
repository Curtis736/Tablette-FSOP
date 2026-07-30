# CI interne SEDI — Jenkins + SonarQube

Stack Docker pour un **serveur CI dédié** (pas `serveurproduction` FSOP).

## Démarrage

```bash
cd /opt/sedi-ci   # ou clone du repo → jenkins/ci
cp .env.example .env
# Éditer SONAR_DB_PASSWORD

# Prérequis host Linux (souvent requis par Sonar)
sudo sysctl -w vm.max_map_count=524288
echo 'vm.max_map_count=524288' | sudo tee /etc/sysctl.d/99-sonarqube.conf

mkdir -p /var/lib/sedi-ci/repos
docker compose --env-file .env build jenkins
docker compose --env-file .env up -d
docker compose ps
```

L’image Jenkins custom (`Dockerfile.jenkins`) est basée sur **JDK 21**, avec Docker CLI, Node 22 et sonar-scanner.
- Jenkins : `http://<ci-host>:8085`
- SonarQube : `http://<ci-host>:9000` (admin / admin au 1er login → changer le mot de passe)

Mot de passe Jenkins initial :

```bash
docker exec sedi-jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

## Plugins Jenkins recommandés

Installer (Manage Plugins) :

- Pipeline
- Git
- Docker Pipeline / Docker
- SonarQube Scanner
- SSH Agent
- Credentials Binding
- Pipeline Utility Steps

## Credentials Jenkins (IDs attendus par le Jenkinsfile)

| ID | Type | Usage |
|----|------|--------|
| `sonar-token` | Secret text | Token utilisateur Sonar (Generate Tokens) |
| `git-creds` | Username/password ou SSH | Clone repo si privé |
| `test-deploy-ssh` | SSH private key | Deploy distant (optionnel si Docker local) |

## Configurer Sonar dans Jenkins

1. **Manage Jenkins → System → SonarQube servers**
2. Name : `sedi-sonar` (doit matcher le Jenkinsfile)
3. Server URL : `http://sonarqube:9000` (réseau Docker) ou `http://<ci-host>:9000`
4. Server authentication token : credential `sonar-token`

## Job Multibranch

1. New Item → **Multibranch Pipeline**
2. Branch sources → Git → URL du repo Tablette-FSOP
3. Discover branches : `main`, `master`, `feature/*`
4. Build Configuration → Mode : by Jenkinsfile
5. Scan Periodically (ex. 5 min) ou webhook GitHub

## Projet SonarQube

1. Créer projet manuel `tablette-fsop` (clé = `tablette-fsop`)
2. Générer un token → credential Jenkins `sonar-token`
3. Quality Gate : utiliser le gate par défaut (ou exiger coverage)

Le `Jenkinsfile` à la racine du repo envoie l’analyse puis attend le Quality Gate.

## Déploiement test

Le pipeline appelle `docker/scripts/deploy-test.sh` (jamais la prod).

Préparer sur l’hôte de test :

```bash
cp docker/.env.test.example docker/.env.test
# renseigner DB SEDI_TESTS, secrets, etc.
```

Voir aussi : `docker/docker-compose.test.yml`.

## Séparation des rôles

| Machine | Rôle |
|---------|------|
| Serveur CI | Jenkins + SonarQube |
| Hôte test FSOP | `docker-compose.test.yml` |
| serveurproduction | Prod uniquement (hors CI auto) |
