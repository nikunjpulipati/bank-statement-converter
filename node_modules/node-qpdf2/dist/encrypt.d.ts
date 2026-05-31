/// <reference types="node" resolution-mode="require"/>
export interface EncryptOptions {
    /** The location of the unencrypted pdf file */
    input: string;
    /**
     * A number which defines the encryption algorithm to be used.
     * Using a keyLengh of 40 is insecure.
     * @default 256
     */
    keyLength?: 40 | 128 | 256;
    /** If defined, the output location of the encrypted pdf. If not defined, a Buffer will be returned. */
    output?: string;
    /**
     * If defined, will determine if the encrypted pdf will overwrite an existing file
     * @default true
     */
    overwrite?: boolean | undefined;
    /**
     * A string containing the password with will be used to decrypt the pdf.
     * Optionally, an object containing `user` and `owner` for setting different roles.
     * If undefined, will encrypt a pdf without requiring a password to decrypt
     */
    password?: string | {
        owner: string;
        user: string;
    };
    /** Restrictions for the encrypted pdf */
    restrictions?: {
        /** Please see: https://qpdf.readthedocs.io/en/stable/cli.html#option-accessibility */
        accessibility?: "y" | "n";
        /** Please see: https://qpdf.readthedocs.io/en/stable/cli.html#option-annotate */
        annotate?: "y" | "n";
        /** Please see: https://qpdf.readthedocs.io/en/stable/cli.html#option-assemble */
        assemble?: "y" | "n";
        /** Please see: https://qpdf.readthedocs.io/en/stable/cli.html#option-cleartext-metadata */
        cleartextMetadata?: boolean;
        /** Please see: https://qpdf.readthedocs.io/en/stable/cli.html#option-extract */
        extract?: "y" | "n";
        /** Please see: https://qpdf.readthedocs.io/en/stable/cli.html#option-form */
        form?: "y" | "n";
        /** Please see: https://qpdf.readthedocs.io/en/stable/cli.html#option-modify */
        modify?: "y" | "n" | "all" | "annotate" | "form" | "assembly" | "none";
        /** Please see: https://qpdf.readthedocs.io/en/stable/cli.html#option-modify-other */
        modifyOther?: "y" | "n";
        /** Please see: https://qpdf.readthedocs.io/en/stable/cli.html#option-print */
        print?: "y" | "n" | "full" | "low" | "none";
        /** Please see: https://qpdf.readthedocs.io/en/stable/cli.html#option-use-aes */
        useAes?: "y" | "n";
    };
}
/**
 * Encrypts a PDF file
 * @param userPayload The options for encryption
 * @returns The output of QPDF
 */
export declare const encrypt: (userPayload: EncryptOptions) => Promise<Buffer>;
