/**
 * Alertes fiabilité : Teams (webhook) + email (SMTP / webhook HTTP).
 * Dedup par code d'alerte pour éviter le spam (cooldown fichier).
 */

const fs = require('fs/promises');
const path = require('path');
const nodemailer = require('nodemailer');

class ReliabilityAlertService {
    static cooldownPath() {
        return process.env.ALERT_COOLDOWN_PATH || '/app/logs/alert-cooldown.json';
    }

    static cooldownMinutes() {
        const n = Number.parseInt(process.env.ALERT_COOLDOWN_MINUTES || '60', 10);
        return Number.isFinite(n) && n > 0 ? n : 60;
    }

    static alertEmail() {
        return (
            process.env.ALERT_EMAIL ||
            process.env.SMTP_FROM ||
            process.env.SMTP_USER ||
            'admin@sedi.com'
        );
    }

    static teamsWebhookUrl() {
        return String(process.env.TEAMS_WEBHOOK_URL || process.env.ALERT_TEAMS_WEBHOOK || '').trim();
    }

    static alertsEnabled() {
        return String(process.env.ALERTS_ENABLED || 'true').toLowerCase() !== 'false';
    }

    static async _readCooldown() {
        try {
            const raw = await fs.readFile(this.cooldownPath(), 'utf8');
            return JSON.parse(raw);
        } catch (_) {
            return {};
        }
    }

    static async _writeCooldown(data) {
        const target = this.cooldownPath();
        try {
            await fs.mkdir(path.dirname(target), { recursive: true });
        } catch (_) {
            // ignore
        }
        await fs.writeFile(target, JSON.stringify(data, null, 2), 'utf8');
    }

    static async _shouldSend(code) {
        const key = String(code || 'generic');
        const coolMs = this.cooldownMinutes() * 60 * 1000;
        const map = await this._readCooldown();
        const last = map[key] ? Date.parse(map[key]) : 0;
        if (last && Date.now() - last < coolMs) {
            return { send: false, reason: 'cooldown', lastSentAt: map[key] };
        }
        map[key] = new Date().toISOString();
        await this._writeCooldown(map);
        return { send: true };
    }

    static async _postTeams(title, body, severity) {
        const url = this.teamsWebhookUrl();
        if (!url) return { skipped: true, channel: 'teams' };

        const color = severity === 'critical' ? 'FF0000' : severity === 'warning' ? 'FFA500' : '0078D4';
        const payload = {
            '@type': 'MessageCard',
            '@context': 'http://schema.org/extensions',
            themeColor: color,
            summary: title,
            title: `[FSOP] ${title}`,
            text: body
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Teams webhook HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        return { success: true, channel: 'teams' };
    }

    static async _sendEmail(title, body) {
        if (process.env.EMAIL_DISABLED === 'true') {
            return { skipped: true, channel: 'email', reason: 'EMAIL_DISABLED' };
        }

        const to = this.alertEmail();
        const subject = `[FSOP ALERTE] ${title}`;

        if (process.env.EMAIL_USE_HTTP === 'true' && process.env.EMAIL_WEBHOOK_URL) {
            const res = await fetch(process.env.EMAIL_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to, subject, text: body, html: `<pre>${body}</pre>` })
            });
            if (!res.ok) throw new Error(`Email webhook HTTP ${res.status}`);
            return { success: true, channel: 'email-http' };
        }

        if (!process.env.SMTP_HOST && !process.env.SMTP_USER) {
            return { skipped: true, channel: 'email', reason: 'SMTP_NOT_CONFIGURED' };
        }

        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: Number.parseInt(process.env.SMTP_PORT || '587', 10) || 587,
            secure: false,
            auth: process.env.SMTP_USER
                ? {
                      user: process.env.SMTP_USER,
                      pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD
                  }
                : undefined,
            tls: { rejectUnauthorized: false }
        });

        await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER || to,
            to,
            subject,
            text: body
        });
        return { success: true, channel: 'email-smtp' };
    }

    /**
     * @param {{ code: string, title: string, body: string, severity?: 'info'|'warning'|'critical', force?: boolean }} opts
     */
    static async sendAlert(opts = {}) {
        const code = opts.code || 'generic';
        const title = opts.title || 'Alerte FSOP';
        const body = opts.body || '';
        const severity = opts.severity || 'warning';

        if (!this.alertsEnabled()) {
            console.log(`[ALERT][DISABLED] ${code}: ${title}`);
            return { success: true, skipped: true, reason: 'ALERTS_DISABLED' };
        }

        if (!opts.force) {
            const gate = await this._shouldSend(code);
            if (!gate.send) {
                console.log(`[ALERT][COOLDOWN] ${code} (last=${gate.lastSentAt})`);
                return { success: true, skipped: true, reason: 'cooldown', lastSentAt: gate.lastSentAt };
            }
        }

        const results = [];
        try {
            results.push(await this._postTeams(title, body, severity));
        } catch (e) {
            results.push({ success: false, channel: 'teams', error: e.message });
            console.error(`[ALERT][TEAMS][ERROR] ${e.message}`);
        }

        try {
            results.push(await this._sendEmail(title, body));
        } catch (e) {
            results.push({ success: false, channel: 'email', error: e.message });
            console.error(`[ALERT][EMAIL][ERROR] ${e.message}`);
        }

        const anyOk = results.some((r) => r && r.success);
        const allSkipped = results.every((r) => r && (r.skipped || r.success === undefined));
        console.log(`[ALERT][${anyOk ? 'SENT' : allSkipped ? 'NO_CHANNEL' : 'FAIL'}] ${code}: ${title}`);
        return { success: anyOk || allSkipped, code, results };
    }
}

module.exports = ReliabilityAlertService;
