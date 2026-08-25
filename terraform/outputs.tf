output "hosts" {
  description = "Hôtes FSOP normalisés (tous, y compris disabled)."
  value       = local.hosts_normalized
}

output "hosts_enabled" {
  description = "Hôtes actifs écrits dans l’inventaire Ansible."
  value       = local.hosts_enabled
}

output "ansible_inventory_path" {
  description = "Chemin de l’inventaire généré."
  value       = abspath(local.ansible_inventory_path)
}

output "prod_address" {
  description = "Adresse du serveur prod FSOP."
  value       = try(local.hosts_normalized["prod"].address, null)
}

output "silog_address" {
  description = "Adresse du runner SILOG (si défini)."
  value       = try(local.hosts_normalized["silog"].address, null)
}

output "ssh_user_default" {
  value = var.ssh_user_default
}

output "ssh_private_key_path_default" {
  value = var.ssh_private_key_path_default
}
