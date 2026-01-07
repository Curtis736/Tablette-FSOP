/**
 * Service pour l'exécution de l'EDI_JOB de SILOG
 * Permet de déclencher la remontée des temps de production dans les tables standard de SILOG
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execAsync = promisify(exec);

class EdiJobService {
    /**
     * Exécuter l'EDI_JOB de SILOG
     * @param {string} codeTache - Code de la tâche à exécuter
     * @param {Object} options - Options supplémentaires (profil, utilisateur, mot de passe, etc.)
     * @returns {Promise<Object>} Résultat de l'exécution
     */
    static async executeEdiJob(codeTache, options = {}) {
        try {
            // Configuration par défaut (à adapter selon l'environnement)
            const config = {
                silogPath: process.env.SILOG_PATH || options.silogPath || 'C:\\SILOG\\SILOG.exe',
                profil: process.env.SILOG_PROFIL || options.profil || 'Profil',
                utilisateur: process.env.SILOG_USER || options.utilisateur || 'USER',
                motDePasse: process.env.SILOG_PASSWORD || options.motDePasse || '',
                langue: process.env.SILOG_LANGUE || options.langue || 'fr_fr',
                mode: options.mode || 'COMPACT'
            };
            
            // Construire la commande
            // Format: EXEC Chemin ERP Silog\SILOG.exe -bProfil -uUSER -pMotDePasseUtilisateurERP 
            //         -dfr_fr -eEDI_JOB -optcodetache=CodeTache -mCOMPACT
            const command = `"${config.silogPath}" -b${config.profil} -u${config.utilisateur} -p${config.motDePasse} -d${config.langue} -eEDI_JOB -optcodetache=${codeTache} -m${config.mode}`;
            
            console.log(`🚀 Exécution de l'EDI_JOB avec codeTache=${codeTache}`);
            console.log(`📝 Commande: ${command.replace(/-p[^\s]+/, '-p***')}`); // Masquer le mot de passe dans les logs
            
            // Exécuter la commande
            const { stdout, stderr } = await execAsync(command, {
                timeout: 300000, // 5 minutes de timeout
                maxBuffer: 10 * 1024 * 1024 // 10 MB de buffer
            });
            
            // Analyser le résultat
            const success = !stderr || stderr.trim().length === 0;
            
            if (success) {
                console.log(`✅ EDI_JOB exécuté avec succès pour codeTache=${codeTache}`);
                return {
                    success: true,
                    message: 'EDI_JOB exécuté avec succès',
                    codeTache: codeTache,
                    stdout: stdout,
                    stderr: stderr || null
                };
            } else {
                console.warn(`⚠️ EDI_JOB exécuté avec des avertissements pour codeTache=${codeTache}`);
                return {
                    success: true, // Considéré comme succès même avec des avertissements
                    message: 'EDI_JOB exécuté avec des avertissements',
                    codeTache: codeTache,
                    stdout: stdout,
                    stderr: stderr,
                    warnings: true
                };
            }
            
        } catch (error) {
            console.error(`❌ Erreur lors de l'exécution de l'EDI_JOB pour codeTache=${codeTache}:`, error);
            
            // Analyser le type d'erreur
            let errorMessage = 'Erreur lors de l\'exécution de l\'EDI_JOB';
            let errorDetails = null;
            
            if (error.code === 'ENOENT') {
                errorMessage = 'Fichier SILOG.exe non trouvé. Vérifiez le chemin de configuration.';
                errorDetails = `Chemin attendu: ${process.env.SILOG_PATH || 'C:\\SILOG\\SILOG.exe'}`;
            } else if (error.code === 'ETIMEDOUT') {
                errorMessage = 'Timeout lors de l\'exécution de l\'EDI_JOB';
                errorDetails = 'L\'exécution a pris plus de 5 minutes';
            } else if (error.stderr) {
                errorMessage = 'Erreur lors de l\'exécution de l\'EDI_JOB';
                errorDetails = error.stderr;
            } else {
                errorDetails = error.message;
            }
            
            return {
                success: false,
                error: errorMessage,
                details: errorDetails,
                codeTache: codeTache
            };
        }
    }
    
    /**
     * Exécuter l'EDI_JOB pour un lot d'enregistrements transmis
     * @param {Array<number>} tempsIds - Liste des IDs d'enregistrements transmis
     * @param {string} codeTache - Code de la tâche (optionnel, généré automatiquement si non fourni)
     * @returns {Promise<Object>} Résultat de l'exécution
     */
    static async executeEdiJobForTransmittedRecords(tempsIds, codeTache = null) {
        try {
            // Si aucun codeTache n'est fourni, générer un code basé sur la date et l'heure
            if (!codeTache) {
                const now = new Date();
                codeTache = `EDI_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
            }
            
            console.log(`🚀 Exécution de l'EDI_JOB pour ${tempsIds.length} enregistrements transmis`);
            
            const result = await this.executeEdiJob(codeTache);
            
            if (result.success) {
                console.log(`✅ EDI_JOB exécuté avec succès pour ${tempsIds.length} enregistrements`);
            }
            
            return {
                ...result,
                tempsIds: tempsIds,
                count: tempsIds.length
            };
            
        } catch (error) {
            console.error('❌ Erreur lors de l\'exécution de l\'EDI_JOB pour les enregistrements transmis:', error);
            return {
                success: false,
                error: error.message,
                tempsIds: tempsIds
            };
        }
    }
    
    /**
     * Vérifier la configuration de l'EDI_JOB
     * @returns {Promise<Object>} État de la configuration
     */
    static async checkConfiguration() {
        try {
            const config = {
                silogPath: process.env.SILOG_PATH || 'C:\\SILOG\\SILOG.exe',
                profil: process.env.SILOG_PROFIL || 'Profil',
                utilisateur: process.env.SILOG_USER || 'USER',
                langue: process.env.SILOG_LANGUE || 'fr_fr',
                hasPassword: !!(process.env.SILOG_PASSWORD || '')
            };
            
            // Vérifier si le fichier existe (si le chemin est absolu)
            const fs = require('fs');
            let pathExists = false;
            let pathError = null;
            
            try {
                if (path.isAbsolute(config.silogPath)) {
                    pathExists = fs.existsSync(config.silogPath);
                } else {
                    // Si le chemin est relatif, on ne peut pas vérifier facilement
                    pathExists = null;
                    pathError = 'Chemin relatif, vérification impossible';
                }
            } catch (error) {
                pathExists = false;
                pathError = error.message;
            }
            
            return {
                success: true,
                config: config,
                pathExists: pathExists,
                pathError: pathError,
                ready: pathExists !== false && config.hasPassword
            };
            
        } catch (error) {
            console.error('❌ Erreur lors de la vérification de la configuration:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = EdiJobService;

