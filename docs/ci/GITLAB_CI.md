# Mise en place de GitLab CI

Le fichier `.gitlab-ci.yml` à la racine reprend le pipeline GitHub Actions actuel
(`.github/workflows/ci-cd.yml`) :

| Stage      | Jobs                                              | Où ça tourne                 |
|------------|---------------------------------------------------|------------------------------|
| `test`     | `backend-tests` (Node 20 et 22), `frontend-smoke`, `lint` | runners partagés GitLab.com |
| `security` | `npm-audit` (backend + frontend, niveau `high`)   | runners partagés GitLab.com |
| `runtime`  | `runtime-check` (démarrage backend + frontend)    | runners partagés GitLab.com |
| `build`    | `docker-build` (images backend et frontend, sans push) | runners partagés (Docker-in-Docker) |
| `deploy`   | `deploy-production` (sur `main`/`master` uniquement) | runner installé sur **serveurproduction** |

Le pipeline se lance sur les merge requests, sur les push vers `main`, `master`
et `develop`, sur les pipelines programmés et à la main (bouton *Run pipeline*).

## Pourquoi un runner sur le serveur pour le déploiement

Le serveur n'est joignable que par Tailscale (100.87.41.0, SSH port 722). C'est
pour ça que le job `deploy` de GitHub Actions échoue depuis le 13 octobre : les
machines de GitHub ne voient pas le réseau Tailscale.

Un GitLab Runner installé sur le serveur ouvre lui-même une connexion **sortante**
HTTPS vers gitlab.com et vient chercher les jobs. Il n'y a donc ni port à ouvrir,
ni clé SSH à stocker dans GitLab, ni Tailscale à lancer dans le job. Seul le job
`deploy-production` (tag `serveurproduction`) tourne sur ce runner ; les tests
restent sur les runners partagés de GitLab.

Alternative possible (non retenue) : démarrer Tailscale dans le job avec une clé
d'authentification éphémère, puis SSH vers le serveur. Ça marche, mais il faut
gérer une clé Tailscale et une clé SSH en variables, et la clé Tailscale expire.

## Étapes à faire dans GitLab

### 1. Créer le projet

Fait : le projet est sur https://gitlab.com/Curtis736/Tablette-FSOP
(synchronisé depuis GitHub). Pour mémoire, les deux options étaient :

- **Miroir de GitHub (recommandé pour commencer)** : sur gitlab.com,
  *New project > Run CI/CD for external repository > GitHub*, puis choisir
  `Curtis736/Tablette-FSOP`. GitLab synchronise le dépôt et lance les pipelines ;
  GitHub reste la source de vérité.
- **Migration complète** : *New project > Import project > GitHub*. Le code,
  les issues et les MR sont importés, et on travaille ensuite dans GitLab.

Pour tester le pipeline avant de fusionner sur `main` : *Build > Pipelines >
Run pipeline*, choisir la branche. Les jobs de test, d'audit et de build tournent ;
le déploiement, lui, ne part que sur un push vers `main`/`master`.

### 2. Installer et enregistrer le runner sur serveurproduction

À faire en SSH sur le serveur (`ssh -p 722 maintenance@100.87.41.0`).

1. Dans GitLab (https://gitlab.com/Curtis736/Tablette-FSOP/-/settings/ci_cd) :
   *Runners > New project runner*.
   - Tags : `serveurproduction`
   - Décocher *Run untagged jobs* (pour que seul le déploiement tourne ici)
   - Copier le token `glrt-...` affiché.
2. Sur le serveur, installer le runner (Debian/Ubuntu) :

   ```bash
   curl -L "https://packages.gitlab.com/install/repositories/runner/gitlab-runner/script.deb.sh" | sudo bash
   sudo apt-get install -y gitlab-runner
   ```

3. Faire tourner le runner avec l'utilisateur `maintenance` (qui a déjà Docker
   et le dépôt) :

   ```bash
   sudo gitlab-runner uninstall
   sudo gitlab-runner install --user maintenance --working-directory /home/maintenance
   sudo gitlab-runner start
   ```

4. Enregistrer le runner avec l'executor `shell` :

   ```bash
   sudo gitlab-runner register \
     --non-interactive \
     --url https://gitlab.com \
     --token glrt-XXXXXXXX \
     --executor shell
   ```

5. Vérifier : `sudo gitlab-runner verify` et le runner doit apparaître en vert
   dans *Settings > CI/CD > Runners*.

### 3. Variables CI/CD

*Settings > CI/CD > Variables* :

| Variable        | Valeur                                       | Obligatoire |
|-----------------|----------------------------------------------|-------------|
| `PROD_REPO_DIR` | chemin du dépôt sur le serveur (défaut `/home/Tablette-FSOP`) | seulement si le chemin est différent |

Aucun secret SSH n'est nécessaire avec le runner sur le serveur. Les anciens
secrets GitHub (`PROD_HOST`, `PROD_SSH_KEY`, ...) ne sont pas à recopier.

### 4. Remote git du dépôt sur le serveur

Le job de déploiement fait `git pull` dans `PROD_REPO_DIR`, comme aujourd'hui.

- Avec le **miroir**, le serveur peut continuer à tirer depuis GitHub.
- Avec une **migration complète**, changer le remote :
  `git remote set-url origin https://gitlab.com/<groupe>/tablette-fsop.git`
  (avec un *deploy token* en lecture si le projet est privé).

Le job affiche un avertissement si le commit déployé ne correspond pas au commit
du pipeline (miroir en retard ou mauvais remote).

### 5. Optionnel

- **Audit de sécurité hebdomadaire** : *Build > Pipeline schedules*, par exemple
  le lundi à 2h sur `main` (remplace `security.yml`). Le déploiement ne se
  déclenche pas sur un pipeline programmé.
- **Protéger l'environnement** `production` (*Operate > Environments*) pour
  exiger une validation manuelle avant chaque déploiement.

## Et GitHub Actions ?

Les workflows `.github/workflows/` sont laissés en place. Une fois le pipeline
GitLab validé, on pourra supprimer `ci-cd.yml` (ou au moins son job `deploy`)
pour éviter deux déploiements en parallèle.
