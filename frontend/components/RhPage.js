/**
 * Interface RH dédiée — hors Admin production.
 * Semaine (lun–jeu / vendredi) + banque mensuelle + corrections + export.
 */
class RhPage {
    constructor(app) {
        this.app = app;
        this.apiService = app.getApiService();
        this.notificationManager = app.getNotificationManager();
        this.weekStartInput = document.getElementById('rhWeekStart');
        this.monthInput = document.getElementById('rhMonthInput');
        this.operatorFilter = document.getElementById('rhOperatorFilter');
        this.operatorSearch = document.getElementById('rhOperatorSearch');
        this.refreshBtn = document.getElementById('rhRefreshBtn');
        this.prevWeekBtn = document.getElementById('rhPrevWeekBtn');
        this.nextWeekBtn = document.getElementById('rhNextWeekBtn');
        this.exportExcelBtn = document.getElementById('rhExportExcelBtn');
        this.exportPdfBtn = document.getElementById('rhExportPdfBtn');
        this.content = document.getElementById('rhContent');
        this.meta = document.getElementById('rhWeekMeta');
        this.bankSummary = document.getElementById('rhBankSummary');
        this.corrOperator = document.getElementById('rhCorrOperator');
        this.corrDate = document.getElementById('rhCorrDate');
        this.corrKind = document.getElementById('rhCorrKind');
        this.corrDelta = document.getElementById('rhCorrDelta');
        this.corrComment = document.getElementById('rhCorrComment');
        this.corrSaveBtn = document.getElementById('rhCorrSaveBtn');
        this.weekStart = this.getMondayOfWeek(new Date());
        this.yearMonth = String(this.weekStart).slice(0, 7);
        this.lastWeekData = null;
        this.lastMonthData = null;
        this.allOperatorOptions = [];
        this._searchTimer = null;

        if (this.weekStartInput) {
            this.weekStartInput.value = this.weekStart;
            this.weekStartInput.addEventListener('change', () => {
                this.weekStart = this.getMondayOfWeek(new Date(`${this.weekStartInput.value}T12:00:00`));
                this.weekStartInput.value = this.weekStart;
                this.yearMonth = String(this.weekStart).slice(0, 7);
                if (this.monthInput) this.monthInput.value = this.yearMonth;
                this.load();
            });
        }
        if (this.monthInput) {
            this.monthInput.value = this.yearMonth;
            this.monthInput.addEventListener('change', () => {
                this.yearMonth = String(this.monthInput.value || '').slice(0, 7) || this.yearMonth;
                this.loadMonth();
            });
        }
        if (this.refreshBtn) this.refreshBtn.addEventListener('click', () => this.load());
        if (this.prevWeekBtn) {
            this.prevWeekBtn.addEventListener('click', () => {
                this.weekStart = this.addDays(this.weekStart, -7);
                if (this.weekStartInput) this.weekStartInput.value = this.weekStart;
                this.yearMonth = String(this.weekStart).slice(0, 7);
                if (this.monthInput) this.monthInput.value = this.yearMonth;
                this.load();
            });
        }
        if (this.nextWeekBtn) {
            this.nextWeekBtn.addEventListener('click', () => {
                this.weekStart = this.addDays(this.weekStart, 7);
                if (this.weekStartInput) this.weekStartInput.value = this.weekStart;
                this.yearMonth = String(this.weekStart).slice(0, 7);
                if (this.monthInput) this.monthInput.value = this.yearMonth;
                this.load();
            });
        }
        if (this.operatorFilter) this.operatorFilter.addEventListener('change', () => {
            if (this.operatorSearch && this.operatorFilter.value) {
                // Si un opérateur précis est choisi, on vide la recherche texte
                this.operatorSearch.value = '';
            }
            this.load();
        });
        if (this.operatorSearch) {
            this.operatorSearch.addEventListener('input', () => {
                clearTimeout(this._searchTimer);
                this._searchTimer = setTimeout(() => this.applyOperatorSearch(), 180);
            });
            this.operatorSearch.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    clearTimeout(this._searchTimer);
                    this.applyOperatorSearch({ preferSelectFirst: true });
                }
            });
        }
        if (this.exportExcelBtn) this.exportExcelBtn.addEventListener('click', () => this.exportExcel());
        if (this.exportPdfBtn) this.exportPdfBtn.addEventListener('click', () => this.exportPdf());
        if (this.corrSaveBtn) this.corrSaveBtn.addEventListener('click', () => this.saveCorrection());
        if (this.corrDate) this.corrDate.value = this.toDateKey(new Date());
    }

    normalizeSearch(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    }

    operatorMatchesSearch(op, query) {
        if (!query) return true;
        const hay = this.normalizeSearch([
            op.operatorCode,
            op.code,
            op.nom,
            op.prenom,
            op.operatorName,
            op.fullName,
            op.label
        ].filter(Boolean).join(' '));
        return query.split(/\s+/).every((token) => hay.includes(token));
    }

    getSearchQuery() {
        return this.normalizeSearch(this.operatorSearch?.value || '');
    }

    applyOperatorSearch({ preferSelectFirst = false } = {}) {
        const query = this.getSearchQuery();
        const hadSingleFilter = Boolean(this.operatorFilter?.value);
        // Recherche écrite = filtre local ; on affiche tous puis on filtre
        if (this.operatorFilter && query && this.operatorFilter.value) {
            this.operatorFilter.value = '';
        }
        this.fillOperatorSelect(this.allOperatorOptions, query);
        if (preferSelectFirst && query && this.operatorFilter) {
            const firstReal = [...this.operatorFilter.options].find((o) => o.value);
            if (firstReal) {
                this.operatorFilter.value = firstReal.value;
                this.load();
                return;
            }
        }
        // Si on sortait d'un filtre mono-opérateur, recharger la liste complète
        if (hadSingleFilter && query) {
            this.load();
            return;
        }
        if (this.lastWeekData) {
            this.render(this.filterWeekData(this.lastWeekData, query));
        }
        if (this.lastMonthData) {
            this.renderBankSummary(this.filterMonthData(this.lastMonthData, query));
        }
        if (!this.lastWeekData) this.load();
    }

    filterWeekData(data, query = this.getSearchQuery()) {
        if (!query) return data;
        const operators = (data?.operators || []).filter((op) => this.operatorMatchesSearch(op, query));
        return { ...data, operators };
    }

    filterMonthData(data, query = this.getSearchQuery()) {
        if (!query) return data;
        const operators = (data?.operators || []).filter((op) => this.operatorMatchesSearch(op, query));
        return { ...data, operators };
    }

    getMondayOfWeek(refDate = new Date()) {
        const d = new Date(refDate);
        const day = d.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        return this.toDateKey(d);
    }

    addDays(dateKey, n) {
        const d = new Date(`${dateKey}T12:00:00`);
        d.setDate(d.getDate() + n);
        return this.toDateKey(d);
    }

    toDateKey(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    formatMinutes(mins) {
        const total = Math.round(Number(mins) || 0);
        const sign = total < 0 ? '-' : '';
        const abs = Math.abs(total);
        const h = Math.floor(abs / 60);
        const m = abs % 60;
        return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    weekdayLabel(dateStr) {
        try {
            return new Date(`${dateStr}T12:00:00`).toLocaleDateString('fr-FR', {
                weekday: 'short',
                day: '2-digit',
                month: '2-digit'
            });
        } catch {
            return dateStr;
        }
    }

    async load() {
        if (!this.content) return;
        if (this._loadInFlight) return;
        this._loadInFlight = true;

        const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
        const active = document.activeElement;
        const dayEl = active?.closest?.('.rh-day');
        const saveBtn = dayEl?.querySelector('.rh-day-save');
        const focusRestore = (active?.classList?.contains('rh-day-presence-input') && saveBtn)
            ? {
                op: saveBtn.dataset.op || '',
                date: saveBtn.dataset.date || '',
                value: active.value,
                start: active.selectionStart,
                end: active.selectionEnd
            }
            : null;

        // Premier chargement uniquement — jamais de collapse sur Actualiser / Enregistrer / filtres
        const hasUi = Boolean(this.content.querySelector('.rh-operator-card, .rh-empty, .rh-error'));
        if (!hasUi) {
            this.content.innerHTML = '<p class="rh-loading">Chargement des temps…</p>';
        }
        if (this.refreshBtn) this.refreshBtn.disabled = true;

        try {
            const query = this.getSearchQuery();
            const operatorCode = query ? '' : (this.operatorFilter?.value || '');
            const [weekRes, monthRes] = await Promise.all([
                this.apiService.getRhWeek(this.weekStart, operatorCode || null),
                this.apiService.getRhMonth(this.yearMonth, operatorCode || null)
            ]);
            this.lastWeekData = weekRes?.data || weekRes;
            this.lastMonthData = monthRes?.data || monthRes;
            this.render(this.filterWeekData(this.lastWeekData, query));
            this.renderBankSummary(this.filterMonthData(this.lastMonthData, query));
            await this.refreshOperatorOptions(this.lastWeekData);
            requestAnimationFrame(() => {
                window.scrollTo(0, scrollY);
                if (!focusRestore?.op || !focusRestore?.date) return;
                const btn = this.content.querySelector(
                    `.rh-day-save[data-op="${CSS.escape(focusRestore.op)}"][data-date="${CSS.escape(focusRestore.date)}"]`
                );
                const input = btn?.closest('.rh-day')?.querySelector('.rh-day-presence-input');
                if (!input) return;
                input.focus();
                // Garder la saisie en cours si l'utilisateur éditait encore
                if (focusRestore.value != null && focusRestore.value !== '') {
                    input.value = focusRestore.value;
                }
                try {
                    const len = String(input.value || '').length;
                    const start = Number.isFinite(focusRestore.start) ? focusRestore.start : len;
                    const end = Number.isFinite(focusRestore.end) ? focusRestore.end : len;
                    input.setSelectionRange(start, end);
                } catch (_) { /* ignore */ }
            });
        } catch (e) {
            console.error('RH load error:', e);
            if (!hasUi) {
                this.content.innerHTML = `<p class="rh-error">Impossible de charger les temps RH : ${this.escape(e.message || e)}</p>`;
            } else {
                this.notificationManager?.error?.(e.message || 'Impossible de charger les temps RH');
            }
        } finally {
            this._loadInFlight = false;
            if (this.refreshBtn) this.refreshBtn.disabled = false;
            this.content.classList.remove('rh-loading-soft');
        }
    }

    async loadMonth() {
        try {
            const query = this.getSearchQuery();
            const operatorCode = query ? '' : (this.operatorFilter?.value || '');
            const monthRes = await this.apiService.getRhMonth(this.yearMonth, operatorCode || null);
            this.lastMonthData = monthRes?.data || monthRes;
            this.renderBankSummary(this.filterMonthData(this.lastMonthData, query));
        } catch (e) {
            console.error('RH month error:', e);
            if (this.bankSummary) {
                this.bankSummary.innerHTML = `<p class="rh-error">Heures supp indisponibles : ${this.escape(e.message || e)}</p>`;
            }
        }
    }

    async refreshOperatorOptions(data) {
        if (!this.operatorFilter) return;
        const current = this.operatorFilter.value;
        let options = [];
        try {
            const list = await this.apiService.getRhOperators(this.weekStart);
            options = list?.data || list || [];
        } catch (_) {
            options = (data?.operators || []).map((o) => ({
                code: o.operatorCode,
                nom: o.nom,
                prenom: o.prenom,
                operatorName: o.operatorName,
                label: o.prenom
                    ? `${o.prenom} ${o.nom} (${o.operatorCode})`
                    : `${o.operatorName || o.operatorCode} (${o.operatorCode})`
            }));
        }
        this.allOperatorOptions = options.map((o) => ({
            code: o.code || o.OperatorCode || o.operatorCode,
            nom: o.nom,
            prenom: o.prenom,
            operatorName: o.operatorName || o.OperatorName,
            label: o.label
                || (o.prenom ? `${o.prenom} ${o.nom} (${o.code || o.OperatorCode || o.operatorCode})`
                    : `${o.nom || o.operatorName || o.code} (${o.code || o.OperatorCode || o.operatorCode})`)
        }));
        this.fillOperatorSelect(this.allOperatorOptions, this.getSearchQuery(), current);
    }

    fillOperatorSelect(options, query = '', current = '') {
        if (!this.operatorFilter) return;
        const selected = current || this.operatorFilter.value;
        const filtered = (options || []).filter((o) => this.operatorMatchesSearch({
            operatorCode: o.code,
            nom: o.nom,
            prenom: o.prenom,
            operatorName: o.operatorName,
            label: o.label
        }, query));
        const html = `<option value="">Tous les opérateurs</option>${
            filtered.map((o) => {
                const code = o.code;
                const label = o.label
                    || (o.prenom ? `${o.prenom} ${o.nom} (${code})` : `${o.nom || code} (${code})`);
                return `<option value="${this.escape(code)}"${code === selected ? ' selected' : ''}>${this.escape(label)}</option>`;
            }).join('')
        }`;
        this.operatorFilter.innerHTML = html;
        if (this.corrOperator) {
            const corrHtml = html.replace('Tous les opérateurs', 'Choisir un opérateur');
            // Évite de réécrire le select bas de page si identique (focus / scroll)
            if (this.corrOperator.innerHTML !== corrHtml) {
                const corrSelected = this.corrOperator.value;
                this.corrOperator.innerHTML = corrHtml;
                if (corrSelected) this.corrOperator.value = corrSelected;
            }
        }
        if (query && filtered.length === 0 && this.content && this.lastWeekData) {
            // message déjà géré par render si operators vide
        }
    }

    renderBankSummary(data) {
        if (!this.bankSummary) return;
        const ops = data?.operators || [];
        if (!ops.length) {
            const q = this.operatorSearch?.value?.trim();
            this.bankSummary.innerHTML = q
                ? `<p class="rh-empty">Aucune heure supp pour « ${this.escape(q)} » (${this.escape(data?.yearMonth || this.yearMonth)})</p>`
                : `<p class="rh-empty">Aucune heure supp pour ${this.escape(data?.yearMonth || this.yearMonth)}</p>`;
            return;
        }
        const cards = ops.map((op) => {
            const m = op.month || {};
            const name = op.prenom ? `${op.prenom} ${op.nom}` : (op.operatorName || op.operatorCode);
            const total = Number(m.bankTotalMinutes) || 0;
            const fri = Number(m.fridayHsMinutes) || 0;
            const surplus = Number(m.monThuSurplusMinutes) || 0;
            const manual = Number(m.bankManualMinutes) || 0;
            const deficit = Number(m.monThuDeficitMinutes) || 0;
            const friDeficit = Number(m.fridayDeficitMinutes) || 0;
            const detailParts = [];
            if (fri > 0) detailParts.push(`Vendredi ${this.formatMinutes(fri)}`);
            if (surplus > 0) detailParts.push(`Dépassement lun–jeu ${this.formatMinutes(surplus)}`);
            if (manual !== 0) {
                detailParts.push(`Ajustement ${manual > 0 ? '+' : ''}${this.formatMinutes(manual)}`);
            }
            if (!detailParts.length) {
                detailParts.push('Aucun dépassement ce mois');
            }
            return `
                <article class="rh-hs-card">
                    <header class="rh-hs-card-head">
                        <div>
                            <strong>${this.escape(name)}</strong>
                            <span class="rh-operator-code">${this.escape(op.operatorCode)}</span>
                        </div>
                        <div class="rh-hs-total">
                            <span class="rh-hs-total-label">Heures supp</span>
                            <span class="rh-hs-total-value">${this.formatMinutes(total)}</span>
                        </div>
                    </header>
                    <p class="rh-hs-detail"><b>Dont :</b> ${this.escape(detailParts.join(' · '))}</p>
                    ${deficit > 0
                        ? `<p class="rh-hs-deficit">Sous 8h45 lun–jeu (info) : ${this.formatMinutes(deficit)}</p>`
                        : ''}
                    ${friDeficit > 0
                        ? `<p class="rh-hs-deficit">Vendredi sous 5h (info, HS = temps fait quand même) : ${this.formatMinutes(friDeficit)}</p>`
                        : ''}
                </article>
            `;
        }).join('');
        this.bankSummary.innerHTML = `
            <h3>Heures supp — ${this.escape(data.yearMonth || this.yearMonth)}</h3>
            <div class="rh-hs-legend">
                <p><b>Comment on calcule</b></p>
                <ul>
                    <li><b>Vendredi</b> (fermeture 13h) → <b>tout</b> le temps fait = heures supp (même si &lt; 5h)</li>
                    <li><b>Lundi à jeudi</b> → seulement ce qui dépasse 8h45 (ex. 9h15 → 0h30 HS ; 7h → 0 HS)</li>
                    <li><b>Jour à 0</b> (aucun pointage / temps fait) → 0 HS, pas de déficit compté</li>
                    <li><b>Enregistrer</b> un temps fait = correction jour (recalculée vs pointages serveur)</li>
                </ul>
            </div>
            <div class="rh-hs-list">${cards}</div>
        `;
    }

    render(data) {
        const weekStart = data?.weekStart || this.weekStart;
        const weekEnd = data?.weekEnd || this.addDays(weekStart, 6);
        const fridayDate = data?.fridayDate || this.addDays(weekStart, 4);
        const monThuTarget = data?.rules?.monThuTargetMinutes ?? 525;
        const friTarget = data?.rules?.fridayTargetMinutes ?? 300;

        if (this.meta) {
            this.meta.innerHTML = `<strong>Semaine ${this.escape(weekStart)} → ${this.escape(weekEnd)}</strong>
                · Lun–jeu ${this.formatMinutes(monThuTarget)}/j
                · Vendredi tout en HS
                · <span class="rh-meta-tip">Éditez le « Temps fait » si besoin</span>`;
        }

        const operators = data?.operators || [];
        if (!operators.length) {
            const q = this.operatorSearch?.value?.trim();
            this.content.innerHTML = q
                ? `<p class="rh-empty">Aucun résultat pour « ${this.escape(q)} ».</p>`
                : '<p class="rh-empty">Aucun opérateur.</p>';
            return;
        }

        const tip = !this.operatorFilter?.value && !this.getSearchQuery()
            ? '<p class="rh-filter-tip">Astuce : tapez un <b>nom</b> dans Recherche, ou sélectionnez un opérateur dans la liste.</p>'
            : '';

        this.content.innerHTML = tip + operators.map((op) => this.renderOperatorCard(op, monThuTarget, friTarget, fridayDate)).join('');
        this.content.querySelectorAll('[data-validate-corr]').forEach((btn) => {
            btn.addEventListener('click', () => this.setCorrectionStatus(btn.dataset.validateCorr, 'VALIDATED'));
        });
        this.content.querySelectorAll('[data-reject-corr]').forEach((btn) => {
            btn.addEventListener('click', () => this.setCorrectionStatus(btn.dataset.rejectCorr, 'REJECTED'));
        });
        this.content.querySelectorAll('[data-save-day]').forEach((btn) => {
            btn.addEventListener('click', () => this.saveDayPresence(btn));
        });
        this.content.querySelectorAll('.rh-day-presence-input').forEach((input) => {
            input.addEventListener('input', () => this.onPresenceInputLive(input));
        });
    }

    /** Recalcule le badge HS à la saisie (avant Enregistrer). */
    onPresenceInputLive(input) {
        const dayEl = input?.closest?.('.rh-day');
        if (!dayEl) return;
        const target = Number(input.dataset.target || dayEl.dataset.target) || 525;
        const isFriday = input.dataset.isFriday === '1' || dayEl.classList.contains('rh-day-friday');
        const mins = this.hmInputToMinutes(input.value);
        if (!Number.isFinite(mins) || mins < 0) return;
        const hs = isFriday ? 0 : Math.max(0, mins - target);
        const wrap = dayEl.querySelector('.rh-stat-hs-wrap');
        const hsEl = dayEl.querySelector('.rh-stat-hs');
        if (hsEl) hsEl.textContent = this.formatMinutes(hs);
        if (wrap) wrap.hidden = hs <= 0;
    }

    minutesToHmInput(mins) {
        const total = Math.max(0, Math.round(Number(mins) || 0));
        const h = Math.floor(total / 60);
        const m = total % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    hmInputToMinutes(value) {
        const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '');
        if (!raw) return NaN;
        // HH:MM ou H:MM
        let m = /^(\d{1,3}):([0-5]\d)$/.exec(raw);
        if (m) return (Number(m[1]) * 60) + Number(m[2]);
        // 8h45 / 8h / 08h05
        m = /^(\d{1,3})h([0-5]\d)?$/.exec(raw);
        if (m) return (Number(m[1]) * 60) + (m[2] ? Number(m[2]) : 0);
        // 8.45 ou 8,45 (heures décimales approximatives → HH.MM style)
        m = /^(\d{1,3})[.,]([0-5]\d)$/.exec(raw);
        if (m) return (Number(m[1]) * 60) + Number(m[2]);
        // minutes pures
        const asNum = Number(raw);
        if (Number.isFinite(asNum) && asNum >= 0 && asNum <= 24 * 60) return Math.round(asNum);
        return NaN;
    }

    renderDaySchedule(day) {
        const lines = day?.schedule || [];
        if (!lines.length) {
            return `<div class="rh-day-schedule rh-day-schedule-empty">Aucun horaire pointé</div>`;
        }
        return `
            <div class="rh-day-schedule">
                <table class="rh-lines-table">
                    <thead>
                        <tr>
                            <th>Type</th>
                            <th>Début</th>
                            <th>Fin</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${lines.map((line) => {
                            const kind = String(line.kind || '').toLowerCase();
                            return `
                            <tr class="rh-line-row rh-line-${this.escape(kind)}">
                                <td>${this.escape(line.type || 'Présent')}</td>
                                <td>${this.escape(line.startTime || line.from || '—')}</td>
                                <td>${this.escape(line.endTime || line.to || '—')}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    /** Somme des lignes Présent du planning (minutes) — même base que le reste. */
    presenceFromSchedule(day) {
        const lines = day?.schedule || [];
        let total = 0;
        for (const line of lines) {
            const kind = String(line.kind || line.Kind || '').toUpperCase();
            const type = String(line.type || line.Type || '').toLowerCase();
            const isWork = kind === 'WORK' || type.startsWith('présent') || type.startsWith('present');
            if (!isWork) continue;
            const start = String(line.startTime || '').slice(0, 5);
            const end = String(line.endTime || '').slice(0, 5);
            const m = /^(\d{2}):(\d{2})$/;
            const a = m.exec(start);
            const b = m.exec(end);
            if (!a || !b) continue;
            const mins = (Number(b[1]) * 60 + Number(b[2])) - (Number(a[1]) * 60 + Number(a[2]));
            if (mins > 0) total += mins;
        }
        return total;
    }

    renderDayEditor(op, day, { isFriday = false } = {}) {
        if (!day?.date) return '';
        // Toujours afficher le calcul pointages (planning / raw), pas la cible 8h45
        const fromSchedule = this.presenceFromSchedule(day);
        const raw = day.rawPresenceMinutes != null
            ? Number(day.rawPresenceMinutes) || 0
            : (fromSchedule || (Number(day.presenceMinutes) || 0));
        const punched = fromSchedule > 0 ? fromSchedule : raw;
        const hasCorrection = Number(day.correctionMinutes) !== 0;
        // Sans correction : champ = pointages ; avec correction : temps RH validé
        const presence = hasCorrection
            ? (Number(day.presenceMinutes) || 0)
            : punched;
        const target = Number(day.targetMinutes) || (isFriday ? 300 : 525);
        const hs = isFriday ? 0 : (Number(day.bankCreditMinutes) || 0);
        return `
            <div class="rh-day${isFriday ? ' rh-day-friday' : ''}" data-target="${target}">
                <div class="rh-day-main">
                    <div class="rh-day-date">
                        <strong>${this.weekdayLabel(day.date)}</strong>
                        <small>${this.escape(day.date)}</small>
                    </div>
                    ${this.renderDaySchedule(day)}
                    <div class="rh-day-stats">
                        <span><em>Fait</em> <span class="rh-stat-fait">${this.formatMinutes(punched)}</span></span>
                        <span class="rh-stat-hs-wrap"${hs > 0 ? '' : ' hidden'}><em>HS</em> <span class="rh-stat-hs">${this.formatMinutes(hs)}</span></span>
                    </div>
                </div>
                <div class="rh-day-footer">
                    <div class="rh-day-edit">
                        <label for="rh-fait-${this.escape(op.operatorCode)}-${this.escape(day.date)}">Temps fait</label>
                        <input type="text"
                            id="rh-fait-${this.escape(op.operatorCode)}-${this.escape(day.date)}"
                            class="rh-day-presence-input"
                            value="${this.escape(this.minutesToHmInput(presence))}"
                            data-op="${this.escape(op.operatorCode)}"
                            data-date="${this.escape(day.date)}"
                            data-raw="${raw}"
                            data-target="${target}"
                            data-is-friday="${isFriday ? '1' : '0'}"
                            placeholder="HH:MM"
                            title="Calculé depuis les pointages Présent — modifiez seulement pour corriger"
                            autocomplete="off"
                            inputmode="numeric">
                        <button type="button" class="btn-success rh-day-save"
                            data-save-day="1"
                            data-op="${this.escape(op.operatorCode)}"
                            data-date="${this.escape(day.date)}"
                            data-raw="${raw}">Enregistrer</button>
                    </div>
                    ${hasCorrection
                        ? `<div class="rh-day-meta">Correction active : ${this.formatMinutes(presence)} (pointé ${this.formatMinutes(punched)})</div>`
                        : `<div class="rh-day-meta">Calculé depuis le planning (${this.formatMinutes(punched)}) — modifiez seulement pour corriger</div>`}
                </div>
            </div>
        `;
    }

    renderOperatorCard(op, monThuTarget, friTarget, fridayDate) {
        const monThu = op.monThu || { days: [], totals: {} };
        const friday = op.friday || { day: null, totals: {} };
        const weekBank = op.weekBank || {};
        const daysHtml = (monThu.days || []).map((day) => this.renderDayEditor(op, day)).join('')
            || '<p class="rh-empty-inline">Pas de jours lun–jeu</p>';

        const fri = friday.day || (fridayDate ? {
            date: fridayDate,
            presenceMinutes: 0,
            rawPresenceMinutes: 0,
            remainingMinutes: friTarget,
            bankCreditMinutes: 0,
            autreMinutes: 0,
            formationMinutes: 0
        } : null);
        const friHtml = fri
            ? this.renderDayEditor(op, fri, { isFriday: true })
            : `<p class="rh-empty-inline">Pas de pointage vendredi (${fridayDate || '—'})</p>`;

        const corrHtml = (op.corrections || []).length
            ? `<div class="rh-corr-list"><h5>Corrections semaine</h5>${
                op.corrections.map((c) => `
                    <div class="rh-corr-item">
                        <span>${this.escape(c.workDate)} · ${this.escape(c.kind)} · ${Number(c.deltaMinutes) > 0 ? '+' : ''}${this.formatMinutes(c.deltaMinutes)} · ${this.escape(c.status)}</span>
                        <span>${this.escape(c.comment || '')}</span>
                        ${c.status === 'PENDING' ? `
                            <button type="button" class="btn-primary" data-validate-corr="${c.id}">Valider</button>
                            <button type="button" class="btn-secondary" data-reject-corr="${c.id}">Rejeter</button>
                        ` : ''}
                    </div>
                `).join('')
            }</div>`
            : '';

        return `
            <article class="rh-operator-card">
                <header class="rh-operator-header">
                    <h3>${this.escape(op.prenom ? `${op.prenom} ${op.nom}` : (op.operatorName || op.operatorCode))}</h3>
                    <span class="rh-operator-code">${this.escape(op.operatorCode)}</span>
                </header>
                ${Number(weekBank.autoBankMinutes) > 0
                    ? `<div class="rh-week-bank">HS semaine ${this.formatMinutes(weekBank.autoBankMinutes)}</div>`
                    : ''}
                <div class="rh-blocks">
                    <section class="rh-block rh-block-mon-thu">
                        <h4>Lundi → Jeudi <small>${this.formatMinutes(monThuTarget)} / jour</small></h4>
                        <p class="rh-block-hint">Tapez le temps fait puis <b>Enregistrer</b>.</p>
                        <div class="rh-totals">
                            <span>Fait ${this.formatMinutes(monThu.totals?.presenceMinutes)}</span>
                            ${Number(monThu.totals?.bankCreditMinutes) > 0
                                ? `<span>HS ${this.formatMinutes(monThu.totals.bankCreditMinutes)}</span>`
                                : ''}
                        </div>
                        <div class="rh-days">${daysHtml}</div>
                    </section>
                    <section class="rh-block rh-block-friday">
                        <h4>Vendredi <small>tout en HS</small></h4>
                        <p class="rh-block-hint">Modifiez le temps fait puis <b>Enregistrer</b>.</p>
                        <div class="rh-totals">
                            <span>Fait ${this.formatMinutes(friday.totals?.presenceMinutes || fri?.presenceMinutes)}</span>
                        </div>
                        <div class="rh-days">${friHtml}</div>
                    </section>
                </div>
                ${corrHtml}
            </article>
        `;
    }

    async saveDayPresence(btn) {
        if (btn?.dataset?.busy === '1') return;
        try {
            btn.dataset.busy = '1';
            btn.disabled = true;
            const operatorCode = btn.dataset.op || '';
            const workDate = btn.dataset.date || '';
            const row = btn.closest('.rh-day');
            const input = row?.querySelector('.rh-day-presence-input');
            // data-raw = pointages ; fallback schedule si besoin
            let rawPresenceMinutes = Number(btn.dataset.raw || input?.dataset?.raw || 0);
            if (!Number.isFinite(rawPresenceMinutes) || rawPresenceMinutes < 0) rawPresenceMinutes = 0;
            const presenceMinutes = this.hmInputToMinutes(input?.value);
            if (!operatorCode || !workDate) {
                this.notificationManager?.error?.('Opérateur / date manquants');
                return;
            }
            if (!Number.isFinite(presenceMinutes) || presenceMinutes < 0) {
                this.notificationManager?.error?.('Temps invalide (ex. 08:45, 8h45, ou minutes)');
                return;
            }
            if (presenceMinutes > 24 * 60) {
                this.notificationManager?.error?.('Maximum 24h (1440 min)');
                return;
            }
            const res = await this.apiService.setRhDayPresence({
                operatorCode,
                workDate,
                presenceMinutes,
                rawPresenceMinutes,
                comment: `Édition jour ${workDate}`
            });
            const data = res?.data || res;
            const msg = res?.message
                || (data?.cleared
                    ? `Jour ${workDate} : retour aux pointages`
                    : `Jour ${workDate} → ${this.formatMinutes(data?.presenceMinutes)}`);
            this.notificationManager?.success?.(msg);
            await this.load();
        } catch (e) {
            this.notificationManager?.error?.(e.message || 'Erreur enregistrement jour');
        } finally {
            if (btn) {
                btn.dataset.busy = '0';
                btn.disabled = false;
            }
        }
    }

    async saveCorrection() {
        try {
            const operatorCode = this.corrOperator?.value || '';
            const workDate = this.corrDate?.value || '';
            const kind = this.corrKind?.value || 'DAY_PRESENCE';
            const deltaMinutes = Number(this.corrDelta?.value);
            const comment = this.corrComment?.value || '';
            if (!operatorCode || !workDate || !Number.isFinite(deltaMinutes) || deltaMinutes === 0) {
                this.notificationManager?.error?.('Opérateur, date et minutes (+/-) obligatoires');
                return;
            }
            await this.apiService.createRhCorrection({
                operatorCode,
                workDate,
                kind,
                deltaMinutes,
                comment,
                status: 'VALIDATED'
            });
            this.notificationManager?.success?.('Correction enregistrée');
            if (this.corrDelta) this.corrDelta.value = '';
            if (this.corrComment) this.corrComment.value = '';
            await this.load();
        } catch (e) {
            this.notificationManager?.error?.(e.message || 'Erreur correction');
        }
    }

    async setCorrectionStatus(id, status) {
        try {
            await this.apiService.setRhCorrectionStatus(id, status);
            this.notificationManager?.success?.(status === 'VALIDATED' ? 'Correction validée' : 'Correction rejetée');
            await this.load();
        } catch (e) {
            this.notificationManager?.error?.(e.message || 'Erreur statut');
        }
    }

    async exportExcel() {
        try {
            const operatorCode = this.operatorFilter?.value || '';
            await this.apiService.downloadRhExportExcel(this.yearMonth, operatorCode || null);
            this.notificationManager?.success?.('Export Excel téléchargé');
        } catch (e) {
            this.notificationManager?.error?.(e.message || 'Erreur export Excel');
        }
    }

    exportPdf() {
        const month = this.lastMonthData;
        if (!month) {
            this.notificationManager?.warning?.('Charge d’abord les données');
            return;
        }
        const rows = (month.operators || []).map((op) => {
            const m = op.month || {};
            const name = op.prenom ? `${op.prenom} ${op.nom}` : (op.operatorName || op.operatorCode);
            const fri = Number(m.fridayHsMinutes) || 0;
            const surplus = Number(m.monThuSurplusMinutes) || 0;
            const parts = [];
            if (fri > 0) parts.push(`Vendredi ${this.formatMinutes(fri)}`);
            if (surplus > 0) parts.push(`Lun–jeu ${this.formatMinutes(surplus)}`);
            return `<tr>
                <td>${this.escape(name)}</td>
                <td>${this.escape(op.operatorCode)}</td>
                <td><strong>${this.formatMinutes(m.bankTotalMinutes)}</strong></td>
                <td>${this.escape(parts.join(' · ') || '—')}</td>
            </tr>`;
        }).join('');

        const byDate = new Map();
        for (const op of month.operators || []) {
            const name = op.prenom ? `${op.prenom} ${op.nom}` : (op.operatorName || op.operatorCode);
            for (const day of op.month?.days || []) {
                const lines = Array.isArray(day.schedule) ? day.schedule : [];
                if (!lines.length && !((Number(day.presenceMinutes) || 0) > 0)) continue;
                if (!byDate.has(day.date)) byDate.set(day.date, []);
                byDate.get(day.date).push({ name, code: op.operatorCode, day, lines });
            }
        }
        const details = [...byDate.keys()].sort().map((date) => {
            const entries = byDate.get(date).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
            const body = entries.map(({ name, code, day, lines }) => {
                const rowsForOp = lines.length ? lines : [{ type: 'Correction RH' }];
                const hs = Number(day.bankCreditMinutes) || 0;
                return rowsForOp.map((line, i) => {
                    const type = line.type || line.label
                        || (String(line.kind || '').toUpperCase() === 'PAUSE' ? 'Pause' : 'Présent');
                    const start = String(line.startTime || line.from || '—').slice(0, 5);
                    const end = String(line.endTime || line.to || '—').slice(0, 5);
                    const first = i === 0;
                    return `<tr${first ? ' class="first"' : ''}>
                        <td>${first ? `${this.escape(name)} <small>${this.escape(code)}</small>` : ''}</td>
                        <td>${this.escape(type)}</td>
                        <td>${this.escape(start)}</td>
                        <td>${this.escape(end)}</td>
                        <td>${first ? this.formatMinutes(day.presenceMinutes) : ''}</td>
                        <td>${first && hs > 0 ? this.formatMinutes(hs) : ''}</td>
                    </tr>`;
                }).join('');
            }).join('');
            return `<section class="day">
                <h3>${this.escape(this.weekdayLabel(date))} <small>${this.escape(date)}</small></h3>
                <table><thead><tr><th>Opérateur</th><th>Type</th><th>Début</th><th>Fin</th><th>Fait</th><th>HS</th></tr></thead>
                <tbody>${body}</tbody></table>
            </section>`;
        }).join('');

        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>RH ${this.escape(month.yearMonth)}</title>
            <style>
                body{font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#111}
                h1{font-size:18px} h2{font-size:15px;margin-top:28px} h3{font-size:14px;margin:18px 0 8px}
                table{border-collapse:collapse;width:100%;margin-top:8px}
                th,td{border:1px solid #ccc;padding:5px 8px;font-size:12px;text-align:left}
                th{background:#f3f4f6}
                tr.first td{border-top:2px solid #94a3b8}
                .day{page-break-inside:avoid;margin-bottom:14px}
                small{color:#555;font-weight:600}
                @media print{button{display:none}}
            </style></head><body>
            <button onclick="window.print()">Imprimer / PDF</button>
            <h1>Heures supp RH — ${this.escape(month.yearMonth)}</h1>
            <p>Vendredi = tout le temps fait. Lun–jeu = seulement au-delà de 8h45.</p>
            <table><thead><tr><th>Opérateur</th><th>Code</th><th>Heures supp</th><th>Détail</th></tr></thead>
            <tbody>${rows}</tbody></table>
            <h2>Jour par jour</h2>
            ${details || '<p>Aucun horaire sur la période.</p>'}
            </body></html>`;
        const w = window.open('', '_blank');
        if (!w) {
            this.notificationManager?.error?.('Pop-up bloquée');
            return;
        }
        w.document.write(html);
        w.document.close();
    }

    escape(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

export default RhPage;
