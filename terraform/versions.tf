terraform {
  required_version = ">= 1.5.0"

  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }

  # State local (gitignoré). Sur serveurproduction, préférer un chemin hors clone :
  #   cp backend.local.hcl.example backend.local.hcl
  #   terraform init -backend-config=backend.local.hcl
  backend "local" {
    path = "state/terraform.tfstate"
  }
}

provider "local" {}
