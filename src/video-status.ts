import { randomUUID } from 'node:crypto';

export type VideoState = 'not_started' | 'unknown' | 'queued' | 'running' | 'succeeded' | 'failed';
type Operation = { id: string; state: VideoState; progress?: number; errorCode?: string; providerState?: string; assetUri?: string };

// RPC identities and protobuf positions verified against Flow's own frontend:
// BatchAsyncGenerateVideo*.response.media = field 4; status-check.media = field 3;
// Media.metadata = field 6, generation status = field 9, enum = field 1.
export const VIDEO_SUBMIT_RPCS = new Set(['YhhmEf', 'eb1hJf', 'nprQif', 'MZZa6b', 'fZytfe', 'IJhj9c', 'jIps6', 'p0UkFb']);
export const VIDEO_READ_RPCS = new Set(['jwpduf', 'Zzl0ze', 'as29s']);
export function isReadOnlyFlowRequest(body: string): boolean {
  try {
    const batches = JSON.parse(new URLSearchParams(body).get('f.req') ?? 'null');
    return Array.isArray(batches) && batches.length > 0 && batches.every(batch => Array.isArray(batch) &&
      batch.length > 0 && batch.every(row => Array.isArray(row) && VIDEO_READ_RPCS.has(row[0])));
  } catch { return false; }
}
export function decodeFlowRpc(text: string): { rpcId: string; payload: unknown }[] {
  const rows: { rpcId: string; payload: unknown }[] = [];
  const visit = (v: any): void => {
    if (!Array.isArray(v)) return;
    if (v[0] === 'wrb.fr' && typeof v[1] === 'string' && typeof v[2] === 'string') {
      try { rows.push({ rpcId: v[1], payload: JSON.parse(v[2]) }); } catch {}
    } else v.forEach(visit);
  };
  // Batchexecute is anti-XSSI, length-prefixed JSON frames, one frame per line.
  for (const line of text.split('\n')) { try { visit(JSON.parse(line)); } catch {} }
  return rows;
}
export function flowRpcUrls(text: string): string[] {
  const urls=new Set<string>();
  const visit=(value: unknown, depth=0): void => {
    if(depth>24) return;
    if(typeof value==='string') {
      if(/^https:\/\/[^\s"'\\]+$/u.test(value)) urls.add(value);
    } else if(Array.isArray(value)) value.forEach(row=>visit(row,depth+1));
    else if(value && typeof value==='object') Object.values(value).forEach(row=>visit(row,depth+1));
  };
  const frames=decodeFlowRpc(text);
  if(frames.length) frames.forEach(frame=>visit(frame.payload));
  else {try {visit(JSON.parse(text));}catch{}}
  return [...urls];
}
export function nativeVideoOperations(rpcId: string, payload: unknown): Operation[] {
  if (!Array.isArray(payload)) return [];
  const media = VIDEO_SUBMIT_RPCS.has(rpcId) ? payload[3] :
    ['jwpduf', 'Zzl0ze'].includes(rpcId) ? payload[2] : rpcId === 'as29s' ? [payload] : [];
  if (!Array.isArray(media)) return [];
  return media.filter(row => Array.isArray(row) && typeof row[0] === 'string' &&
    /^[0-9a-f-]{36}$/iu.test(row[0]) && (VIDEO_SUBMIT_RPCS.has(rpcId) || rpcId === 'jwpduf' || Array.isArray(row[7]))).map(row => {
      const code = row[5]?.[8]?.[0];
      // Native frontend maps both 1 and 2 to pending; do not invent a
      // running/queued distinction or progress percentage that it does not expose.
      const state: VideoState = [1, 2, 6].includes(code) ? 'queued' : code === 3 ? 'succeeded' :
        [4, 5, 7].includes(code) ? 'failed' : 'unknown';
      // Flow's own get-media-URI decoder: Media.video (field 8), original
      // video (field 1).URI (field 9), or alternate video (field 5).URI (field 3).
      const uri = row[7]?.[0]?.[8] ?? row[7]?.[4]?.[2];
      return { id: row[0], state, providerState: [1, 2].includes(code) ? 'pending' : code === 6 ? 'scheduled' :
        code === 3 ? 'success' : code === 5 ? 'canceled' : [4, 7].includes(code) ? 'failed' : 'unknown',
        ...(state === 'succeeded' && typeof uri === 'string' && /^https:\/\//u.test(uri) ? {assetUri:uri} : {}) };
    });
}

// Only explicit operation records carry provider status. URLs, disabled
// buttons and time elapsed are never interpreted as processing or success.
export function parseVideoOperations(payload: unknown): Operation[] {
  const rows: Operation[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || depth > 8) return;
    if (Array.isArray(value)) { value.slice(0, 100).forEach(row => visit(row, depth + 1)); return; }
    const row = value as Record<string, any>;
    const id = row.operationId || row.jobId || row.taskId || (typeof row.name === 'string' && /(?:^|\/)operations\//u.test(row.name) ? row.name : undefined);
    if (typeof id === 'string' && id) {
      const status = row.status ?? row.state ?? row.metadata?.status ?? row.metadata?.state;
      const label = typeof status === 'string' ? status.toUpperCase().replace(/^(?:VIDEO_GENERATION_STATUS_|STATUS_)/u, '') : '';
      let state: VideoState = 'unknown';
      if (row.error || ['FAILED', 'ERROR', 'CANCELLED', 'CANCELED'].includes(label)) state = 'failed';
      else if (['SUCCEEDED', 'SUCCESS', 'COMPLETED', 'DONE'].includes(label) || (row.done === true && row.response)) state = 'succeeded';
      else if (['RUNNING', 'PROCESSING', 'IN_PROGRESS', 'ACTIVE'].includes(label)) state = 'running';
      else if (['PENDING', 'QUEUED', 'WAITING'].includes(label)) state = 'queued';
      const progress = row.progressPercent ?? row.metadata?.progressPercent;
      rows.push({ id, state, ...(typeof progress === 'number' && progress >= 0 && progress <= 100 ? { progress } : {}),
        ...(typeof row.providerState === 'string' ? {providerState: row.providerState} : {}),
        ...(typeof row.assetUri === 'string' && /^https:\/\//u.test(row.assetUri) ? {assetUri:row.assetUri} : {}),
        ...(row.error ? { errorCode: String(row.error.code ?? 'PROVIDER_ERROR') } : {}) });
    }
    for (const key of ['operations', 'operation', 'result', 'data', 'response']) if (row[key]) visit(row[key], depth + 1);
  };
  visit(payload, 0);
  return rows;
}

export class VideoGenerationStatus {
  generationId?: string;
  projectUrl?: string;
  startedAt = 0;
  observedAt = 0;
  private operations = new Map<string, Operation>();
  reset(): void {
    this.generationId = undefined; this.projectUrl = undefined;
    this.startedAt = 0; this.observedAt = 0; this.operations.clear();
  }
  start(projectUrl: string, generationId?: string): void {
    this.generationId = generationId ?? randomUUID(); this.projectUrl = projectUrl;
    this.startedAt = Date.now(); this.observedAt = 0; this.operations.clear();
  }
  restore(generationId: string, projectUrl: string, jobId: string): void {
    this.reset(); this.generationId = generationId; this.projectUrl = projectUrl;
    this.operations.set(jobId, {id: jobId, state: 'unknown'});
  }
  observeOperations(rows: Operation[], submission: boolean, generationId: string | undefined): void {
    this.observe({operations: rows.map(row => ({...row, operationId: row.id, progressPercent:row.progress}))}, submission, generationId);
  }
  observe(payload: unknown, submission: boolean, generationId: string | undefined): void {
    if (!generationId || generationId !== this.generationId) return;
    for (const row of parseVideoOperations(payload)) {
      if (!submission && !this.operations.has(row.id)) continue;
      const previous = this.operations.get(row.id);
      // A lagging status response cannot roll a terminal operation backwards.
      if (previous && ['succeeded', 'failed'].includes(previous.state)) continue;
      this.operations.set(row.id, row.state === 'unknown' && previous ? previous : row);
      this.observedAt = Date.now();
    }
  }
  read() {
    const operations = [...this.operations.values()];
    let state: VideoState = this.generationId ? 'unknown' : 'not_started';
    if (operations.some(row => row.state === 'failed')) state = 'failed';
    else if (operations.length && operations.every(row => row.state === 'succeeded')) state = 'succeeded';
    else if (operations.some(row => row.state === 'running')) state = 'running';
    else if (operations.some(row => row.state === 'queued')) state = 'queued';
    return { generationId: this.generationId, projectUrl: this.projectUrl, state,
      ...(operations.length === 1 ? { jobId: operations[0].id } : {}),
      source: operations.length ? 'provider_operation' : this.generationId ? 'no_bound_operation' : 'no_submission_in_this_session',
      startedAt: this.startedAt, observedAt: this.observedAt || null, operations };
  }
}
