# Configuration de la connexion à la base de données SQL Server

## Problème

Le conteneur Docker ne peut pas résoudre le nom d'hôte `SERVEURERP` par défaut, ce qui cause des erreurs `ENOTFOUND serveurerp`.

## Solution

### Option 1 : Utiliser extra_hosts (Recommandé)

1. Créez ou modifiez le fichier `docker/.env` dans le répertoire docker
2. Ajoutez l'adresse IP de votre serveur SQL Server :

```bash
# Adresse IP de votre serveur SQL Server
DB_SERVER_IP=192.168.1.10
```

3. Redémarrez les conteneurs :

```bash
cd /home/Tablette-FSOP/docker
docker-compose -f docker-compose.production.yml down
docker-compose -f docker-compose.production.yml up -d backend
```

### Option 2 : Utiliser directement l'IP dans DB_SERVER

Si vous préférez utiliser directement l'IP au lieu du nom d'hôte :

1. Dans `docker/.env`, définissez :

```bash
DB_SERVER=192.168.1.10
```

2. Redémarrez les conteneurs

### Option 3 : Utiliser le réseau host (Linux uniquement)

Si le serveur SQL est sur la même machine que Docker :

Modifiez `docker-compose.production.yml` et ajoutez `network_mode: host` au service backend (mais cela peut causer des conflits de ports).

## Vérification

Après configuration, vérifiez les logs :

```bash
docker logs sedi-tablette-backend | grep -i "database\|SQL\|SERVEURERP"
```

Vous ne devriez plus voir d'erreurs `ENOTFOUND serveurerp`.

## Trouver l'adresse IP de SERVEURERP

Sur votre VM, vous pouvez trouver l'IP avec :

```bash
# Si SERVEURERP est dans /etc/hosts
grep SERVEURERP /etc/hosts

# Ou ping pour voir l'IP
ping -c 1 SERVEURERP
```
