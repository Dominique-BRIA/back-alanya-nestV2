import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  private get otpTtlMinutes(): number {
    return Number(this.config.get<string>('OTP_TTL_MINUTES', '10'));
  }

  private get from(): string {
    return this.config.get<string>('MAIL_FROM', 'Alanya <no-reply@alanya.app>');
  }

  private getTransporter(): nodemailer.Transporter | null {
    const host = this.config.get<string>('SMTP_HOST', '');
    const user = this.config.get<string>('SMTP_USER', '');
    const pass = this.config.get<string>('SMTP_PASS', '');
    if (!host || !user || !pass) return null;

    if (!this.transporter) {
      const port = Number(this.config.get<string>('SMTP_PORT', '587'));
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
    }
    return this.transporter;
  }

  async sendOtpEmail(to: string, code: string): Promise<void> {
    const subject = 'Votre code de confirmation Alanya';
    const text = `Bienvenue sur Alanya !\n\nVotre code : ${code}\n\nIl expire dans ${this.otpTtlMinutes} minutes.`;
    const html = `<div style="font-family:sans-serif;max-width:420px;margin:auto;padding:24px">
      <h2 style="color:#8a4b2b">Alanya</h2>
      <p>Votre code de confirmation :</p>
      <p style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#8a4b2b;background:#fff8f4;border-radius:12px;padding:16px;text-align:center;border:2px solid #e0b59a">${code}</p>
      <p style="color:#888;font-size:13px">Ce code expire dans ${this.otpTtlMinutes} minutes.</p>
    </div>`;

    const tx = this.getTransporter();
    if (tx) {
      try {
        await tx.sendMail({ from: this.from, to, subject, text, html });
        console.log(`[mailer] OTP envoyé par SMTP à ${to}`);
        return;
      } catch (err) {
        console.error('[mailer] Erreur SMTP :', err);
        console.warn(`[mailer] FALLBACK — Code OTP pour ${to} : ${code}`);
        return;
      }
    }

    console.log(`\n================================================`);
    console.log(`[mailer] CODE OTP pour ${to} : ${code}`);
    console.log(`================================================\n`);
  }
}
