// Minimal type surface for the parts of @iden3/binfileutils this package uses.
// The library ships no declarations of its own. Only the members the zkey
// reader touches are declared; see readContributionChain.ts.
declare module "@iden3/binfileutils" {
  interface BinFileReader {
    pos: number;
    read(length: number): Promise<Uint8Array>;
    readULE32(): Promise<number>;
    readULE64(): Promise<number>;
    close(): Promise<void>;
  }

  interface BinFileSection {
    p: number;
    size: number;
  }

  export function readBinFile(
    fileName: Uint8Array | string,
    type: string,
    maxVersion: number,
    cacheSize?: number,
    pageSize?: number,
  ): Promise<{ fd: BinFileReader; sections: BinFileSection[][] }>;

  export function startReadUniqueSection(
    fd: BinFileReader,
    sections: BinFileSection[][],
    idSection: number,
  ): Promise<void>;

  export function endReadSection(
    fd: BinFileReader,
    noCheck?: boolean,
  ): Promise<void>;
}
