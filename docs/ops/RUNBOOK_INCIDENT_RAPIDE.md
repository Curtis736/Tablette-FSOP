# Runbook incident rapide (production)

Objectif: permettre a l'equipe de diagnostiquer et corriger rapidement les incidents critiques sans dependre d'une personne.

## 0) CI interne

Voir [`jenkins/ci/README.md`](../../jenkins/ci/README.md) (Jenkins + SonarQube).

L’ancien stack **test** (:8088) est archivé dans `docker/legacy/` (ne plus utiliser comme chemin officiel).  
La prod (`docker/prod/` / ports 80-443) n’est **pas** déployée par Jenkins.

### Alertes Prometheus → Teams (monitoring)

Stack : `docker/prod/docker-compose.monitoring.yml` (Prometheus, Alertmanager, prometheus-msteams, Grafana).

Dans `docker/prod/.env` :
```
TEAMS_WEBHOOK_URL=https://outlook.office.com/webhook/...
```

Déploiement / mise à jour monitoring **sans toucher l’app tablette** :
```bash
cd /home/Tablette-FSOP/docker/prod
bash scripts/apply-monitoring.sh
```

- Règles : `docker/prod/prometheus/alerts.yml` (backend down, erreurs HTTP, CPU/RAM/disque VM, Redis)
- Vérifier : http://\<vm\>:9091/alerts et http://127.0.0.1:9093 (Alertmanager, sur la VM)
- Grafana : http://\<vm\>:3002 — dashboard **SEDI Tablette — Prod**

## 1) Verifier etat backend / watchdog


```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
docker logs --tail 120 sedi-tablette-backend
tail -n 80 /var/log/sedi-watchdog.log
tail -n 80 /var/log/sedi-watchdog-alert.log
sudo systemctl status sedi-backend-health.timer sedi-watchdog.timer sedi-backup.timer
```

### Alertes watchdog métier (Teams / email)

Codes utiles (cooldown indépendant via `ReliabilityAlertService`) :

| Code | Sens | Action typique |
|------|------|----------------|
| `WATCHDOG_HOLD_STALE` | Lignes `A` > `HOLD_STALE_HOURS` (déf. 2 h) ou encore présentes après `HOLD_ALERT_AFTER_HOUR` | Admin → débloquer / corriger / transfert une ligne |
| `WATCHDOG_SILOG_STALE` | `O` stale hors soldés, ou backlog `O` ≥ `SILOG_BACKLOG_O_WARN` | Transfert / EDI_JOB |
| `WATCHDOG_EDI_FAILURE` | Dernier EDI_JOB en échec (< `EDI_FAILURE_ALERT_HOURS`) | Logs SILOG runner / SSH / tâche planifiée |
| `WATCHDOG_CIFS_TRACEABILITY` / `WATCHDOG_TEMPLATES` | Montages / chemins inaccessibles dans le conteneur | `ensure-cifs-mounts.sh`, `mount -a` |

CIFS **hôte** : `docker/prod/scripts/ensure-cifs-mounts.sh` envoie aussi une carte Teams si le webhook est dans `docker/prod/.env`.

### Activer alertes + timers (une fois sur la VM)

Dans `docker/prod/.env` :
```
TEAMS_WEBHOOK_URL=https://outlook.office.com/webhook/...
ALERT_EMAIL=...
ALERTS_ENABLED=true
```

```bash
# Adapter FSOP_ROOT si le clone n'est pas /home/Tablette-FSOP
cd /home/Tablette-FSOP
sudo chmod +x docker/prod/scripts/install-systemd-watchdog.sh docker/prod/scripts/*.sh
sudo ./docker/prod/scripts/install-systemd-watchdog.sh
```

Le script installe health + CIFS + watchdog et adapte les chemins au clone courant.

**Obligatoire pour remonter le backend tout seul** dans `docker/prod/.env` :
```
AUTO_RESTART_BACKEND=true
TEAMS_WEBHOOK_URL=https://outlook.office.com/webhook/...
```

Sans `AUTO_RESTART_BACKEND=true`, le timer `sedi-backend-health` alerte seulement : si le conteneur a disparu (`docker ps` sans `sedi-tablette-backend`), il ne le recrée pas. Le script utilise `compose up -d backend` (pas seulement `restart`) quand le conteneur est absent.

Backup (séparé) :
```bash
sudo cp docker/prod/systemd/sedi-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sedi-backup.timer
```

Test manuel :
```bash
/home/Tablette-FSOP/docker/prod/scripts/check-backend-alive.sh
docker exec sedi-tablette-backend node /app/scripts/proactive-watchdog.js
/home/Tablette-FSOP/docker/prod/scripts/backup-fsop.sh
```

Sauvegarde → `/var/backups/tablette-fsop/YYYYMMDD_HHMMSS`  
Restore : `./docker/prod/scripts/restore-fsop.sh /var/backups/tablette-fsop/...`

## 2) Incident FSOP templates (TEMPLATES_DIR_NOT_FOUND)

