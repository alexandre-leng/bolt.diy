/*
 * Wire contract between the Bolt client (app/lib/runtime/server/*) and bolt-runtime.
 * Keep this file byte-identical to app/lib/runtime/server/protocol.ts in the Bolt repo.
 */

export type ErrorCode =
  | 'ENOENT'
  | 'EEXIST'
  | 'EISDIR'
  | 'ENOTDIR'
  | 'EACCES'
  | 'ENOTEMPTY'
  | 'EINVAL'
  | 'EBUSY'
  | 'EQUOTA'
  | 'ESESSION'
  | 'EINTERNAL';

export interface RuntimeErrorShape {
  code: ErrorCode;
  message: string;
}

export type RequestOp =
  | 'session.open'
  | 'session.switch'
  | 'fs.readFile'
  | 'fs.writeFile'
  | 'fs.mkdir'
  | 'fs.rm'
  | 'fs.readdir'
  | 'fs.stat'
  | 'watch.start'
  | 'watch.stop'
  | 'proc.spawn'
  | 'proc.write'
  | 'proc.resize'
  | 'proc.kill'
  | 'preview.url'
  | 'preview.setScript';

export interface RequestMessage {
  id: number;
  op: RequestOp;
  [key: string]: unknown;
}

export type ResponseMessage =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: RuntimeErrorShape };

export type WatchEventType = 'add_file' | 'change' | 'remove_file' | 'add_dir' | 'remove_dir';

export interface WatchEventWire {
  type: WatchEventType;
  path: string;
  buffer?: { b64: string };
}

export type EventMessage =
  | { ev: 'proc.out'; pid: string; data: string }
  | { ev: 'proc.exit'; pid: string; code: number }
  | { ev: 'port'; port: number; type: 'open' | 'close'; url: string }
  | { ev: 'server-ready'; port: number; url: string }
  | { ev: 'watch'; watchId: string; events: WatchEventWire[] }
  | { ev: 'session.state'; state: 'starting' | 'ready' | 'sleeping' | 'error'; message?: string };

export interface SessionOpenResult {
  workdir: string;
  projectId: string;
}

export const WORKDIR = '/home/project';
