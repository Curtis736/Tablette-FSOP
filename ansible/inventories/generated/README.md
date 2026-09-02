# Inventaire généré par Terraform (`terraform apply` depuis terraform/).
# Fichier produit : fsop.yml (gitignoré).

Ne pas éditer `fsop.yml` à la main. Modifier `terraform/terraform.tfvars` puis :

```bash
cd /home/Tablette-FSOP/terraform   # ou chemin du clone
terraform apply
```

Playbooks SILOG :

```bash
cd ../ansible
ansible-playbook -i inventories/generated/fsop.yml playbooks/silog-runner-prereqs.yml
ansible-playbook -i inventories/generated/fsop.yml playbooks/silog-runner-verify.yml
```

L’inventaire manuel `inventories/production.yml` (variables d’environnement) reste utilisable en secours.
