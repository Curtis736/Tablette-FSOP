# Runbook incident rapide (production)

Objectif: permettre a l'equipe de diagnostiquer et corriger rapidement les incidents critiques sans dependre d'une personne.

## 0) CI interne / environnement test

Voir [`jenkins/ci/README.md`](../../jenkins/ci/README.md) (Jenkins + SonarQube).

Déploiement **test** (jamais la prod) :

```bash
cp docker/.env.test.example docker/.env.test
# éditer secrets + SEDI_TESTS
chmod +x docker/scripts/deploy-test.sh
./docker/scripts/deploy-test.sh
```

- UI test : `http://<host-test>:8088`
- Health : `http://<host-test>:8088/api/health` (ou via container backend)

La prod (`docker-compose.production.yml` / ports 80-443) n’est **pas** déployée par Jenkins.

## 1) Verifier etat backend / watchdog


```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
docker logs --tail 120 sedi-tablette-backend
tail -n 80 /var/log/sedi-watchdog.log
tail -n 80 /var/log/sedi-watchdog-alert.log
sudo systemctl status sedi-backend-health.timer sedi-watchdog.timer sedi-backup.timer
```

### Activer alertes + timers (une fois sur la VM)

Dans `docker/.env` :
```
TEAMS_WEBHOOK_URL=https://outlook.office.com/webhook/...
ALERT_EMAIL=...
ALERTS_ENABLED=true
```

```bash
sudo chmod +x /home/Tablette-FSOP/docker/scripts/*.sh
sudo cp /home/Tablette-FSOP/docker/systemd/sedi-backend-health.* /etc/systemd/system/
sudo cp /home/Tablette-FSOP/docker/systemd/sedi-watchdog.* /etc/systemd/system/
sudo cp /home/Tablette-FSOP/docker/systemd/sedi-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sedi-backend-health.timer sedi-watchdog.timer sedi-backup.timer
```

Test manuel :
```bash
/home/Tablette-FSOP/docker/scripts/check-backend-alive.sh
docker exec sedi-tablette-backend node /app/scripts/proactive-watchdog.js
/home/Tablette-FSOP/docker/scripts/backup-fsop.sh
```

Sauvegarde → `/var/backups/tablette-fsop/YYYYMMDD_HHMMSS`  
Restore : `./docker/scripts/restore-fsop.sh /var/backups/tablette-fsop/...`

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
cd /home/Tablette-FSOP && docker compose --env-file docker/.env -f docker/docker-compose.production.yml up -d --force-recreate backend
```

### Si les montages CIFS ont disparu (backend peut aussi quitter)
Vérifie si les partages sont toujours montés sur la VM :

```bash
mountpoint -q /mnt/partage_fsop && echo "OK: /mnt/partage_fsop" || sudo mount -a
mountpoint -q /mnt/partage_services && echo "OK: /mnt/partage_services" || sudo mount -a
# Templates : souvent un sous-dossier (pas un point de montage), ex. /mnt/partage_services/Services
test -d "/mnt/partage_services/Services" && echo "OK: templates path" || ls -la /mnt/partage_services/
```

Si tu déploies le timer systemd `sedi-cifs-ensure.timer`, il relance automatiquement `mount -a` quand les montages manquent.

Pour activer le timer (sur la VM) :
```bash
sudo chmod +x /home/Tablette-FSOP/docker/scripts/ensure-cifs-mounts.sh
sudo cp /home/Tablette-FSOP/docker/systemd/sedi-cifs-ensure.service /etc/systemd/system/
sudo cp /home/Tablette-FSOP/docker/systemd/sedi-cifs-ensure.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sedi-cifs-ensure.timer
sudo systemctl status sedi-cifs-ensure.timer
```

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

Forcer NULL -> O (si necessaire):

```bash
docker exec -it sedi-tablette-backend sh -lc 'node -e "const sql=require(\"mssql\");(async()=>{await sql.connect({user:process.env.DB_USER,password:process.env.DB_PASSWORD,server:process.env.DB_SERVER,database:process.env.DB_NAME,options:{encrypt:false,trustServerCertificate:true}});const u=await sql.query(\"UPDATE [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] SET StatutTraitement = CHAR(79) WHERE StatutTraitement IS NULL AND ISNULL(ProductiveDuration,0) > 0\");console.log(u.rowsAffected);await sql.close();})().catch(e=>{console.error(e.message);process.exit(1);});"'
```

Si O reste > 0 et T = 0 apres delai attendu:
- verifier la tache Windows `SEDI_ETDIFF` sur le poste SILOG (SERVEURERP/SVC_SILOG),
- controler `LastRunTime`, `LastTaskResult`, `NextRunTime`.

## 5) Rechargement de la crontab production

```bash
crontab /home/Tablette-FSOP/crontab-production
crontab -l
```

## 6) Criteria de retour a la normale

- backend en etat healthy,
- watchdog sans alerte nouvelle,
- FSOP templates lisibles dans le container,
- requetes SQL sans timeout,
- pipeline SILOG: O diminue, T augmente.
