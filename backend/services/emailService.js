const nodemailer = require('nodemailer');
const webhookEmailService = require('./webhookEmailService');

class EmailService {
    constructor() {
        this.transporter = null;
        this.initializeTransporter();
    }

    initializeTransporter() {
        // Vérifier si l'email est désactivé
        if (process.env.EMAIL_DISABLED === 'true') {
            console.log('📧 Email désactivé - mode simulation uniquement');
            this.transporter = null;
            return;
        }

        // Vérifier si on utilise un service d'email HTTP (sans SMTP)
        if (process.env.EMAIL_USE_HTTP === 'true') {
            console.log('📧 Configuration email HTTP (sans mot de passe)');
            this.transporter = null; // Pas de transporter SMTP
            return;
        }

        // Configuration SMTP classique
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: Number.parseInt(process.env.SMTP_PORT) || 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER || 'boutard@sedi-ati.com',
                pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD
            },
            tls: {
                rejectUnauthorized: false
            }
        });

        // Vérifier la configuration
        this.transporter.verify((error, success) => {
            if (error) {
                console.error('❌ Erreur de configuration email:', error);
            } else {
                console.log('✅ Serveur email configuré et prêt');
            }
        });
    }

    async sendCommentNotification(commentData) {
        try {
            // Si l'email est désactivé, simuler l'envoi
            if (process.env.EMAIL_DISABLED === 'true') {
                console.log('📧 [SIMULATION] Email de commentaire:', {
                    to: 'boutard@sedi-ati.com',
                    subject: `[SEDI] Nouveau commentaire - Opérateur ${commentData.operatorCode}`,
                    operator: commentData.operatorName,
                    lancement: commentData.lancementCode,
                    comment: commentData.comment.substring(0, 100) + '...'
                });
                return { success: true, messageId: 'simulation-' + Date.now() };
            }

            // Si on utilise HTTP au lieu de SMTP
            if (process.env.EMAIL_USE_HTTP === 'true') {
                return await this.sendEmailViaHTTP(commentData);
            }

            const { operatorCode, operatorName, lancementCode, comment, timestamp } = commentData;
            
            const mailOptions = {
                from: process.env.SMTP_FROM || 'boutard@sedi-ati.com',
                to: 'boutard@sedi-ati.com',
                subject: `[SEDI] Nouveau commentaire - Opérateur ${operatorCode}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">
                            📝 Nouveau Commentaire SEDI
                        </h2>
                        
                        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <h3 style="color: #2c3e50; margin-top: 0;">Détails du commentaire</h3>
                            
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="padding: 8px 0; font-weight: bold; color: #555; width: 150px;">Opérateur :</td>
                                    <td style="padding: 8px 0; color: #2c3e50;">${operatorName} (${operatorCode})</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; font-weight: bold; color: #555;">Code Lancement :</td>
                                    <td style="padding: 8px 0; color: #2c3e50;">${lancementCode}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; font-weight: bold; color: #555;">Date/Heure :</td>
                                    <td style="padding: 8px 0; color: #2c3e50;">${timestamp}</td>
                                </tr>
                            </table>
                        </div>
                        
                        <div style="background-color: #e8f4fd; padding: 20px; border-left: 4px solid #3498db; margin: 20px 0;">
                            <h3 style="color: #2c3e50; margin-top: 0;">Commentaire :</h3>
                            <p style="color: #2c3e50; font-size: 16px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${comment}</p>
                        </div>
                        
                        <div style="background-color: #f1f2f6; padding: 15px; border-radius: 5px; margin-top: 20px; font-size: 14px; color: #666;">
                            <p style="margin: 0;">
                                <strong>Note :</strong> Ce commentaire a été automatiquement envoyé depuis l'interface tablette SEDI.
                            </p>
                        </div>
                    </div>
                `,
                text: `
Nouveau commentaire SEDI

Opérateur: ${operatorName} (${operatorCode})
Code Lancement: ${lancementCode}
Date/Heure: ${timestamp}

Commentaire:
${comment}

---
Ce commentaire a été automatiquement envoyé depuis l'interface tablette SEDI.
                `
            };

            const result = await this.transporter.sendMail(mailOptions);
            console.log('✅ Email envoyé avec succès:', result.messageId);
            return { success: true, messageId: result.messageId };
            
        } catch (error) {
            console.error('❌ Erreur lors de l\'envoi de l\'email:', error);
            return { success: false, error: error.message };
        }
    }

    // Méthode pour envoyer des emails via HTTP (sans mot de passe)
    async sendEmailViaHTTP(commentData) {
        try {
            const { operatorCode, operatorName, lancementCode, comment, timestamp } = commentData;
            
            // Utiliser un service d'email gratuit comme EmailJS ou un webhook
            const emailData = {
                to: 'boutard@sedi-ati.com',
                subject: `[SEDI] Nouveau commentaire - Opérateur ${operatorCode}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">
                            📝 Nouveau Commentaire SEDI
                        </h2>
                        
                        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <h3 style="color: #2c3e50; margin-top: 0;">Détails du commentaire</h3>
                            
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="padding: 8px 0; font-weight: bold; color: #555; width: 150px;">Opérateur :</td>
                                    <td style="padding: 8px 0; color: #2c3e50;">${operatorName} (${operatorCode})</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; font-weight: bold; color: #555;">Code Lancement :</td>
                                    <td style="padding: 8px 0; color: #2c3e50;">${lancementCode}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; font-weight: bold; color: #555;">Date/Heure :</td>
                                    <td style="padding: 8px 0; color: #2c3e50;">${timestamp}</td>
                                </tr>
                            </table>
                        </div>
                        
                        <div style="background-color: #e8f4fd; padding: 20px; border-left: 4px solid #3498db; margin: 20px 0;">
                            <h3 style="color: #2c3e50; margin-top: 0;">Commentaire :</h3>
                            <p style="color: #2c3e50; font-size: 16px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${comment}</p>
                        </div>
                        
                        <div style="background-color: #f1f2f6; padding: 15px; border-radius: 5px; margin-top: 20px; font-size: 14px; color: #666;">
                            <p style="margin: 0;">
                                <strong>Note :</strong> Ce commentaire a été automatiquement envoyé depuis l'interface tablette SEDI.
                            </p>
                        </div>
                    </div>
                `,
                text: `
Nouveau commentaire SEDI

Opérateur: ${operatorName} (${operatorCode})
Code Lancement: ${lancementCode}
Date/Heure: ${timestamp}

Commentaire:
${comment}

---
Ce commentaire a été automatiquement envoyé depuis l'interface tablette SEDI.
                `
            };

            // Utiliser le service webhook pour envoyer l'email
            return await webhookEmailService.sendEmail(emailData);

        } catch (error) {
            console.error('❌ Erreur lors de l\'envoi HTTP:', error);
            return { success: false, error: error.message };
        }
    }

    async sendTestEmail() {
        try {
            // Si on utilise HTTP
            if (process.env.EMAIL_USE_HTTP === 'true') {
                return await this.sendEmailViaHTTP({
                    operatorCode: 'TEST',
                    operatorName: 'Test Opérateur',
                    lancementCode: 'LT2501145',
                    comment: 'Ceci est un email de test pour vérifier la configuration email de SEDI.',
                    timestamp: new Date().toLocaleString('fr-FR', {
                        timeZone: 'Europe/Paris',
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    })
                });
            }

            const mailOptions = {
                from: process.env.SMTP_FROM || 'boutard@sedi-ati.com',
                to: 'boutard@sedi-ati.com',
                subject: '[SEDI] Test de configuration email',
                text: 'Ceci est un email de test pour vérifier la configuration email de SEDI.',
                html: '<p>Ceci est un email de test pour vérifier la configuration email de SEDI.</p>'
            };

            const result = await this.transporter.sendMail(mailOptions);
            console.log('✅ Email de test envoyé:', result.messageId);
            return { success: true, messageId: result.messageId };
        } catch (error) {
            console.error('❌ Erreur lors de l\'envoi de l\'email de test:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new EmailService();
