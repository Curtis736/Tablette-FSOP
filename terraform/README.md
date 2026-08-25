# Terraform FSOP — phase 1 (inventaire)

Source de vérité des hôtes FSOP (**prod / test / CI / SILOG**).  
Ne crée **pas** de VMs (pas d’API hyperviseur en phase 1).  
Génère l’inventaire Ansible : [`../ansible/inventories/generated/fsop.yml`](../ansible/inventories/generated/fsop.yml).

| Couche | Outil |
|--------|--------|
| Inventaire (IP, rôles, SSH) | **Terraform** (ce dossier) |
| Prérequis Windows SILOG | **Ansible** ([`../ansible/`](../ansible/)) |
| App / CI | Docker Compose + Jenkins |

Contrôleur prévu : **`serveurproduction`** (Ubuntu 24.04, `192.168.1.26`, user `maintenance`, accès PuTTY).

## Prérequis sur serveurproduction

```bash
# HashiCorp apt (Ubuntu 24.04)
sudo apt-get update && sudo apt-get install -y gnupg software-properties-common curl
curl -fsSL https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | \
  sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt-get update && sudo apt-get install -y terraform

terraform version   # >= 1.5
```

Clone / chemin repo typique : `/home/Tablette-FSOP` (ajuster si besoin).

## Premier apply

```bash
cd /home/Tablette-FSOP/terraform

cp terraform.tfvars.example terraform.tfvars
# Éditer : adresses test / ci / silog, puis enabled = true pour les hôtes connus

# State recommandé hors du clone git
mkdir -p /home/maintenance/terraform-state/fsop
cp backend.local.hcl.example backend.local.hcl
terraform init -backend-config=backend.local.hcl

terraform plan
terraform apply
```

Sans `backend.local.hcl`, le state va dans `terraform/state/` (gitignoré).

Fichiers **non commités** : `terraform.tfvars`, `backend.local.hcl`, `*.tfstate`, inventaire généré.

## Outputs utiles

```bash
terraform output hosts_enabled
terraform output ansible_inventory_path
terraform output prod_address
terraform output silog_address
```

## Brancher Ansible

```bash
cd /home/Tablette-FSOP/ansible
ansible-playbook -i inventories/generated/fsop.yml playbooks/silog-runner-prereqs.yml
ansible-playbook -i inventories/generated/fsop.yml playbooks/silog-runner-verify.yml
```

Pour le bootstrap WinRM, garder `SILOG_ANSIBLE_PASSWORD` (et éventuellement `SILOG_ANSIBLE_CONNECTION=winrm`) en variables d’environnement — jamais dans Terraform.

## Contenu de `hosts` (tfvars)

| Clé | Rôle | OS | Défaut exemple |
|-----|------|-----|----------------|
| `prod` | FSOP production | linux | `192.168.1.26` / `serveurproduction` |
| `test` | FSOP test | linux | placeholder, `enabled = false` |
| `ci` | Jenkins / Sonar | linux | placeholder, `enabled = false` |
| `silog` | Runner EDI | windows | placeholder, `enabled = false` |

Un hôte avec `enabled = false` n’apparaît pas dans l’inventaire généré.

## Hors scope (phase 1)

- Création / clonage de VMs (Proxmox, libvirt, Hyper-V, cloud)
- Remplacement de Docker Compose / Jenkinsfile
- `SERVEURERP` / SQL Server

## Phase 2 (plus tard)

Quand un hyperviseur est disponible : ajouter le provider, modules `vm_linux` / `vm_windows`, cloud-init, éventuellement `terraform import` des machines existantes. Ansible reste pour la config guest Windows SILOG.
