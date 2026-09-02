variable "ssh_user_default" {
  description = "Utilisateur SSH / Ansible par défaut (Linux et Windows maintenance)."
  type        = string
  default     = "maintenance"
}

variable "ssh_private_key_path_default" {
  description = "Chemin de la clé privée SSH sur le contrôleur (serveurproduction)."
  type        = string
  default     = "/home/maintenance/.ssh/id_ed25519"
}

variable "hosts" {
  description = <<-EOT
    Inventaire FSOP phase 1 (pas de création de VM).
    Clés attendues : prod, test, ci, silog.
    os = linux | windows
  EOT
  type = map(object({
    hostname     = string
    address      = string
    os           = string
    role         = string
    ssh_user     = optional(string)
    ssh_key_path = optional(string)
    enabled      = optional(bool, true)
  }))
}
