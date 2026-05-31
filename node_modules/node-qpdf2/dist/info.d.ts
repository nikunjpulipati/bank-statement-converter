export interface InfoSettings {
    /** The path for the encrypted pdf */
    input: string;
    /** The password for the encrypted pdf */
    password?: string;
}
/**
 * Gets the encryption info for a PDF
 * @param payload The settings for info
 * @returns The output of QPDF
 */
export declare const info: (payload: InfoSettings) => Promise<string>;
