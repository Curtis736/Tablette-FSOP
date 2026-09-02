# Ansible — prérequis runner SILOG (pas le déclenchement runtime)

## Rôle

Prépare **SVC_SILOG** (Windows) pour que le backend FSOP (Linux/Docker) puisse lancer `SILOG.exe` **via SSH** au clic Transfert.

| Couche | Outil |
|--------|--------|
| Inventaire hôtes (IP / rôles) | **Terraform** → `inventories/generated/fsop.yml` (voir [`../terraform/README.md`](../terraform/README.md)) |
| Prérequis (ce dossier) | Ansible |
| Au clic Transfert | Backend `SILOG_REMOTE_MODE=ssh` |
| Filet | Tâche planifiée `FSOP_SEDI_ETDIFF` (toutes les 2 h) |

### Inventaire recommandé (Terraform)

1. Renseigner `terraform/terraform.tfvars` (`silog.enabled = true`, adresse réelle).
2. `cd ../terraform && terraform apply`
3. Lancer les playbooks avec `-i inventories/generated/fsop.yml`

L’inventaire manuel `inventories/production.yml` (variables d’environnement `SILOG_ANSIBLE_*`) reste un **secours** si Terraform n’a pas encore été appliqué.

## Prérequis contrôleur (serveur tablette)

```bash
sudo apt-get update
sudo apt-get install -y ansible python3-pip
ansible-galaxy collection install ansible.windows community.windows
# WinRM bootstrap:
pip3 install --user pywinrm
```

Générer une clé si besoin :

```bash
sudo -u maintenance ssh-keygen -t ed25519 -f /home/maintenance/.ssh/id_ed25519 -N ''
```

## Bootstrap (WinRM → installe OpenSSH + clé)

### Avec inventaire Terraform (recommandé)

```bash
cd /home/Tablette-FSOP/terraform
# terraform.tfvars : silog.address + enabled = true
terraform apply

cd /home/Tablette-FSOP/ansible
export SILOG_ANSIBLE_USER=maintenance
export SILOG_ANSIBLE_PASSWORD='MotDePasseWindows'
export SILOG_ANSIBLE_CONNECTION=winrm
export SILOG_SSH_PUBLIC_KEY_FILE=/home/maintenance/.ssh/id_ed25519.pub

ansible-playbook -i inventories/generated/fsop.yml playbooks/silog-runner-prereqs.yml
```

### Secours (inventaire manuel + env)

```bash
cd /home/Tablette-FSOP/ansible

export SILOG_ANSIBLE_HOST=IP_OU_DNS_SVC_SILOG
export SILOG_ANSIBLE_USER=maintenance
export SILOG_ANSIBLE_PASSWORD='MotDePasseWindows'
export SILOG_ANSIBLE_CONNECTION=winrm
export SILOG_SSH_PUBLIC_KEY_FILE=/home/maintenance/.ssh/id_ed25519.pub

ansible-playbook -i inventories/production.yml playbooks/silog-runner-prereqs.yml
```

Sur le Windows cible, WinRM doit être activé une fois (IT) :

```powershell
Enable-PSRemoting -Force
winrm set winrm/config/service/auth '@{Basic="true"}'
```

## Vérifier en SSH

```bash
# Adresse = celle de terraform.tfvars (silog) ou $SILOG_ANSIBLE_HOST
ssh -i /home/maintenance/.ssh/id_ed25519 maintenance@IP_OU_DNS_SVC_SILOG "echo OK"

export SILOG_ANSIBLE_CONNECTION=ssh
# Recommandé :
ansible-playbook -i inventories/generated/fsop.yml playbooks/silog-runner-verify.yml
# Secours :
# ansible-playbook -i inventories/production.yml playbooks/silog-runner-verify.yml
```

## Brancher FSOP ensuite (`docker/.env`)

```env
SILOG_REMOTE_MODE=ssh
SILOG_SSH_HOST=IP_OU_DNS_SVC_SILOG
SILOG_SSH_USER=maintenance
SILOG_SSH_KEY_PATH=/home/maintenance/.ssh/id_ed25519
SILOG_EXE_PATH=C:\SILOG8\SILOG.exe
SILOG_WORKDIR=C:\SILOG8
SILOG_DB=SEDI_ERP
SILOG_USER=Production8
SILOG_TASK_CODE=SEDI_ETDIFF
SILOG_MAX_RUNS_PER_DAY=50
```

Puis recreate backend.

## Variables utiles (`group_vars/silog_runners.yml`)

- `silog_exe_path` / `silog_workdir` — local ou UNC
- `silog_db` — `SEDI_ERP` (prod) / `SEDI_TESTS`
- `silog_ensure_scheduled_task` — filet 2 h
- `silog_password` — optionnel (`SILOG_PASSWORD`)

## Hors scope

Ansible **ne remplace pas** le déclenchement au clic Transfert (latency + complexité).  
Les lancements **soldés** restent bloqués côté SILOG même si SSH/EDI OK.
