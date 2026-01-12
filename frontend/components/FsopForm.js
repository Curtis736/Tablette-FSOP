/**
 * Composant pour afficher et remplir un formulaire FSOP de manière interactive
 */
class FsopForm {
    constructor(apiService, notificationManager) {
        this.apiService = apiService;
        this.notificationManager = notificationManager;
        this.formData = {
            placeholders: {},
            tables: {},
            passFail: {},
            checkboxes: {},
            reference: '',
            taggedMeasures: {}
        };
        this.structure = null;
        this.container = null;
    }

    /**
     * Initialise le formulaire avec la structure du template
     */
    async loadStructure(templateCode) {
        try {
            const response = await this.apiService.get(`/fsop/template/${templateCode}/structure`);
            // The API returns the structure directly, not wrapped in a 'structure' property
            this.structure = response.structure || response;
            
            // Debug: log structure
            console.log('📋 Structure chargée:', {
                sections: this.structure.sections?.length || 0,
                tables: this.structure.sections?.filter(s => s.table).length || 0,
                passFail: this.structure.sections?.filter(s => s.type === 'pass_fail').length || 0,
                headerFields: this.structure.headerFields?.length || 0
            });
            
            if (this.structure.sections) {
                console.log('📑 Détail des sections:');
                this.structure.sections.forEach(section => {
                    console.log(`  - Section ${section.id}: "${section.title || 'SANS TITRE'}" (type: ${section.type}, fields: ${section.fields?.length || 0}, table: ${section.table ? 'Oui' : 'Non'})`);
                });
            } else {
                console.error('❌ Aucune section trouvée dans la structure!');
            }
            
            return this.structure;
        } catch (error) {
            console.error('Erreur lors du chargement de la structure:', error);
            this.notificationManager.error('Impossible de charger la structure du formulaire');
            throw error;
        }
    }

    /**
     * Génère le HTML du formulaire depuis la structure
     */
    render(container, initialData = {}) {
        if (!this.structure) {
            throw new Error('Structure non chargée. Appelez loadStructure() d\'abord.');
        }

        this.container = container;
        this.formData = {
            placeholders: { ...initialData.placeholders },
            tables: { ...initialData.tables },
            passFail: { ...initialData.passFail },
            checkboxes: { ...initialData.checkboxes },
            textFields: { ...initialData.textFields },
            reference: initialData.reference || this.structure.reference?.value || this.structure.reference?.placeholder || '',
            taggedMeasures: { ...initialData.taggedMeasures }
        };

        // Word-like rendering: preserve exact order (paragraphs/tables/page breaks)
        if (Array.isArray(this.structure.blocks) && this.structure.blocks.length > 0) {
            container.innerHTML = this.renderWordLike(this.structure.blocks);
            this.attachEventListeners();
            return;
        }

        let html = '<div class="fsop-form-container">';
        
        // Render header with logo, title, and fields (like in the Word document)
        html += '<div class="fsop-header-section">';
        
        // Header top row: Logo, Title, N° cordon
        html += '<div class="fsop-header-top">';
        
        // Logo (left)
        html += '<div class="fsop-header-logo">';
        html += '<div class="fsop-logo-text">SEDI<span class="fsop-logo-dot">•</span>ATI</div>';
        html += '<div class="fsop-logo-subtitle">by Fiber Optics Group</div>';
        html += '</div>';
        
        // Title (center)
        const documentTitle = this.structure.documentTitle || this.structure.metadata?.source?.replace(/\.docx$/i, '') || 'Formulaire FSOP';
        html += `<div class="fsop-header-title">${this.escapeHtml(documentTitle)}</div>`;
        
        // N° cordon field (right) - separate from other header fields
        const cordonField = this.structure.headerFields?.find(f => f.key === 'NUMERO_CORDON');
        if (cordonField) {
            const cordonValue = this.formData.placeholders[cordonField.placeholder] || 
                               this.formData.placeholders[cordonField.key] || 
                               initialData.placeholders?.[cordonField.placeholder] || 
                               initialData.placeholders?.[cordonField.key] || '';
            html += `
                <div class="fsop-header-cordon">
                    <label for="header_${cordonField.key}">${this.escapeHtml(cordonField.label)}</label>
                    <input 
                        type="text" 
                        id="header_${cordonField.key}" 
                        data-placeholder="${cordonField.placeholder || cordonField.key}"
                        value="${this.escapeHtml(cordonValue)}"
                        class="fsop-input fsop-header-input fsop-cordon-input"
                    />
                </div>
            `;
        }
        
        html += '</div>'; // End header-top
        
        // Header bottom: Numéro lancement and Référence SILOG in a box
        const otherHeaderFields = this.structure.headerFields?.filter(f => f.key !== 'NUMERO_CORDON') || [];
        if (otherHeaderFields.length > 0) {
            html += '<div class="fsop-header-box">';
            
            otherHeaderFields.forEach(field => {
                const fieldKey = field.placeholder || field.key;
                const value = this.formData.placeholders[field.placeholder] || 
                             this.formData.placeholders[fieldKey] || 
                             initialData.placeholders?.[field.placeholder] || 
                             initialData.placeholders?.[fieldKey] || '';
                
                html += `
                    <div class="fsop-header-box-field">
                        <label for="header_${field.key}">${this.escapeHtml(field.label)}</label>
                        <input 
                            type="text" 
                            id="header_${field.key}" 
                            data-placeholder="${field.placeholder || field.key}"
                            value="${this.escapeHtml(value)}"
                            class="fsop-input fsop-header-box-input"
                        />
                    </div>
                `;
            });
            
            html += '</div>'; // End header-box
        }
        
        // Add reference field for Excel transfer
        html += '<div class="fsop-reference-section">';
        html += '<label for="fsop_reference">Référence (pour transfert Excel):</label>';
        html += `<input 
            type="text" 
            id="fsop_reference" 
            class="fsop-input fsop-reference-input"
            placeholder="Ex: RETA-697-HOI-23.199"
            value="${this.escapeHtml(this.formData.reference)}"
        />`;
        html += '<small class="fsop-reference-hint">Cette référence sera utilisée pour trouver le fichier Excel de mesures</small>';
        html += '</div>';
        
        html += '</div>'; // End header-section
        
        // Render placeholders (if any remain after header fields)
        if (this.structure.placeholders && this.structure.placeholders.length > 0) {
            const headerPlaceholders = this.structure.headerFields?.map(f => f.placeholder).filter(Boolean) || [];
            const remainingPlaceholders = this.structure.placeholders.filter(p => !headerPlaceholders.includes(p));
            
            if (remainingPlaceholders.length > 0) {
                html += '<div class="fsop-section fsop-placeholders">';
                html += '<h3><i class="fas fa-tag"></i> Informations générales</h3>';
                
                remainingPlaceholders.forEach(placeholder => {
                    const tag = placeholder.replace(/[{}]/g, '');
                    const label = this.getPlaceholderLabel(tag);
                    const value = this.formData.placeholders[placeholder] || '';
                    
                    html += `
                        <div class="fsop-field">
                            <label for="placeholder_${tag}">${label}</label>
                            <input 
                                type="text" 
                                id="placeholder_${tag}" 
                                data-placeholder="${placeholder}"
                                value="${this.escapeHtml(value)}"
                                class="fsop-input"
                            />
                        </div>
                    `;
                });
                
                html += '</div>';
            }
        }

        // Render sections
        if (this.structure.sections && this.structure.sections.length > 0) {
            this.structure.sections.forEach(section => {
                html += this.renderSection(section);
            });
        }

        html += '</div>';

        container.innerHTML = html;

        // Attach event listeners
        this.attachEventListeners();
    }

