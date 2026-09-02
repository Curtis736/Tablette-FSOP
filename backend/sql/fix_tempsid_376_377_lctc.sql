-- Correction TempsId 376 / 377 (15/07 et 22/07)
-- Cause: Phase='PRODUCTION' + CodeRubrique=code opérateur (absents de LCTC) => StatutTraitement='D'
-- Objectif: reprendre Phase/CodeRubrique depuis SEDI_ERP.dbo.LCTC pour LT2600135
--
-- Exécuter sur SERVEURERP, étape par étape.
-- Ne pas lancer le UPDATE sans avoir validé le SELECT de contrôle.

USE [SEDI_APP_INDEPENDANTE];
GO

PRINT '=== 1) État actuel des 2 lignes ===';
SELECT
    t.TempsId,
    t.DateCreation,
    t.LancementCode,
    t.Phase,
    t.CodeRubrique,
    t.OperatorCode,
    t.ProductiveDuration,
    t.StatutTraitement
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t
WHERE t.TempsId IN (376, 377);

PRINT '=== 2) Clés ERP disponibles dans LCTC pour LT2600135 ===';
SELECT
    C.CodeLancement,
    LTRIM(RTRIM(C.Phase)) AS Phase,
    LTRIM(RTRIM(C.CodeRubrique)) AS CodeRubrique,
    LTRIM(RTRIM(C.CodeOperation)) AS CodeOperation,
    C.TypeRubrique
FROM [SEDI_ERP].[dbo].[LCTC] C
WHERE C.CodeLancement = 'LT2600135'
  AND C.TypeRubrique = 'O'
ORDER BY C.Phase, C.CodeRubrique;

-- Si plusieurs étapes (010 Connect / 040 ...), choisir la bonne ligne ci-dessous.
-- D'après l'écran SILOG de Franck, le pattern attendu est Phase=010 + CodeRubrique type Connect/ConnectS.

DECLARE @Phase NVARCHAR(30);
DECLARE @CodeRubrique NVARCHAR(30);

-- Prendre la 1re étape TypeRubrique='O' (ajuster si besoin après le SELECT ci-dessus)
SELECT TOP 1
    @Phase = LTRIM(RTRIM(C.Phase)),
    @CodeRubrique = LTRIM(RTRIM(C.CodeRubrique))
FROM [SEDI_ERP].[dbo].[LCTC] C
WHERE C.CodeLancement = 'LT2600135'
  AND C.TypeRubrique = 'O'
  AND LTRIM(RTRIM(C.Phase)) <> ''
  AND LTRIM(RTRIM(C.CodeRubrique)) <> ''
  -- Préférer une vraie phase ERP (ex: 010), pas un marqueur
  AND UPPER(LTRIM(RTRIM(C.Phase))) NOT IN ('PRODUCTION', 'PAUSE', 'REPRISE', 'TERMINE', 'ADMIN')
ORDER BY C.Phase, C.CodeRubrique;

IF @Phase IS NULL OR @CodeRubrique IS NULL
BEGIN
    RAISERROR('Aucune clé LCTC valide trouvée pour LT2600135 — UPDATE annulé.', 16, 1);
    RETURN;
END

PRINT '=== 3) Clés qui seront appliquées ===';
PRINT 'Phase       = ' + @Phase;
PRINT 'CodeRubrique= ' + @CodeRubrique;

PRINT '=== 4) Contrôle cohérence EXISTS (doit renvoyer 1) ===';
SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM [SEDI_ERP].[dbo].[LCTC] AS LCTC
    WHERE LCTC.CodeLancement = 'LT2600135'
      AND LCTC.Phase = @Phase
      AND LCTC.CodeRubrique = @CodeRubrique
) THEN 1 ELSE 0 END AS LctcOk;

-- Décommenter uniquement après validation visuelle des étapes 1 à 4 :
/*
BEGIN TRAN;

UPDATE t
SET
    t.Phase = @Phase,
    t.CodeRubrique = @CodeRubrique,
    -- Remettre en attente de validation WEB (NULL) pour pouvoir repasser en O puis EDI
    t.StatutTraitement = NULL
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t
WHERE t.TempsId IN (376, 377)
  AND t.LancementCode = 'LT2600135'
  AND t.Phase = 'PRODUCTION';  -- garde-fou: ne toucher que les lignes encore incorrectes

SELECT
    t.TempsId,
    t.LancementCode,
    t.Phase,
    t.CodeRubrique,
    t.OperatorCode,
    t.StatutTraitement,
    CASE WHEN EXISTS (
        SELECT 1
        FROM [SEDI_ERP].[dbo].[LCTC] AS LCTC
        WHERE LCTC.CodeLancement = t.LancementCode
          AND LCTC.Phase = t.Phase
          AND LCTC.CodeRubrique = t.CodeRubrique
    ) THEN 1 ELSE 0 END AS LctcOk
FROM [SEDI_APP_INDEPENDANTE].[dbo].[ABTEMPS_OPERATEURS] t
WHERE t.TempsId IN (376, 377);

-- COMMIT;   -- si LctcOk = 1 sur les 2 lignes
-- ROLLBACK; -- sinon
*/
GO