```bash
docker exec -it sedi-tablette-backend sh -lc 'printenv | grep -E "^FSOP_TEMPLATES_DIR|^FSOP_TEMPLATES_XLSX_PATH"'
docker exec -it sedi-tablette-backend sh -lc 'ls -la "/mnt/templates/Qualite/4_Public/A disposition/DOSSIER SMI/Formulaires"'
```

Si le dossier est inaccessible:

```bash
mount | grep -E "partage_services|templates"
grep -nE "partage_services|templates|cifs" /etc/fstab
```

Puis recreer le backend:

```bash
cd /home/Tablette-FSOP/docker/prod && docker compose --env-file .env up -d --force-recreate backend
```

### Si les montages CIFS ont disparu (backend peut aussi quitter)
Vérifie si les partages sont toujours montés sur la VM :

```bash
mountpoint -q /mnt/partage_fsop && echo "OK: /mnt/partage_fsop" || sudo mount -a
mountpoint -q /mnt/partage_services && echo "OK: /mnt/partage_services" || sudo mount -a
# Templates : souvent un sous-dossier (pas un point de montage), ex. /mnt/partage_services/Services
test -d "/mnt/partage_services/Services" && echo "OK: templates path" || ls -la /mnt/partage_services/
```

Le timer systemd `sedi-cifs-ensure.timer` vérifie **toutes les 60 s** et remonte automatiquement
(y compris les montages « morts » / stale). **À installer une fois** sur la VM :

```bash
cd /home/Tablette-FSOP
git pull
sudo ./docker/prod/scripts/install-systemd-watchdog.sh
systemctl status sedi-cifs-ensure.timer
```

Durcir `/etc/fstab` (exemples d’options CIFS stables) :
```
_netdev,vers=3.1.1,nofail,x-systemd.automount,x-systemd.mount-timeout=30,soft,echo_interval=60
```
- `_netdev` + `x-systemd.automount` : remonte au boot / à l’accès
- `nofail` : le boot ne bloque pas si le share est down
- `soft` : évite un freeze Linux si le serveur SMB est mort


## 3) Incident DB timeout

```bash
docker logs --tail 200 sedi-tablette-backend | grep -E "DB_TIMEOUT|ConnectionError|Failed to connect"
docker exec -it sedi-tablette-backend sh -lc 'node -e "const sql=require(\"mssql\");(async()=>{await sql.connect({user:process.env.DB_USER,password:process.env.DB_PASSWORD,server:process.env.DB_SERVER,database:process.env.DB_NAME,options:{encrypt:false,trustServerCertificate:true},requestTimeout:15000,connectionTimeout:15000});const r=await sql.query(\"SELECT 1 AS ok\");console.log(r.recordset);await sql.close();})().catch(e=>{console.error(e.message);process.exit(1);});"'
```

## 4) Incident pipeline SILOG (O ne passe pas en T)

Verifier les compteurs:

```bash
docker exec -it sedi-tablette-backend sh -lc 'node -e "const sql=require(\"mssql\");(async()=>{await sql.connect({user:process.env.DB_USER,password:process.env.DB_PASSWORD,server:process.env.DB_SERVER,database:process.env.DB_NAME,options:{encrypt:false,trustServerCertificate:true}});const s=await sql.query(\"SELECT StatutTraitement, COUNT(*) AS c FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] GROUP BY StatutTraitement\");console.log(s.recordset);await sql.close();})().catch(e=>{console.error(e.message);process.exit(1);});"'
```

Migration pause type (DEJ fiable) — une fois sur SQL:

```sql
-- backend/sql/migration_add_pause_type_on_historique.sql
-- Ajoute PauseTypeCode sur ABHISTORIQUE_OPERATEURS (+ backfill depuis AB_PAUSE_TYPE_LOG)
```

Health / déploiement (déjà en place):
- `GET /api/health` + healthcheck Docker
- timer systemd `sedi-backend-health.timer` → `check-backend-alive.sh`
- backups: `sedi-backup.timer`

Forcer NULL -> O (si necessaire):

```bash
docker exec -it sedi-tablette-backend sh -lc 'node -e "const sql=require(\"mssql\");(async()=>{await sql.connect({user:process.env.DB_USER,password:process.env.DB_PASSWORD,server:process.env.DB_SERVER,database:process.env.DB_NAME,options:{encrypt:false,trustServerCertificate:true}});const u=await sql.query(\"UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] SET StatutTraitement = CHAR(79) WHERE StatutTraitement IS NULL AND ISNULL(ProductiveDuration,0) > 0\");console.log(u.rowsAffected);await sql.close();})().catch(e=>{console.error(e.message);process.exit(1);});"'
```

Si O reste > 0 et T = 0 apres delai attendu:
- verifier la tache Windows `SEDI_ETDIFF` sur le poste SILOG (SERVEURERP/SVC_SILOG),
- controler `LastRunTime`, `LastTaskResult`, `NextRunTime`.

## 5) Rechargement de la crontab production

```bash
crontab /home/Tablette-FSOP/ops/cron/crontab-production
crontab -l
```

## 6) Criteria de retour a la normale

- backend en etat healthy,
- watchdog sans alerte nouvelle,
- FSOP templates lisibles dans le container,
- requetes SQL sans timeout,
- pipeline SILOG: O diminue, T augmente.
