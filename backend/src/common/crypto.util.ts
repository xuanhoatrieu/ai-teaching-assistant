import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

/**
 * Encrypts a string using AES-256-GCM
 * @param text - Plain text to encrypt
 * @param password - Encryption password (from env)
 * @returns Encrypted string in format: salt:iv:authTag:encryptedData (hex encoded)
 */
export async function encrypt(text: string, password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);

    // Derive key using scrypt
    const key = (await promisify(scrypt)(password, salt, KEY_LENGTH)) as Buffer;

    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Combine salt, iv, authTag, and encrypted data
    return `${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts a string encrypted with the encrypt function
 * @param encryptedText - Encrypted string in format: salt:iv:authTag:encryptedData
 * @param password - Decryption password (same as encryption)
 * @returns Decrypted plain text
 */
export async function decrypt(
    encryptedText: string,
    password: string,
): Promise<string> {
    const parts = encryptedText.split(':');
    if (parts.length !== 4) {
        throw new Error('Invalid encrypted text format');
    }

    const [saltHex, ivHex, authTagHex, encrypted] = parts;

    const salt = Buffer.from(saltHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    // Derive key using scrypt
    const key = (await promisify(scrypt)(password, salt, KEY_LENGTH)) as Buffer;

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

/**
 * Utility class for encryption operations
 */
export class CryptoUtil {
    private password: string;

    constructor(password?: string) {
        this.password = password || process.env.ENCRYPTION_KEY || '';
        if (!this.password || this.password.length < 16) {
            throw new Error(
                'ENCRYPTION_KEY must be set in environment and be at least 16 characters',
            );
        }
    }

    async encrypt(text: string): Promise<string> {
        return encrypt(text, this.password);
    }

    async decrypt(encryptedText: string): Promise<string> {
        return decrypt(encryptedText, this.password);
    }
}
