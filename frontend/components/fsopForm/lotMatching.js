export function normalizeFsopLotKey(s) {
    if (!s) return '';
    return String(s)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

export function matchLotByParenRef(refRaw, codeRubrique) {
    if (!refRaw || !codeRubrique) return false;
    const refNorm = normalizeFsopLotKey(refRaw);
    const rubNorm = normalizeFsopLotKey(codeRubrique);
    if (refNorm === rubNorm) return true;
    if (refNorm.length >= 6 && (rubNorm.includes(refNorm) || refNorm.includes(rubNorm))) return true;
    const refFlex = String(refRaw).replace(/[\s-]/g, '');
    const rubFlex = String(codeRubrique).replace(/[\s-]/g, '');
    return Boolean(refFlex && rubFlex && refFlex === rubFlex);
}

export function sourceMatchesComponent(source, hints, compText, currentCodeOperation) {
    const op = String(source?.codeOperation || '').trim().toUpperCase();
    const rub = String(source?.codeRubrique || '').trim();
    if (currentCodeOperation && op && op !== currentCodeOperation.toUpperCase()) return false;
    if (hints.length > 0) {
        for (const h of hints) {
            if (matchLotByParenRef(h.raw, rub)) return true;
        }
        // Hints present but no paren match: still try fuzzy on full composant text
    }
    const compNk = normalizeFsopLotKey(compText);
    const rubNk = normalizeFsopLotKey(rub);
    if (compNk && rubNk && (rubNk.includes(compNk) || compNk.includes(rubNk))) return true;
    // Code rubrique visible tel quel dans le libellé composant
    if (rub && String(compText || '').toUpperCase().includes(rub.toUpperCase())) return true;
    return false;
}

function compareLotStrings(a, b) {
    return String(a).localeCompare(String(b));
}

function addMatchingLots(sources, hints, compText, currentCodeOperation, allLots) {
    for (const source of sources) {
        if (!sourceMatchesComponent(source, hints, compText, currentCodeOperation)) continue;
        const lots = Array.isArray(source?.lots) ? source.lots : [];
        for (const l of lots) allLots.add(String(l || '').trim());
    }
}

function sortedLots(allLots) {
    return [...allLots].filter(Boolean).sort(compareLotStrings);
}

/**
 * Lots liés à l'article / référence composant uniquement (pas tous les lots du LT).
 * uniqueLotsFallback est ignoré : on ne propose un menu que si le matching article
 * trouve 1+ lots ; sinon la cellule reste en saisie libre.
 */
export function collectLotsForVoieCell(lines, items, _uniqueLotsFallback, hints, compText, currentCodeOperation) {
    const allLots = new Set();
    addMatchingLots(lines, hints, compText, currentCodeOperation, allLots);
    let lotsArray = sortedLots(allLots);
    if (lotsArray.length === 0) {
        addMatchingLots(items, hints, compText, '', allLots);
        lotsArray = sortedLots(allLots);
    }
    return lotsArray;
}

/**
 * Lots pour une cellule Lot simple (tableau Général).
 * Strictement associés à la référence composant ; si plusieurs lots pour cet article → choix.
 * Pas de fallback sur tous les lots du LT.
 */
export function collectLotsForLotCell(lines, items, _uniqueLotsFallback, hints, compText, currentCodeOperation) {
    let lots = collectLotsForVoieCell(lines, items, [], hints, compText, currentCodeOperation);
    if (lots.length === 0 && currentCodeOperation) {
        lots = collectLotsForVoieCell(lines, items, [], hints, compText, '');
    }
    return lots;
}

function valueAfterVoieLabel(line, label) {
    const lower = String(line || '').toLowerCase();
    const idx = lower.indexOf(label);
    if (idx === -1) return null;
    let rest = String(line).slice(idx + label.length);
    rest = rest.replace(/^[\t :]+/, '').split('\n')[0].trim();
    return rest || null;
}

export function parseSavedVoies(savedLot) {
    const savedVoies = {};
    if (!savedLot) return savedVoies;
    for (const line of savedLot.split('\n')) {
        const v940 = valueAfterVoieLabel(line, 'voie 940');
        const vLigne = valueAfterVoieLabel(line, 'voie ligne');
        const v1310 = valueAfterVoieLabel(line, 'voie 1310');
        if (v940) savedVoies['940'] = v940;
        if (vLigne) savedVoies['Ligne'] = vLigne;
        if (v1310) savedVoies['1310'] = v1310;
    }
    return savedVoies;
}
