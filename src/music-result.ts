import { createHash } from 'node:crypto';

export interface MusicSubmissionContext {
  /** Absent when Flow creates the conversation only after clicking Generate. */
  conversationId?: string;
  soundPrompt: string;
  startedAt: number;
  instrumental: true;
  /** Only central Ask Producer submissions that began on the unbound /session route. */
  promptSource?: 'producer_chat_fresh_session';
  /** Natural same-generation status endpoint confirmations for fresh Producer submits. */
  observedOperationIds?: ReadonlySet<string>;
}

export interface FlowMusicResult {
  clipId: string;
  operationId: string;
  conversationId: string;
  soundPromptSha256: string;
  audioUrl: string;
  createdAt: string;
  duration: string;
  instrumental: true;
  generatedSoundPromptSha256?: string;
  bindingKind?: 'producer_chat_fresh_session' | 'observed_exact_recovery';
}

export interface ObservedFlowMusicClip {
  clipId: string;
  operationId: string;
  conversationId: string;
  soundPrompt: string;
  audioUrl: string;
  createdAt: string;
  duration: string;
  instrumental: true;
}

type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isUuid(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value));
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Read completed, structurally valid Music clips for exact-URL recovery. */
export function extractCompletedFlowMusicClips(payload: unknown): ObservedFlowMusicClip[] {
  const clips = object(object(payload)?.clips);
  if (!clips) return [];
  const results: ObservedFlowMusicClip[] = [];
  for (const [clipKey, rawClip] of Object.entries(clips)) {
    const clip = object(rawClip);
    const operation = object(clip?.operation);
    const duration = object(clip?.duration);
    const lyrics = object(clip?.lyrics);
    const lyricsValue = object(lyrics?.value);
    const clipId = string(clip?.id), operationId = string(clip?.op_id);
    const operationType = string(clip?.op_type), operationInnerType = string(operation?.op_type);
    const conversationId = string(operation?.conversation_id), soundPrompt = string(operation?.sound_prompt);
    const audioUrl = string(clip?.audio_url), createdAt = string(clip?.created_at), durationText = string(duration?.value);
    const lyricsText = string(lyricsValue?.text);
    if (
      !isUuid(clipId) || clipId !== clipKey || !isUuid(operationId) || !isUuid(conversationId) || !soundPrompt ||
      operationType !== 'audio__create_song' || operationInnerType !== 'audio__create_song' ||
      string(duration?.status) !== 'completed' || !durationText || !Number.isFinite(Number(durationText)) || Number(durationText) <= 0 ||
      string(lyrics?.status) !== 'completed' || lyricsText !== '[Instrumental]' ||
      !audioUrl || !/^https:\/\//iu.test(audioUrl) || !/\.m4a(?:[?#]|$)/iu.test(audioUrl) ||
      !createdAt || !Number.isFinite(Date.parse(createdAt))
    ) continue;
    results.push({ clipId, operationId, conversationId, soundPrompt, audioUrl, createdAt, duration: durationText, instrumental: true });
  }
  return results;
}

/**
 * Select one completed Flow Music song only when the provider's clip record
 * proves it belongs to the current UI submission.  This intentionally does
 * not infer success from an audio element, a generic media response, or an
 * arbitrary song in the conversation.
 */
export function selectCurrentFlowMusicResult(
  payload: unknown,
  context: MusicSubmissionContext,
): FlowMusicResult | null {
  return selectCurrentFlowMusicResultFromClips(extractCompletedFlowMusicClips(payload), context);
}

/** Match already-validated completed clips to the current submission context. */
export function selectCurrentFlowMusicResultFromClips(
  clips: ObservedFlowMusicClip[],
  context: MusicSubmissionContext,
): FlowMusicResult | null {
  if (!isUuid(context.conversationId ?? null) || !context.soundPrompt.trim() || context.instrumental !== true) return null;
  const expectedPromptHash = sha256Text(context.soundPrompt);

  const matches: FlowMusicResult[] = [];
  for (const clip of clips) {
    if (!isEligibleFlowMusicClip(clip, context)) continue;
    matches.push({
      clipId: clip.clipId,
      operationId: clip.operationId,
      conversationId: clip.conversationId,
      soundPromptSha256: expectedPromptHash,
      audioUrl: clip.audioUrl,
      createdAt: clip.createdAt,
      duration: clip.duration,
      instrumental: true,
      ...(context.promptSource === 'producer_chat_fresh_session' ? { generatedSoundPromptSha256: sha256Text(clip.soundPrompt), bindingKind: 'producer_chat_fresh_session' as const } : {}),
    });
  }
  // A provider response with two distinct completed songs cannot be assigned
  // to one click safely. Repeated representations of the exact same clip are
  // harmless, but choosing the first distinct result would be arbitrary.
  const unique = new Map(matches.map((result) => [`${result.clipId}:${result.operationId}:${result.audioUrl}`, result]));
  return unique.size === 1 ? [...unique.values()][0] : null;
}

export function isEligibleFlowMusicClip(clip: ObservedFlowMusicClip, context: MusicSubmissionContext): boolean {
  if (context.conversationId !== undefined && clip.conversationId !== context.conversationId) return false;
  if (Date.parse(clip.createdAt) < context.startedAt) return false;
  if (context.promptSource === 'producer_chat_fresh_session') {
    return Boolean(context.observedOperationIds?.has(clip.operationId));
  }
  return clip.soundPrompt === context.soundPrompt;
}