    renderWordLike(blocks) {
        // Render in "single page" mode by default: keep A4 width, but don't split by page breaks.
        // This matches the user's request to keep everything on the same page.
        let html = '<div class="fsop-word-doc"><div class="fsop-page fsop-page-single">';

        let blankId = 0;

        const renderTextWithInputs = (text) => {
            if (!text) return '';
            // Replace placeholders like {{LT}} with inputs bound to formData.placeholders
            let out = this.escapeHtml(text);
            out = out.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_m, tag) => {
                const placeholder = `{{${tag}}}`;
                const val = this.formData.placeholders?.[placeholder] || '';
                return `<input class="fsop-inline-input" type="text" data-placeholder="${placeholder}" value="${this.escapeHtml(val)}" />`;
            });
            return out;
        };

        const renderPassFailLine = (text) => {
            // Pattern: "Mesure X : PASS FAIL" -> label + radios
            const m = text.match(/^(.+?):\s*PASS\s*FAIL\s*$/i);
            if (!m) return null;
            const label = m[1].trim();
            const key = label; // used by backend injection regex (field: PASS/FAIL)
            const current = this.formData.passFail?.wordlike?.[key] || '';
            return `
                <div class="fsop-word-passfail">
                    <span class="fsop-word-passfail-label">${this.escapeHtml(label)} :</span>
                    <label class="fsop-word-passfail-opt ${current === 'PASS' ? 'active' : ''}">
                        <input type="radio" name="pf_${this.escapeHtml(key)}" value="PASS" data-passfail-key="${this.escapeHtml(key)}" ${current === 'PASS' ? 'checked' : ''}/>
                        PASS
                    </label>
                    <label class="fsop-word-passfail-opt ${current === 'FAIL' ? 'active' : ''}">
                        <input type="radio" name="pf_${this.escapeHtml(key)}" value="FAIL" data-passfail-key="${this.escapeHtml(key)}" ${current === 'FAIL' ? 'checked' : ''}/>
                        FAIL
                    </label>
                </div>
            `;
        };

        const renderCheckboxLine = (text) => {
            // Pattern: "☐ Label" or "[ ] Label"
            const m = text.match(/^([☐☑✓□]|\[[\sx]\])\s+(.+)$/i);
            if (!m) return null;
            const sym = m[1];
            const label = m[2].trim();
            const checked = /[☑✓x]/i.test(sym);
            const id = `cb_${++blankId}`;
            return `
                <label class="fsop-word-checkbox">
                    <input id="${id}" type="checkbox" data-checkbox-label="${this.escapeHtml(label)}" ${checked ? 'checked' : ''} />
                    <span class="fsop-word-checkbox-label">${this.escapeHtml(label)}</span>
                </label>
            `;
        };

        const renderTable = (rows, tableBlockId) => {
            const safeRows = rows || [];
            if (safeRows.length === 0) {
                return '<table class="fsop-word-table"></table>';
            }

            const head = safeRows[0] || [];
            const body = safeRows.slice(1);

            // data-table-idx must match backend injectTableData indexing (0-based order of <w:tbl> in doc)
            const tableIdx = Number.isFinite(tableBlockId) ? Math.max(0, tableBlockId - 1) : 0;

            const inferColumnKind = (headerText) => {
                const h = String(headerText || '').toLowerCase();
                if (h.includes('date')) return 'date';
                if (h.includes('heure') || h.includes('time')) return 'time';
                return 'text';
            };
            const columnKinds = head.map((c) => inferColumnKind((c?.text || '').trim()));

            const getSavedCellValue = (rowIdx, colIdx) => {
                // Word-like tables are stored by numeric table index (as string in JSON).
                const key = String(tableIdx);
                return (
                    this.formData?.tables?.[key]?.[rowIdx]?.[colIdx] ??
                    this.formData?.tables?.[tableIdx]?.[rowIdx]?.[colIdx] ??
                    ''
                );
            };

            const normalizeTime = (value) => {
                const v = String(value || '').trim();
                if (!v) return '';
                // HH:MM
                const m1 = v.match(/^(\d{1,2}):(\d{2})$/);
                if (m1) {
                    const hh = String(Math.min(23, Math.max(0, parseInt(m1[1], 10)))).padStart(2, '0');
                    const mm = String(Math.min(59, Math.max(0, parseInt(m1[2], 10)))).padStart(2, '0');
                    return `${hh}:${mm}`;
                }
                // HHhMM
                const m2 = v.match(/^(\d{1,2})\s*h\s*(\d{2})$/i);
                if (m2) {
                    const hh = String(Math.min(23, Math.max(0, parseInt(m2[1], 10)))).padStart(2, '0');
                    const mm = String(Math.min(59, Math.max(0, parseInt(m2[2], 10)))).padStart(2, '0');
                    return `${hh}:${mm}`;
                }
                return v;
            };

            const normalizeDateToISO = (value) => {
                const v = String(value || '').trim();
                if (!v) return '';
                if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v; // already ISO
                // DD/MM/YYYY or DD-MM-YYYY
                const m = v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
                if (m) {
                    const dd = String(Math.min(31, Math.max(1, parseInt(m[1], 10)))).padStart(2, '0');
                    const mm = String(Math.min(12, Math.max(1, parseInt(m[2], 10)))).padStart(2, '0');
                    const yyyy = String(parseInt(m[3], 10));
                    return `${yyyy}-${mm}-${dd}`;
                }
                return '';
            };

            const renderCell = (cell, tagName, rowIdx, colIdx, isHeader) => {
                const attrs = [];
                if (cell?.colspan) attrs.push(`colspan="${cell.colspan}"`);
                if (cell?.rowspan && cell.rowspan > 1) attrs.push(`rowspan="${cell.rowspan}"`);
                if (cell?.fill) attrs.push(`style="background:${this.escapeHtml(cell.fill)}"`);

                const cellText = (cell?.text || '').trim();
                const isBlank = !cellText || /^_{3,}$/.test(cellText);
                const content = (() => {
                    // Header cells are never editable
                    if (isHeader) {
                        return cellText ? renderTextWithInputs(cellText) : `<span class="fsop-cell-empty"></span>`;
                    }
                    // Body cells:
                    // - Keep the document look (no extra inputs) except for Date/Heure columns which must be fillable with native pickers.
                    const kind = columnKinds[colIdx] || 'text';
                    const saved = getSavedCellValue(rowIdx, colIdx);

                    if (kind === 'date') {
                        const placeholderLike = /^(jj|dd)\s*[\/-]\s*(mm)\s*[\/-]\s*(aaaa|yyyy)$/i.test(cellText);
                        const iso = normalizeDateToISO(saved || (placeholderLike ? '' : cellText));
                        const valueAttr = iso ? ` value="${this.escapeHtml(iso)}"` : '';
                        return `<input class="fsop-cell-input fsop-cell-input-date" type="date" data-row="${rowIdx}" data-col="${colIdx}"${valueAttr} />`;
                    }

                    if (kind === 'time') {
                        const placeholderLike = /^(hh)\s*[:h]\s*(mm)$/i.test(cellText);
                        const hhmm = normalizeTime(saved || (placeholderLike ? '' : cellText));
                        const valueAttr = hhmm ? ` value="${this.escapeHtml(hhmm)}"` : '';
                        return `<input class="fsop-cell-input fsop-cell-input-time" type="time" data-row="${rowIdx}" data-col="${colIdx}"${valueAttr} />`;
                    }

                    // For other columns: make empty cells editable, keep filled cells as text (to avoid perturbing reading)
                    if (isBlank) {
                        const initial = saved ? this.escapeHtml(String(saved)) : '';
                        return `<div class="fsop-cell-edit" contenteditable="true" data-row="${rowIdx}" data-col="${colIdx}">${initial}</div>`;
                    }

                    // If we have a saved value for a non-empty cell, prefer showing it (e.g. when re-opening a saved FSOP)
                    if (saved) {
                        return this.escapeHtml(String(saved));
                    }

                    return renderTextWithInputs(cellText);
                })();
                return `<${tagName} ${attrs.join(' ')}>${content}</${tagName}>`;
            };

            let t = `<table class="fsop-word-table" data-table-idx="${tableIdx}">`;
            t += '<thead><tr>';
            head.forEach((c, colIdx) => {
                t += renderCell(c, 'th', -1, colIdx, true);
            });
            t += '</tr></thead>';

            t += '<tbody>';
            body.forEach((r, rowIdx) => {
                t += '<tr>';
                (r || []).forEach((c, colIdx) => {
                    t += renderCell(c, 'td', rowIdx, colIdx, false);
                });
                t += '</tr>';
            });
            t += '</tbody></table>';
            return t;
        };

        blocks.forEach((b) => {
            if (b.type === 'page_break') {
                // Ignore page breaks in single-page mode
                return;
            }
            if (b.type === 'table') {
                html += `<div class="fsop-word-block fsop-word-block-table">${renderTable(b.rows, b.id)}</div>`;
                return;
            }
            if (b.type === 'paragraph') {
                const text = (b.text || '').trim();
                if (!text) {
                    html += `<div class="fsop-word-block fsop-word-block-empty"></div>`;
                    return;
                }

                // Titles / headings
                // Examples:
                // - "1- Préparation ..." -> main section title
                // - "Général :" -> sub title
                const sectionTitleMatch = text.match(/^(\d{1,2})\s*[-–.]\s*(.+)$/);
                if (sectionTitleMatch) {
                    const n = sectionTitleMatch[1];
                    const title = sectionTitleMatch[2];
                    html += `
                        <div class="fsop-word-title">
                            <span class="fsop-word-title-number">${this.escapeHtml(n)}</span>
                            <span class="fsop-word-title-text">${renderTextWithInputs(title)}</span>
                        </div>
                    `;
                    return;
                }
                if (/:\s*$/.test(text) && text.length <= 60) {
                    html += `<div class="fsop-word-subtitle">${renderTextWithInputs(text)}</div>`;
                    return;
                }

                const checkboxHtml = renderCheckboxLine(text);
                if (checkboxHtml) {
                    html += `<div class="fsop-word-block">${checkboxHtml}</div>`;
                    return;
                }
                const pfHtml = b.hasPassFail ? renderPassFailLine(text) : null;
                if (pfHtml) {
                    html += `<div class="fsop-word-block">${pfHtml}</div>`;
                    return;
                }
                html += `<div class="fsop-word-block fsop-word-paragraph">${renderTextWithInputs(text)}</div>`;
            }
        });

        html += '</div></div>';
        return html;
    }

    /**
     * Render une section du formulaire
     */
    renderSection(section) {
        let html = `<div class="fsop-section" data-section-id="${section.id}">`;
        // Use title EXACTLY as extracted from Word document (already includes number and separator)
        // The title should already be in format like "1- Contrôle interférométrique avec enregistrement du rapport :"
        const titleText = section.title ? section.title : '';
        
        // NEVER use "Section X" - always use the extracted title or construct it properly
        let displayTitle = titleText || '';
        
        // Debug: log what we received
        console.log(`🎨 Rendering section ${section.id}:`, {
            title: section.title,
            titleText: titleText,
            displayTitle: displayTitle,
            type: section.type,
            hasFields: section.fields?.length > 0,
            hasTable: !!section.table,
            tablesCount: section.tables?.length || 0
        });
        
        // If title is empty or missing, try to get it from section.title
        if (!displayTitle || displayTitle.trim() === '') {
            displayTitle = section.title || '';
        }
        
        // If still empty or is a generic "Section X", use a fallback
        if (!displayTitle || displayTitle.trim() === '' || displayTitle.match(/^Section\s+\d+$/i)) {
            console.warn(`⚠️ Section ${section.id} has no title, using fallback`);
            displayTitle = section.id === 0 ? 'Général : Composant' : `Section ${section.id}`;
        } else if (section.id !== 0 && !displayTitle.match(/^\d+/)) {
            // If title doesn't start with number (and not section 0), prepend it
            displayTitle = `${section.id}- ${displayTitle}`;
        }
        
        // Always render the title, even if it's a fallback
        html += `<h3 class="fsop-section-title">${this.escapeHtml(displayTitle)}</h3>`;
        
        console.log(`  → Final title rendered: "${displayTitle}"`);

        // Render PASS/FAIL fields first (if any)
        // Also check if section has PASS/FAIL fields even if type is not 'pass_fail'
        const hasPassFail = (section.type === 'pass_fail' || (section.fields && section.fields.length > 0));
        if (hasPassFail && section.fields && section.fields.length > 0) {
            console.log(`  → Rendering ${section.fields.length} PASS/FAIL fields for section ${section.id}`);
            section.fields.forEach(field => {
                // Clean field name (remove "FAIL" prefix if present)
                const cleanField = field.replace(/^FAIL\s+/i, '').trim();
                const fieldKey = `${section.id}_${cleanField}`;
                const currentValue = this.formData.passFail[section.id]?.[cleanField] || '';
                
                html += `
                    <div class="fsop-field fsop-pass-fail">
                        <label class="fsop-pass-fail-label">${this.escapeHtml(cleanField)}:</label>
                        <div class="fsop-radio-group">
                            <label class="fsop-radio-label ${currentValue === 'PASS' ? 'active' : ''}">
                                <input 
                                    type="radio" 
                                    name="passfail_${fieldKey}" 
                                    value="PASS"
                                    data-section-id="${section.id}"
                                    data-field="${cleanField}"
                                    ${currentValue === 'PASS' ? 'checked' : ''}
                                />
                                <span class="fsop-radio-text pass">PASS</span>
                            </label>
                            <label class="fsop-radio-label ${currentValue === 'FAIL' ? 'active' : ''}">
                                <input 
                                    type="radio" 
                                    name="passfail_${fieldKey}" 
                                    value="FAIL"
                                    data-section-id="${section.id}"
                                    data-field="${cleanField}"
                                    ${currentValue === 'FAIL' ? 'checked' : ''}
                                />
                                <span class="fsop-radio-text fail">FAIL</span>
                            </label>
                        </div>
                    </div>
                `;
            });
        }
        
        // Render tables if any (before checkboxes)
        // Support multiple tables per section
        if (section.tables && section.tables.length > 0) {
            section.tables.forEach((table, tableIdx) => {
                html += this.renderTable(table, section.id, tableIdx);
            });
        } else if (section.table) {
            // Backward compatibility: single table
            html += this.renderTable(section.table, section.id, 0);
        }
        
        // Render simple text fields if any (e.g., "Voie du cordon sur connecteur 38999 : _______")
        if (section.textFields && section.textFields.length > 0) {
            section.textFields.forEach((textField, idx) => {
                const fieldKey = `textfield_${section.id}_${idx}`;
                const currentValue = this.formData.textFields?.[section.id]?.[idx] || '';
                
                html += `
                    <div class="fsop-field fsop-text-field">
                        <label for="${fieldKey}">${this.escapeHtml(textField.label)}:</label>
                        <input 
                            type="text" 
                            id="${fieldKey}"
                            class="fsop-input"
                            data-section-id="${section.id}"
                            data-field-index="${idx}"
                            value="${this.escapeHtml(currentValue)}"
                            placeholder="${this.escapeHtml(textField.placeholder || '')}"
                        />
                    </div>
                `;
            });
        }
        
        // Render checkboxes if any (after table and text fields)
        if (section.checkboxes && section.checkboxes.length > 0) {
            // Debug: Log checkbox order for this section
            console.log(`  ☑️ Section ${section.id}: Rendering ${section.checkboxes.length} checkboxes in order:`, 
                section.checkboxes.map((cb, idx) => `${idx + 1}. [paraIndex: ${cb.paragraphIndex}, pos: ${cb.position}] ${cb.label.substring(0, 50)}`));
            
            section.checkboxes.forEach((checkbox, idx) => {
                const checkboxKey = `${section.id}_${checkbox.id}`;
                const currentValue = this.formData.checkboxes?.[section.id]?.[checkbox.id] || false;
                
                html += `
                    <div class="fsop-field fsop-checkbox-field">
                        <label class="fsop-checkbox-label">
                            <input 
                                type="checkbox" 
                                id="checkbox_${checkboxKey}"
                                data-section-id="${section.id}"
                                data-checkbox-id="${checkbox.id}"
                                ${currentValue ? 'checked' : ''}
                            />
                            <span>${this.escapeHtml(checkbox.label)}</span>
                        </label>
                    </div>
                `;
            });
        }

        html += '</div>';
        return html;
    }

    /**
     * Render un tableau interactif
     */
    renderTable(table, sectionId, tableIndex = 0) {
        let html = '<div class="fsop-table-container">';
        const tableId = `table_${sectionId}_${tableIndex}`;
        html += `<table class="fsop-table" data-table-id="${tableId}">`;
        
        // Header row
        html += '<thead><tr>';
        table.headers.forEach((header, idx) => {
            html += `<th>${this.escapeHtml(header)}</th>`;
        });
        html += '</tr></thead>';
        
        // Data rows
        html += '<tbody>';
        
        // Initialize table data if not exists
        if (!this.formData.tables[tableId]) {
            this.formData.tables[tableId] = {};
        }
        
        // Render all rows from table structure
        // If no data rows exist, create at least one empty row for data entry
        const dataRows = table.rows && table.rows.length > 0 ? table.rows : [];
        const rowCount = Math.max(dataRows.length, 1); // At least one row for data entry
        
        for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
            html += '<tr>';
            
            // Ensure we have cells for all columns
            const rowData = dataRows[rowIdx] || { cells: [] };
            const rowCells = rowData.cells || [];
            
            table.columns.forEach((column, colIdx) => {
                // Get cell value from row data or form data
                const cellFromRow = rowCells.find(c => c.columnIndex === colIdx);
                let cellValue = this.formData.tables[tableId]?.[rowIdx]?.[colIdx] || 
                                cellFromRow?.value || 
                                '';
                
                // Detect if this is a fixed label (not an input field)
                // Fixed labels are typically:
                // - Contain descriptive text with units (e.g., "1ère polymérisation: 1h / 80°C")
                // - Contain colons followed by specifications
                // - Are in the first column and contain descriptive text
                const isFixedLabel = this.isFixedLabelCell(cellValue, column, colIdx, rowIdx, table);
                
                const inputType = this.getInputTypeForColumn(column);
                const placeholder = this.getPlaceholderForColumn(column);
                
                // For numeric columns, use text input with inputmode to allow **value** syntax
                const finalInputType = (inputType === 'number') ? 'text' : inputType;
                const inputMode = (inputType === 'number') ? 'inputmode="decimal"' : '';
                
                if (isFixedLabel) {
                    // Render as readonly text (fixed label)
                    html += `
                        <td class="fsop-table-label-cell">
                            <span class="fsop-table-label">${this.escapeHtml(cellValue)}</span>
                        </td>
                    `;
                } else {
                    // Clean cell value only for input fields: if it's a label-like text, treat as empty
                    // But be more careful - only clear if it's clearly a label in a numeric field
                    if (inputType === 'number' && cellValue) {
                        // Check if it's a label (contains units, descriptive text, etc.)
                        if (cellValue.match(/[a-zéèêëàâäôöùûüç]/i) && 
                            (cellValue.includes('(') || 
                             cellValue.includes('en ') || 
                             cellValue.match(/^\d+[^\d]*[a-z]/i))) {
                            // This looks like a label, not a value - clear it
                            cellValue = '';
                        } else if (isNaN(parseFloat(cellValue))) {
                            cellValue = '';
                        }
                    }
                    
                    html += `
                        <td>
                            <input 
                                type="${finalInputType}"
                                ${inputMode}
                                class="fsop-table-input fsop-input-${column.type}"
                                data-table-id="${tableId}"
                                data-row-id="${rowIdx}"
                                data-column-idx="${colIdx}"
                                data-column-name="${this.escapeHtml(column.name)}"
                                ${cellValue ? `value="${this.escapeHtml(cellValue)}"` : ''}
                                ${placeholder ? `placeholder="${this.escapeHtml(placeholder)}"` : ''}
                            />
                        </td>
                    `;
                }
            });
            
            html += '</tr>';
        }
        
        html += '</tbody>';
        html += '</table>';
        
        // Add row button
        html += `
            <button type="button" class="fsop-add-row-btn" data-table-id="${tableId}">
                <i class="fas fa-plus"></i> Ajouter une ligne
            </button>
        `;
        
        html += '</div>';
        return html;
    }

    /**
     * Détermine si une cellule est un label fixe (non éditable)
     */
    isFixedLabelCell(cellValue, column, colIdx, rowIdx, table) {
        if (!cellValue || !cellValue.trim()) {
            return false;
        }
        
        const value = cellValue.trim();
        
        // Patterns for fixed labels:
        // 1. Contains colon followed by specifications (e.g., "1ère polymérisation: 1h / 80°C")
        if (value.includes(':') && (value.includes('/') || value.match(/\d+\s*(h|min|°C|°F)/i))) {
            return true;
        }
        
        // 2. Contains descriptive text with units in parentheses (e.g., "Colle 353 ND")
        // But only if it's in a column that's not typically for data entry
        if (value.match(/^[A-Za-zÀ-ÿ\s]+\([^)]+\)/) && 
            !column.name.toLowerCase().match(/(date|heure|opérateur|lot|mesure)/i)) {
            return true;
        }
        
        // 3. First column with descriptive text that's not a header
        if (colIdx === 0 && rowIdx > 0 && 
            value.match(/^\d+(er|ème|e)\s+[a-zéèêëàâäôöùûüç]/i)) {
            return true;
        }
        
        // 4. Contains "MO" reference pattern (e.g., "MO 1080 ind")
        if (value.match(/MO\s+\d+\s*ind/i)) {
            return true;
        }
        
        return false;
    }

    /**
     * Détermine le type d'input selon le type de colonne
     */
    getInputTypeForColumn(column) {
        switch (column.type) {
            case 'numeric':
                return 'number';
            case 'date':
                return 'date';
            case 'time':
                return 'time';
            case 'operator':
                return 'text';
            default:
                return 'text';
        }
    }

    /**
     * Obtient un placeholder pour une colonne
     */
    getPlaceholderForColumn(column) {
        const headerLower = column.name.toLowerCase();
        if (headerLower.includes('date')) {
            return 'JJ/MM/AAAA';
        } else if (headerLower.includes('heure') || headerLower.includes('time')) {
            return 'HH:MM';
        } else if (headerLower.includes('mm')) {
            return 'mm';
        } else if (headerLower.includes('db')) {
            return 'dB';
        }
        return '';
    }

    /**
     * Attache les event listeners aux éléments du formulaire
     */
    attachEventListeners() {
        // Placeholder inputs
        this.container.querySelectorAll('[data-placeholder]').forEach(input => {
            input.addEventListener('input', (e) => {
                const placeholder = e.target.getAttribute('data-placeholder');
                this.formData.placeholders[placeholder] = e.target.value;
            });
        });

        // Word-like PASS/FAIL
        this.container.querySelectorAll('input[type="radio"][data-passfail-key]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const key = e.target.getAttribute('data-passfail-key');
                const value = e.target.value;
                if (!this.formData.passFail.wordlike) {
                    this.formData.passFail.wordlike = {};
                }
                this.formData.passFail.wordlike[key] = value;

                // Update active styles
                const wrap = e.target.closest('.fsop-word-passfail');
                if (wrap) {
                    wrap.querySelectorAll('.fsop-word-passfail-opt').forEach(l => l.classList.remove('active'));
                    const label = e.target.closest('.fsop-word-passfail-opt');
                    if (label) label.classList.add('active');
                }
            });
        });

        // PASS/FAIL radio buttons
        this.container.querySelectorAll('input[type="radio"][data-section-id]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const sectionId = e.target.getAttribute('data-section-id');
                const field = e.target.getAttribute('data-field');
                const value = e.target.value;
                
                if (!this.formData.passFail[sectionId]) {
                    this.formData.passFail[sectionId] = {};
                }
                this.formData.passFail[sectionId][field] = value;
                
                // Update visual state
                const label = e.target.closest('.fsop-radio-label');
                label.parentElement.querySelectorAll('.fsop-radio-label').forEach(l => l.classList.remove('active'));
                label.classList.add('active');
            });
        });

        // Table inputs
        this.container.querySelectorAll('.fsop-table-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const tableId = e.target.getAttribute('data-table-id');
                const rowId = parseInt(e.target.getAttribute('data-row-id'), 10);
                const colIdx = parseInt(e.target.getAttribute('data-column-idx'), 10);
                
                if (!this.formData.tables[tableId]) {
                    this.formData.tables[tableId] = {};
                }
                if (!this.formData.tables[tableId][rowId]) {
                    this.formData.tables[tableId][rowId] = {};
                }
                this.formData.tables[tableId][rowId][colIdx] = e.target.value;
            });
        });

        // Reference field
        const referenceInput = this.container.querySelector('#fsop_reference');
        if (referenceInput) {
            referenceInput.addEventListener('input', (e) => {
                this.formData.reference = e.target.value.trim();
            });
        }

        // Text field inputs (simple text fields like "Voie du cordon")
        this.container.querySelectorAll('.fsop-text-field input').forEach(input => {
            input.addEventListener('input', (e) => {
                const sectionId = e.target.getAttribute('data-section-id');
                const fieldIndex = parseInt(e.target.getAttribute('data-field-index'), 10);
                
                if (!this.formData.textFields[sectionId]) {
                    this.formData.textFields[sectionId] = {};
                }
                this.formData.textFields[sectionId][fieldIndex] = e.target.value;
            });
        });

        // Checkbox inputs
        this.container.querySelectorAll('input[type="checkbox"][data-section-id]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const sectionId = e.target.getAttribute('data-section-id');
                const checkboxId = e.target.getAttribute('data-checkbox-id');
                
                if (!this.formData.checkboxes[sectionId]) {
                    this.formData.checkboxes[sectionId] = {};
                }
                this.formData.checkboxes[sectionId][checkboxId] = e.target.checked;
            });
        });

        // Add row buttons
        this.container.querySelectorAll('.fsop-add-row-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tableId = btn.getAttribute('data-table-id');
                this.addTableRow(tableId);
            });
        });

        // Word-like editable table cells (prevent line breaks)
        this.container.querySelectorAll('.fsop-cell-edit[contenteditable="true"]').forEach((el) => {
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                }
            });
            // Keep plain text only
            el.addEventListener('paste', (e) => {
                e.preventDefault();
                const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
                document.execCommand('insertText', false, text);
            });
        });

        // Word-like date/time inputs: normalize values (keep as-is, backend will inject string)
        this.container.querySelectorAll('.fsop-cell-input[data-row][data-col]').forEach((el) => {
            el.addEventListener('change', () => {
                // no-op: value is read on save
            });
        });
    }

    /**
     * Ajoute une nouvelle ligne à un tableau
     */
    addTableRow(tableId) {
        const table = this.container.querySelector(`[data-table-id="${tableId}"]`)?.closest('table');
        if (!table) return;

        const tbody = table.querySelector('tbody');
        const firstRow = tbody.querySelector('tr');
        if (!firstRow) return;

        const newRow = firstRow.cloneNode(true);
        const rowCount = tbody.querySelectorAll('tr').length;
        
        // Update data attributes
        newRow.querySelectorAll('input').forEach(input => {
            const colIdx = input.getAttribute('data-column-idx');
            input.setAttribute('data-row-id', rowCount);
            input.value = '';
            input.removeAttribute('value');
        });

        tbody.appendChild(newRow);
        
        // Re-attach event listeners for new inputs
        newRow.querySelectorAll('.fsop-table-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const rowId = parseInt(e.target.getAttribute('data-row-id'), 10);
                const colIdx = parseInt(e.target.getAttribute('data-column-idx'), 10);
                
                if (!this.formData.tables[tableId]) {
                    this.formData.tables[tableId] = {};
                }
                if (!this.formData.tables[tableId][rowId]) {
                    this.formData.tables[tableId][rowId] = {};
                }
                this.formData.tables[tableId][rowId][colIdx] = e.target.value;
            });
        });
    }

    /**
     * Génère un nom de tag Excel à partir de l'en-tête de colonne
     * Ex: "1er jonction (mm)" -> "JONCTION1_MM"
     */
    generateTagFromColumnHeader(columnHeader) {
        if (!columnHeader) return '';
        
        let tag = columnHeader.trim();
        
        // Convert "1er" -> "1", "2ème" -> "2", etc.
        tag = tag.replace(/(\d+)(er|ème|e)/gi, '$1');
        
        // Remove parentheses and their content, but keep units
        tag = tag.replace(/\(([^)]+)\)/g, (match, content) => {
            // Keep common units (mm, dB, etc.)
            if (/mm|db|°c|°f|°|kg|g|m|cm/i.test(content)) {
                return '_' + content.toUpperCase().trim();
            }
            return '';
        });
        
        // Remove accents
        tag = tag.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        
        // Convert to uppercase
        tag = tag.toUpperCase();
        
        // Remove punctuation except underscores
        tag = tag.replace(/[^\w\s]/g, '');
        
        // Replace spaces and multiple underscores with single underscore
        tag = tag.replace(/\s+/g, '_').replace(/_+/g, '_');
        
        // Remove leading/trailing underscores
        tag = tag.replace(/^_+|_+$/g, '');
        
        return tag;
    }

    /**
     * Nettoie une valeur en retirant les ** et normalise pour Word
     */
    cleanValueForWord(value) {
        if (!value) return '';
        
        // Remove ** markers
        let cleaned = value.replace(/^\*\*|\*\*$/g, '');
        
        // Normalize decimal separator (comma to point)
        cleaned = cleaned.replace(',', '.');
        
        return cleaned.trim();
    }

    /**
     * Vérifie si une valeur est numérique (après nettoyage)
     */
    isNumericValue(value) {
        if (!value) return false;
        const cleaned = this.cleanValueForWord(value);
        return !isNaN(parseFloat(cleaned)) && isFinite(cleaned);
    }

    /**
     * Récupère les données du formulaire
     */
    getFormData() {
        // If we are in Word-like mode, extract table values from editable cells
        // and map them to backend `injectTableData` format (table index -> row -> col -> value).
        const wordlikeTables = {};
        if (this.container) {
            this.container.querySelectorAll('.fsop-word-table[data-table-idx]').forEach((tableEl) => {
                const tableIdx = parseInt(tableEl.getAttribute('data-table-idx') || '0', 10);
                if (!Number.isFinite(tableIdx)) return;
                if (!wordlikeTables[tableIdx]) wordlikeTables[tableIdx] = {};

                const tbodyRows = Array.from(tableEl.querySelectorAll('tbody tr'));
                tbodyRows.forEach((tr, rowIdx) => {
                    const cellEdits = Array.from(tr.querySelectorAll('.fsop-cell-edit[contenteditable="true"][data-col]'));
                    const cellInputs = Array.from(tr.querySelectorAll('.fsop-cell-input[data-col]'));
                    if (cellEdits.length === 0 && cellInputs.length === 0) return;
                    if (!wordlikeTables[tableIdx][rowIdx]) wordlikeTables[tableIdx][rowIdx] = {};
                    cellEdits.forEach((cellEl) => {
                        const colIdx = parseInt(cellEl.getAttribute('data-col') || '0', 10);
                        if (!Number.isFinite(colIdx)) return;
                        const value = (cellEl.textContent || '').trim();
                        if (value) {
                            wordlikeTables[tableIdx][rowIdx][colIdx] = value;
                        }
                    });
                    cellInputs.forEach((cellEl) => {
                        const colIdx = parseInt(cellEl.getAttribute('data-col') || '0', 10);
                        if (!Number.isFinite(colIdx)) return;
                        let value = String(cellEl.value || '').trim();
                        if (value) {
                            // Normalize <input type="date"> (YYYY-MM-DD) -> DD/MM/YYYY for Word readability
                            if (cellEl.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                                const [yyyy, mm, dd] = value.split('-');
                                value = `${dd}/${mm}/${yyyy}`;
                            }
                            wordlikeTables[tableIdx][rowIdx][colIdx] = value;
                        }
                    });
                });
            });
        }

        // Extract tagged measures from **value** pattern in table cells
        const taggedMeasures = {};
        const cleanedTables = {};
        
        // Process all tables to detect **value** patterns and clean values for Word
        if (this.container) {
            this.container.querySelectorAll('.fsop-table').forEach(table => {
                const tableId = table.getAttribute('data-table-id') || 
                               table.querySelector('.fsop-table-input')?.getAttribute('data-table-id');
                
                if (!tableId) return;
                
                // Get table structure to find column headers
                const thead = table.querySelector('thead');
                const headers = [];
                if (thead) {
                    thead.querySelectorAll('th').forEach(th => {
                        headers.push(th.textContent.trim());
                    });
                }
                
                // Also try to get headers from structure if available
                // Extract sectionId from tableId (format: "table_3" -> sectionId = 3)
                let columnHeaders = headers;
                const sectionIdMatch = tableId.match(/^table_(\d+)$/);
                if (sectionIdMatch && this.structure && this.structure.sections) {
                    const sectionId = parseInt(sectionIdMatch[1], 10);
                    const section = this.structure.sections.find(s => s.id === sectionId);
                    if (section && section.table && section.table.headers) {
                        columnHeaders = section.table.headers;
                    }
                }
                
                // Initialize cleaned table data
                if (!cleanedTables[tableId]) {
                    cleanedTables[tableId] = {};
                }
                
                // Process each row
                table.querySelectorAll('tbody tr').forEach(row => {
                    const rowId = parseInt(row.querySelector('.fsop-table-input')?.getAttribute('data-row-id') || '0', 10);
                    
                    if (!cleanedTables[tableId][rowId]) {
                        cleanedTables[tableId][rowId] = {};
                    }
                    
                    // Process each cell in the row
                    row.querySelectorAll('.fsop-table-input').forEach(input => {
                        const colIdx = parseInt(input.getAttribute('data-column-idx') || '0', 10);
                        const columnName = input.getAttribute('data-column-name') || columnHeaders[colIdx] || '';
                        const rawValue = input.value || '';
                        
                        // Check if value matches **value** pattern
                        const starPattern = /^\*\*(.+)\*\*$/;
                        const match = rawValue.match(starPattern);
                        
                        if (match) {
                            const valueWithStars = match[0];
                            const valueWithoutStars = match[1];
                            
                            // Clean value for Word (remove **)
                            const cleanedValue = this.cleanValueForWord(valueWithStars);
                            
                            // Store cleaned value for Word
                            cleanedTables[tableId][rowId][colIdx] = cleanedValue;
                            
                            // If value is numeric, generate tag and add to taggedMeasures
                            if (this.isNumericValue(valueWithoutStars)) {
                                const generatedTag = this.generateTagFromColumnHeader(columnName);
                
                                if (generatedTag) {
                                    // Last one wins if duplicate tag (as per plan)
                                    taggedMeasures[generatedTag] = cleanedValue;
                                }
                            }
                        } else {
                            // No ** pattern, store value as-is (but still clean for Word if needed)
                            cleanedTables[tableId][rowId][colIdx] = rawValue;
                }
                    });
                });
            });
        }

        // Merge word-like tables first (so save works in Word-like mode)
        // Note: wordlikeTables keys are numeric table indexes; keep them as strings for JSON.
        Object.keys(wordlikeTables).forEach((tIdx) => {
            cleanedTables[tIdx] = wordlikeTables[tIdx];
        });
        
        // Merge cleaned tables with existing table data
        const finalTables = { ...this.formData.tables };
        Object.keys(cleanedTables).forEach(tableId => {
            if (!finalTables[tableId]) {
                finalTables[tableId] = {};
            }
            Object.keys(cleanedTables[tableId]).forEach(rowId => {
                finalTables[tableId][rowId] = {
                    ...finalTables[tableId][rowId],
                    ...cleanedTables[tableId][rowId]
                };
            });
        });

        return {
            placeholders: { ...this.formData.placeholders },
            tables: finalTables,
            passFail: { ...this.formData.passFail },
            checkboxes: { ...this.formData.checkboxes },
            textFields: { ...this.formData.textFields },
            reference: this.formData.reference || this.container?.querySelector('#fsop_reference')?.value?.trim() || '',
            taggedMeasures: taggedMeasures
        };
    }

    /**
     * Valide les données du formulaire
     */
    validate() {
        const errors = [];
        
        // Validate placeholders (required ones)
        if (this.structure.placeholders) {
            this.structure.placeholders.forEach(placeholder => {
                if (placeholder === '{{LT}}' || placeholder === '{{SN}}') {
                    if (!this.formData.placeholders[placeholder]) {
                        errors.push(`${this.getPlaceholderLabel(placeholder.replace(/[{}]/g, ''))} est requis`);
                    }
                }
            });
        }
        
        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Obtient un label lisible pour un placeholder
     */
    getPlaceholderLabel(tag) {
        const labels = {
            'LT': 'Numéro de lancement',
            'SN': 'Numéro de série',
            'N_CORDON': 'Numéro de cordon',
            'REF_SILOG': 'Référence SILOG'
        };
        return labels[tag] || tag;
    }

    /**
     * Échappe le HTML pour éviter les injections XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

export default FsopForm;

