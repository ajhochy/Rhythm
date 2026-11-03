import { type ChildProcess } from "node:child_process";
export declare function stop(proc: ChildProcess, opts?: {
    group?: boolean;
}): void;
export declare function bindAbort(proc: ChildProcess, signal?: AbortSignal, onAbort?: () => void, stopOpts?: {
    group?: boolean;
}): () => void;
