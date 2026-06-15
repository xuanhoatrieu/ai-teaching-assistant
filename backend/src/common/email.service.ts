import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SystemConfigService } from '../settings/system-config.service';

@Injectable()
export class EmailService {
    private readonly logger = new Logger(EmailService.name);

    constructor(private readonly configService: SystemConfigService) {}

    private async createTransporter() {
        const config = await this.configService.getSMTPConfig();
        if (!config.enabled) {
            throw new Error('Dịch vụ gửi email SMTP chưa được bật trong Admin Settings.');
        }
        if (!config.host || !config.user || !config.pass) {
            throw new Error('SMTP chưa được cấu hình đầy đủ thông tin (Host, User, Password).');
        }

        return nodemailer.createTransport({
            host: config.host,
            port: parseInt(config.port, 10) || 587,
            secure: parseInt(config.port, 10) === 465, // true for 465, false for other ports
            auth: {
                user: config.user,
                pass: config.pass,
            },
        });
    }

    async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
        try {
            const config = await this.configService.getSMTPConfig();
            const transporter = await this.createTransporter();
            const fromAddress = config.from || `"AI Teaching Assistant" <${config.user}>`;

            const mailOptions = {
                from: fromAddress,
                to,
                subject: 'Đặt lại mật khẩu tài khoản AI Teaching Assistant',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
                        <h2 style="color: #2563eb; text-align: center;">Đặt Lại Mật Khẩu</h2>
                        <p>Xin chào,</p>
                        <p>Bạn nhận được email này vì bạn (hoặc ai đó) đã yêu cầu đặt lại mật khẩu cho tài khoản tại <strong>AI Teaching Assistant</strong>.</p>
                        <p>Vui lòng click vào nút bên dưới để tiến hành đặt lại mật khẩu (đường liên kết này sẽ hết hạn trong vòng 15 phút):</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${resetUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Đặt Lại Mật Khẩu</a>
                        </div>
                        <p>Hoặc sao chép đường dẫn này dán vào trình duyệt của bạn:</p>
                        <p style="word-break: break-all; color: #2563eb;"><a href="${resetUrl}">${resetUrl}</a></p>
                        <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
                        <p style="font-size: 0.875rem; color: #6b7280;">Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này. Mật khẩu của bạn sẽ được giữ nguyên an toàn.</p>
                    </div>
                `,
            };

            await transporter.sendMail(mailOptions);
            this.logger.log(`Password reset email sent to ${to}`);
        } catch (error: any) {
            this.logger.error(`Failed to send password reset email to ${to}: ${error.message}`);
            throw new Error(`Gửi email thất bại: ${error.message}`);
        }
    }

    async sendTestEmail(to: string): Promise<void> {
        try {
            const config = await this.configService.getSMTPConfig();
            const transporter = await this.createTransporter();
            const fromAddress = config.from || `"AI Teaching Assistant" <${config.user}>`;

            const mailOptions = {
                from: fromAddress,
                to,
                subject: 'Kiểm tra kết nối SMTP - AI Teaching Assistant',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
                        <h2 style="color: #10b981; text-align: center;">SMTP Connected Successfully!</h2>
                        <p>Xin chào,</p>
                        <p>Đây là email kiểm tra tính năng gửi thư tự động từ hệ thống <strong>AI Teaching Assistant</strong>.</p>
                        <p>Nếu bạn nhận được email này, cấu hình SMTP của bạn đã hoạt động chính xác.</p>
                        <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
                        <p style="font-size: 0.875rem; color: #6b7280;">Thời gian kiểm tra: ${new Date().toLocaleString('vi-VN')}</p>
                    </div>
                `,
            };

            await transporter.sendMail(mailOptions);
            this.logger.log(`Test email sent successfully to ${to}`);
        } catch (error: any) {
            this.logger.error(`Failed to send test email to ${to}: ${error.message}`);
            throw new Error(`Test SMTP thất bại: ${error.message}`);
        }
    }
}
