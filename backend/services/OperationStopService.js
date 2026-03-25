const { executeInTransaction } = require('../config/database');
const ConsolidationService = require('./ConsolidationService');

class OperationStopService {
    static async stopOperation({ operatorId, lancementCode, phase, codeRubrique, currentTime, currentDate }) {
        const maxAttempts = 3;
        const delayMs = 400;
        let lastConsolidation = null;
        let alreadyFinished = false;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                lastConsolidation = await executeInTransaction(async (tx) => {
                    const lastEventRows = await tx.executeQuery(
                        `
                        SELECT TOP 1 Ident, Statut
                        FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                        WHERE CodeLanctImprod = @lancementCode
                          AND OperatorCode = @operatorId
                          AND Phase = @phase
                          AND CodeRubrique = @codeRubrique
                        ORDER BY DateCreation DESC, NoEnreg DESC
                        `,
                        { operatorId, lancementCode, phase, codeRubrique }
                    );
                    const last = lastEventRows?.[0] || null;
                    const lastIdent = String(last?.Ident || '').toUpperCase();
                    const lastStatut = String(last?.Statut || '').toUpperCase();
                    if (lastIdent === 'FIN' || lastStatut === 'TERMINE' || lastStatut === 'TERMINÉ') {
                        alreadyFinished = true;
                        return { skipped: true, reason: 'already_finished' };
                    }

                    await tx.executeNonQuery(
                        `
                        INSERT INTO [SEDI_APP_INDEPENDANTE].[dbo].[ABHISTORIQUE_OPERATEURS]
                        (OperatorCode, CodeLanctImprod, CodeRubrique, Ident, Phase, Statut, HeureDebut, HeureFin, DateCreation)
                        VALUES (
                            @operatorId,
                            @lancementCode,
                            @codeRubrique,
                            'FIN',
                            @phase,
                            'TERMINE',
                            NULL,
                            CAST(@currentTime AS TIME),
                            CAST(@currentDate AS DATE)
                        )
                        `,
                        { operatorId, lancementCode, codeRubrique, phase, currentTime, currentDate }
                    );

                    const consolidationResult = await ConsolidationService.consolidateOperation(operatorId, lancementCode, {
                        autoFix: true,
                        phase,
                        codeRubrique,
                        db: tx
                    });

                    if (consolidationResult?.skipped) {
                        // Ne pas considérer "skipped" comme une erreur côté arrêt d'opération.
                        // Exemple normal: lancement absent de V_LCTC => VLCTC_MISSING.
                        return { ...consolidationResult, success: true };
                    }
                    if (!consolidationResult?.success) {
                        const msg = consolidationResult?.error || consolidationResult?.message || 'Consolidation échouée';
                        throw new Error(msg);
                    }
                    return consolidationResult;
                });
                break;
            } catch (error) {
                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                    continue;
                }
                throw error;
            }
        }

        return { consolidation: lastConsolidation, alreadyFinished };
    }
}

module.exports = OperationStopService;
