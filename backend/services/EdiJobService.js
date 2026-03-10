/**
 * Service pour l'exécution de l'EDI_JOB de SILOG
 * Permet de déclencher la remontée des temps de production dans les tables standard de SILOG
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execAsync = promisify(exec);

class EdiJobService {
    static _psSingleQuote(value) {
        // Escape single quotes for PowerShell single-quoted strings: ' => ''
        return String(value ?? '').replace(/'/g, "''");
    }

    static _maskCommandForLogs(text) {
        const s = String(text || '');
        // Mask "-pXXXX" and "-p XXXX" styles (best-effort)
        return s
            .replace(/-p[^\s"]+/gi, '-p***')
            .replace(/-p\s+("[^"]+"|\S+)/gi, '-p ***');
    }

    static _buildConfig(codeTache, options = {}) {
        // Backward-compatible env var names + new explicit ones (recommended)
        const silogExe = process.env.SILOG_EXE_PATH || process.env.SILOG_PATH || options.silogPath || 'C:\\SILOG\\SILOG.exe';
        const workDir =
            process.env.SILOG_WORKDIR ||
            options.workingDirectory ||
            (() => {
                try { return path.dirname(silogExe); } catch (_) { return null; }
            })();

        const profil = process.env.SILOG_DB || process.env.SILOG_PROFIL || options.profil || 'SEDI_TESTS';
        const utilisateur = process.env.SILOG_USER || options.utilisateur || 'Production8';
        const motDePasse = process.env.SILOG_PASSWORD || options.motDePasse || '';
        const langue = process.env.SILOG_LANG || process.env.SILOG_LANGUE || options.langue || 'fr_fr';
        const mode = process.env.SILOG_MODE || options.mode || 'COMPACT';
        const entrypoint = process.env.SILOG_ENTRYPOINT || options.entrypoint || 'EDI_JOB';
        const codeTacheFinal =
            codeTache ||
            process.env.SILOG_TASK_CODE ||
            process.env.SILOG_CODE_TACHE ||
            process.env.SILOG_TASK ||
            'SEDI_ETDIFF';

        const timeoutMs = Number.parseInt(process.env.SILOG_TIMEOUT_MS || options.timeoutMs || '300000', 10) || 300000;
        const useStartProcess =
            String(process.env.SILOG_USE_START_PROCESS ?? options.useStartProcess ?? 'true').toLowerCase() !== 'false';

        return {
            silogExe,
            workDir,
            profil,
            utilisateur,
            motDePasse,
            langue,
            mode,
            entrypoint,
            codeTache: codeTacheFinal,
            timeoutMs,
            useStartProcess
        };
    }

    /**
     * Exécuter l'EDI_JOB de SILOG
     * @param {string} codeTache - Code de la tâche à exécuter
     * @param {Object} options - Options supplémentaires (profil, utilisateur, mot de passe, etc.)
     * @returns {Promise<Object>} Résultat de l'exécution
     */
    static async executeEdiJob(codeTache, options = {}) {
        try {
            const config = this._buildConfig(codeTache, options);

            // IMPORTANT: SILOG.exe ne peut pas être exécuté directement sur Linux.
            // Dans ce cas, on doit passer par un "runner" Windows (SSH/WinRM/etc).
            if (process.platform !== 'win32') {
                const remoteMode = String(process.env.SILOG_REMOTE_MODE || options.remoteMode || '').trim().toLowerCase();
                // Allow "scheduled"/"disabled": a Windows Scheduled Task runs EDI_JOB periodically on SERVEURERP.
                // In that case we don't trigger anything from Linux; we just avoid failing the admin flow.
                if (remoteMode === 'scheduled' || remoteMode === 'disable' || remoteMode === 'disabled' || remoteMode === 'none') {
                    return {
                        success: true,
                        skipped: true,
                        message:
                            `EDI_JOB non déclenché par le backend (SILOG_REMOTE_MODE=${remoteMode}). ` +
                            `Mode prévu: tâche planifiée Windows sur SERVEURERP.`,
                        codeTache: config.codeTache
                    };
                }
                if (remoteMode !== 'ssh') {
                    return {
                        success: false,
                        error: 'SILOG_UNSUPPORTED_PLATFORM',
                        details:
                            `Le backend tourne sur ${process.platform}. SILOG.exe nécessite Windows.\n` +
                            `Solutions:\n` +
                            `- Exécuter le backend sur une machine Windows qui voit \\\\SERVEURERP\\SILOG8\n` +
                            `- OU configurer un runner Windows et activer SILOG_REMOTE_MODE=ssh (voir docs/SILOG_EDI_JOB.md).\n` +
                            `- OU utiliser une tâche planifiée sur SERVEURERP et définir SILOG_REMOTE_MODE=scheduled.`,
                        codeTache: config.codeTache
                    };
                }
            }

            // Construire la liste d'arguments SILOG (alignée sur la commande PowerShell fournie par Franck)
            // Exemple:
            // SILOG.exe -bSEDI_TESTS -uProduction8 -p -dfr_fr -eEDI_JOB -optcodetache=SEDI_ETDIFF -mCOMPACT
            const passArg = config.motDePasse ? `-p${config.motDePasse}` : '-p';
            const silogArgs = [
                `-b${config.profil}`,
                `-u${config.utilisateur}`,
                passArg,
                `-d${config.langue}`,
                `-e${config.entrypoint}`,
                `-optcodetache=${config.codeTache}`,
                `-m${config.mode}`
            ];

            console.log(`🚀 Exécution SILOG EDI_JOB (codeTache=${config.codeTache})`);
            console.log(`📝 SILOG: ${this._maskCommandForLogs(`"${config.silogExe}" ${silogArgs.join(' ')}`)}`);

            let stdout = '';
            let stderr = '';
            let exitCode = null;

            const runCommand = async (command, execOptions) => {
                try {
                    const r = await execAsync(command, execOptions);
                    return { stdout: r.stdout || '', stderr: r.stderr || '', exitCode: 0 };
                } catch (e) {
                    // Timeout / killed => remonter à l'appelant (erreur réelle)
                    if (e && (e.code === 'ETIMEDOUT' || e.killed)) throw e;
                    // exec() rejette sur exitCode != 0. Dans ce cas, on capture stdout/stderr + code.
                    if (typeof e?.code === 'number') {
                        return {
                            stdout: e.stdout || '',
                            stderr: e.stderr || '',
                            exitCode: e.code
                        };
                    }
                    throw e;
                }
            };

            if (process.platform === 'win32' && config.useStartProcess) {
                // Utiliser Start-Process -Wait pour reproduire le comportement PowerShell (UNC + working directory)
                const filePath = this._psSingleQuote(config.silogExe);
                const workingDirectory = this._psSingleQuote(config.workDir || '');
                const argList = this._psSingleQuote(silogArgs.join(' '));

                const ps = [
                    "$ErrorActionPreference='Stop';",
                    `$p = Start-Process -FilePath '${filePath}' -ArgumentList '${argList}'${config.workDir ? ` -WorkingDirectory '${workingDirectory}'` : ''} -Wait -PassThru;`,
                    'exit $p.ExitCode;'
                ].join(' ');

                const command = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${ps}"`;
                console.log(`📝 PowerShell: ${this._maskCommandForLogs(command)}`);

                const r = await runCommand(command, {
                    timeout: config.timeoutMs,
                    maxBuffer: 10 * 1024 * 1024
                });
                stdout = r.stdout || '';
                stderr = r.stderr || '';
                exitCode = r.exitCode;
            } else if (process.platform !== 'win32') {
                // Runner distant (SSH) vers un hôte Windows qui exécutera PowerShell/Start-Process
                const sshHost = String(process.env.SILOG_SSH_HOST || options.sshHost || '').trim();
                const sshUser = String(process.env.SILOG_SSH_USER || options.sshUser || '').trim();
                const sshPort = String(process.env.SILOG_SSH_PORT || options.sshPort || '').trim();
                const sshKey = String(process.env.SILOG_SSH_KEY_PATH || options.sshKeyPath || '').trim();
                const sshExtra = String(process.env.SILOG_SSH_EXTRA_ARGS || options.sshExtraArgs || '').trim();

                if (!sshHost || !sshUser) {
                    return {
                        success: false,
                        error: 'SILOG_REMOTE_SSH_NOT_CONFIGURED',
                        details:
                            `SILOG_REMOTE_MODE=ssh est activé mais SILOG_SSH_HOST/SILOG_SSH_USER ne sont pas définis.\n` +
                            `Définir au minimum: SILOG_SSH_HOST, SILOG_SSH_USER (et optionnellement SILOG_SSH_KEY_PATH, SILOG_SSH_PORT).`,
                        codeTache: config.codeTache
                    };
                }

                const filePath = this._psSingleQuote(config.silogExe);
                const workingDirectory = this._psSingleQuote(config.workDir || '');
                const argList = this._psSingleQuote(silogArgs.join(' '));
                const ps = [
                    "$ErrorActionPreference='Stop';",
                    `$p = Start-Process -FilePath '${filePath}' -ArgumentList '${argList}'${config.workDir ? ` -WorkingDirectory '${workingDirectory}'` : ''} -Wait -PassThru;`,
                    'exit $p.ExitCode;'
                ].join(' ');

                // Commande PowerShell à exécuter sur Windows
                const remotePs = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${ps}"`;
                // Construire commande SSH (BatchMode pour ne pas bloquer)
                const parts = [
                    'ssh',
                    '-o', 'BatchMode=yes',
                    ...(sshPort ? ['-p', sshPort] : []),
                    ...(sshKey ? ['-i', `"${sshKey}"`] : []),
                    ...(sshExtra ? [sshExtra] : []),
                    `${sshUser}@${sshHost}`,
                    `"${remotePs.replace(/"/g, '\\"')}"`
                ];
                const sshCommand = parts.join(' ');
                console.log(`📝 SSH: ${this._maskCommandForLogs(sshCommand)}`);

                const r = await runCommand(sshCommand, {
                    timeout: config.timeoutMs,
                    maxBuffer: 10 * 1024 * 1024
                });
                stdout = r.stdout || '';
                stderr = r.stderr || '';
                exitCode = r.exitCode;
            } else {
                // Fallback: exécution directe (peut suffire en environnement non-Windows ou si Start-Process est désactivé)
                const directCmd = `"${config.silogExe}" ${silogArgs.join(' ')}`;
                const r = await runCommand(directCmd, {
                    timeout: config.timeoutMs,
                    maxBuffer: 10 * 1024 * 1024,
                    cwd: config.workDir || undefined
                });
                stdout = r.stdout || '';
                stderr = r.stderr || '';
                exitCode = r.exitCode;
            }
            
            // Analyser le résultat
            const warnings = !!(stderr && String(stderr).trim().length > 0);
            const success = exitCode === 0;
            
            if (success) {
                console.log(`✅ EDI_JOB exécuté avec succès pour codeTache=${config.codeTache} (exitCode=0)`);
                return {
                    success: true,
                    message: warnings ? 'EDI_JOB exécuté avec des avertissements' : 'EDI_JOB exécuté avec succès',
                    codeTache: config.codeTache,
                    stdout: stdout,
                    stderr: warnings ? stderr : null,
                    warnings: warnings || undefined,
                    exitCode: exitCode
                };
            }

            console.warn(`❌ EDI_JOB en échec pour codeTache=${config.codeTache} (exitCode=${exitCode})`);
            return {
                success: false,
                error: 'EDI_JOB_FAILED',
                message: `EDI_JOB a échoué (exitCode=${exitCode})`,
                codeTache: config.codeTache,
                stdout,
                stderr: stderr || null,
                exitCode
            };
            
        } catch (error) {
            console.error(`❌ Erreur lors de l'exécution de l'EDI_JOB:`, error);
            
            // Analyser le type d'erreur
            let errorMessage = 'Erreur lors de l\'exécution de l\'EDI_JOB';
            let errorDetails = null;
            
            if (error.code === 'ENOENT') {
                errorMessage = 'Fichier SILOG.exe non trouvé. Vérifiez le chemin de configuration.';
                errorDetails = `Chemin attendu: ${process.env.SILOG_EXE_PATH || process.env.SILOG_PATH || 'C:\\SILOG\\SILOG.exe'}`;
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
                codeTache: codeTache || null,
                exitCode: typeof error?.code === 'number' ? error.code : null
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
            // NOTE:
            // Dans SILOG, optcodetache = "code tâche" d'intégration (ex: SEDI_ETDIFF) et est fixe.
            // Si aucun codeTache n'est fourni, utiliser la valeur de configuration/env.
            const resolved = this._buildConfig(codeTache, {});
            codeTache = resolved.codeTache;
            
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
                silogExe: process.env.SILOG_EXE_PATH || process.env.SILOG_PATH || 'C:\\SILOG\\SILOG.exe',
                workingDirectory: process.env.SILOG_WORKDIR || null,
                profil: process.env.SILOG_DB || process.env.SILOG_PROFIL || 'SEDI_TESTS',
                utilisateur: process.env.SILOG_USER || 'Production8',
                langue: process.env.SILOG_LANG || process.env.SILOG_LANGUE || 'fr_fr',
                codeTache: process.env.SILOG_TASK_CODE || process.env.SILOG_CODE_TACHE || process.env.SILOG_TASK || 'SEDI_ETDIFF',
                mode: process.env.SILOG_MODE || 'COMPACT',
                entrypoint: process.env.SILOG_ENTRYPOINT || 'EDI_JOB',
                hasPassword: !!(process.env.SILOG_PASSWORD || '')
            };

            const remoteMode = String(process.env.SILOG_REMOTE_MODE || '').trim().toLowerCase();
            const sshConfigured = !!(process.env.SILOG_SSH_HOST && process.env.SILOG_SSH_USER);
            
            // Vérifier si le fichier existe (si le chemin est absolu)
            const fs = require('fs');
            let pathExists = false;
            let pathError = null;
            
            try {
                if (path.isAbsolute(config.silogExe)) {
                    pathExists = fs.existsSync(config.silogExe);
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
                // Password peut être vide (Franck utilise "-p" sans valeur).
                ready:
                    (process.platform === 'win32'
                        ? (pathExists !== false && !!config.profil && !!config.utilisateur && !!config.codeTache)
                        : (remoteMode === 'ssh' && sshConfigured && !!config.profil && !!config.utilisateur && !!config.codeTache)),
                platform: process.platform,
                remoteMode,
                sshConfigured
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

