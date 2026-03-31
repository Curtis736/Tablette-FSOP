# Runbook incident rapide (production)

Objectif: permettre a l'equipe de diagnostiquer et corriger rapidement les incidents critiques sans dependre d'une personne.

## 1) Verifier etat backend / watchdog

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
docker logs --tail 120 sedi-tablette-backend
tail -n 80 /var/log/sedi-watchdog.log
tail -n 80 /var/log/sedi-watchdog-alert.log
```

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
