/**
 * Temps restant théorique d'un lancement (LCTC × qty − ETEMPS − pending ABTEMPS).
 *
 * TheoH     = TempsReglage + TempsPoste * QuantiteLancee
 * ConsommeH = SUM(ETEMPS.Duree*) + SUM(ABTEMPS.ProductiveDuration/60) où Statut NOT IN ('T','D')
 * RestantH  = TheoH - ConsommeH
 */

const { executeQuery } = require('../config/database');

function round3(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.round(x * 1000) / 1000;
}

function buildStepPayload(row) {
    const tempsPosteH = round3(row.TempsPoste);
    const tempsReglageH = round3(row.TempsReglage);
    const quantiteLancee = round3(row.QuantiteLancee);
    const theoH = round3(tempsReglageH + tempsPosteH * quantiteLancee);
    const scanneSilogH = round3(row.ScanneSilogH);
    const pendingAppH = round3(row.PendingAppH);
    const consommeH = round3(scanneSilogH + pendingAppH);
    const restantH = round3(theoH - consommeH);
    const restantMinutes = Math.round(restantH * 60);
    const avancementPct = theoH > 0
        ? Math.round((consommeH / theoH) * 1000) / 10
        : null;

    const phase = String(row.Phase || '').trim();
    const codeRubrique = String(row.CodeRubrique || '').trim();
    const codeOperation = String(row.CodeOperation || '').trim();

    return {
        stepId: `${phase}|${codeRubrique}`,
        phase,
        codeRubrique,
        codeOperation,
        unite: String(row.UniteTxAffectation || '').trim() || null,
        tempsPosteH,
        tempsReglageH,
        quantiteLancee,
        theoH,
        scanneSilogH,
        pendingAppH,
        consommeH,
        restantH,
        restantMinutes,
        avancementPct
    };
}

class LancementTempsRestantService {
    /**
     * @param {string} lancementCode
     * @returns {Promise<{ lancementCode: string, quantiteLancee: number, etapes: object[], byStepId: Record<string, object>, total: object } | null>}
     */
    static async getTempsRestant(lancementCode) {
        const code = String(lancementCode || '').trim().toUpperCase();
        if (!code) return null;

        const rows = await executeQuery(`
            SELECT
                LTRIM(RTRIM(C.Phase)) AS Phase,
                LTRIM(RTRIM(C.CodeRubrique)) AS CodeRubrique,
                LTRIM(RTRIM(ISNULL(C.CodeOperation, ''))) AS CodeOperation,
                LTRIM(RTRIM(ISNULL(C.UniteTxAffectation, ''))) AS UniteTxAffectation,
                CAST(ISNULL(C.TempsPoste, 0) AS FLOAT) AS TempsPoste,
                CAST(ISNULL(C.TempsReglage, 0) AS FLOAT) AS TempsReglage,
                CAST(ISNULL(E.QuantiteLancee, 0) AS FLOAT) AS QuantiteLancee,
                CAST(ISNULL(S.ScanneSilogH, 0) AS FLOAT) AS ScanneSilogH,
                CAST(ISNULL(P.PendingAppH, 0) AS FLOAT) AS PendingAppH
            FROM [SEDI_ERP].[dbo].[LCTC] C
            INNER JOIN [SEDI_ERP].[dbo].[LCTE] E
                ON E.CodeLancement = C.CodeLancement
            OUTER APPLY (
                SELECT
                    SUM(
                        ISNULL(T.DureeExecution, 0)
                        + ISNULL(T.DureeReglage, 0)
                        + ISNULL(T.DureeCalage, 0)
                    ) AS ScanneSilogH
                FROM [SEDI_ERP].[dbo].[ETEMPS] T
                WHERE T.CodeLanctimprod = C.CodeLancement
                  AND LTRIM(RTRIM(T.Phase)) = LTRIM(RTRIM(C.Phase))
                  AND LTRIM(RTRIM(T.CodePoste)) = LTRIM(RTRIM(C.CodeRubrique))
            ) S
            OUTER APPLY (
                SELECT
                    SUM(CAST(ISNULL(A.ProductiveDuration, 0) AS FLOAT) / 60.0) AS PendingAppH
                FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] A
                WHERE A.LancementCode = C.CodeLancement
                  AND LTRIM(RTRIM(ISNULL(A.Phase, ''))) = LTRIM(RTRIM(C.Phase))
                  AND LTRIM(RTRIM(ISNULL(A.CodeRubrique, ''))) = LTRIM(RTRIM(C.CodeRubrique))
                  AND (
                        A.StatutTraitement IS NULL
                     OR LTRIM(RTRIM(A.StatutTraitement)) NOT IN ('T', 'D')
                  )
            ) P
            WHERE C.CodeLancement = @lancementCode
              AND C.TypeRubrique = 'O'
            ORDER BY LTRIM(RTRIM(C.Phase)), LTRIM(RTRIM(C.CodeRubrique))
        `, { lancementCode: code });

        if (!rows || rows.length === 0) {
            return null;
        }

        const etapes = rows.map(buildStepPayload);
        const byStepId = {};
        for (const step of etapes) {
            byStepId[step.stepId] = step;
        }

        const quantiteLancee = etapes[0]?.quantiteLancee ?? 0;
        const sum = (key) => round3(etapes.reduce((acc, s) => acc + (Number(s[key]) || 0), 0));

        const theoH = sum('theoH');
        const scanneSilogH = sum('scanneSilogH');
        const pendingAppH = sum('pendingAppH');
        const consommeH = round3(scanneSilogH + pendingAppH);
        const restantH = round3(theoH - consommeH);

        return {
            lancementCode: code,
            quantiteLancee,
            etapes,
            byStepId,
            total: {
                theoH,
                scanneSilogH,
                pendingAppH,
                consommeH,
                restantH,
                restantMinutes: Math.round(restantH * 60),
                avancementPct: theoH > 0
                    ? Math.round((consommeH / theoH) * 1000) / 10
                    : null
            }
        };
    }
}

module.exports = LancementTempsRestantService;
