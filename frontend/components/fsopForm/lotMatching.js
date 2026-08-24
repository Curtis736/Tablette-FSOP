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
    if (currentCodeOperation && op !== currentCodeOperation.toUpperCase()) return false;
    if (hints.length > 0) {
        for (const h of hints) {
            if (matchLotByParenRef(h.raw, rub)) return true;
        }
        return false;
    }
    const compNk = normalizeFsopLotKey(compText);
    const rubNk = normalizeFsopLotKey(rub);
    return Boolean(compNk && rubNk && (rubNk.includes(compNk) || compNk.includes(rubNk)));
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

export function collectLotsForVoieCell(lines, items, uniqueLotsFallback, hints, compText, currentCodeOperation) {
    const allLots = new Set();
    addMatchingLots(lines, hints, compText, currentCodeOperation, allLots);
    let lotsArray = sortedLots(allLots);
    if (lotsArray.length === 0) {
        addMatchingLots(items, hints, compText, '', allLots);
        lotsArray = sortedLots(allLots);
    }
    if (lotsArray.length === 0) {
        return uniqueLotsFallback;
    }
    return lotsArray;
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
