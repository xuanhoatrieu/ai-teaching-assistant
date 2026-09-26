/**
 * String and encoding utilities for handling multilingual filenames and texts.
 */

/**
 * Fixes Multer / busboy header decoding issue where UTF-8 filenames
 * (such as Vietnamese characters) are interpreted as ISO-8859-1 (latin1).
 */
export function fixUtf8Filename(filename: string): string {
    if (!filename) return filename;
    try {
        const decoded = Buffer.from(filename, 'latin1').toString('utf8');
        // If decoding produced replacement character (\uFFFD), the original was not latin1-encoded utf8
        if (decoded.includes('\uFFFD')) {
            return filename;
        }
        return decoded;
    } catch {
        return filename;
    }
}
