// 给 ./blocks.js（与 tutor 仓 / server / 官网同一份切块 + 块 hash 的纯函数）的类型声明；实现只有那一份，别在 App 里另抄。只声明 App 用到的导出。
// ★ 每条都带 `declare`：构建里的 `lingui extract` 用 Babel 扫整个 src（含 .d.ts），Babel 不认「.d.ts 语境」，
//   裸的 `export const X: number;` 会被当成普通 TS 报「Missing initializer」（2026-09-29 M4 第一次构建就栽在这）。
export declare const HASH_LEN: number;
export declare const PAGE_BREAK: string;
export declare function fold(text: string): string;
export declare function sha256Hex(text: string): Promise<string>;
export declare function blockHash(text: string): Promise<string>;
export declare function paragraphsToBlocks(text: string): { text: string }[];
export declare function hashPages<T extends { idx: number; title?: string; blocks: { text: string }[] }>(pages: T[]): Promise<{ idx: number; title?: string; blocks: { hash: string; text: string; bbox?: number[] }[] }[]>;
export declare function pagesToText(pages: { blocks: { text: string }[] }[]): string;
export declare function shortSha(sha: string): string;
