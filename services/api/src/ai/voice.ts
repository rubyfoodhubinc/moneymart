/**
 * Ore's voice for calls (from President Ava's `president-voice.ts`: speech with a fallback chain).
 * Cartesia first, ElevenLabs second; if neither answers, the app speaks with the phone's own voice.
 */
import { valueOf } from './registry.js';

export const DEFAULT_ORE_VOICE = '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc'; // Cartesia "Jacqueline — Reassuring Agent"
const ELEVEN_FALLBACK_VOICE = '21m00Tcm4TlvDq8ikWAM';

export function voiceConfigured(): { cartesia: boolean; elevenlabs: boolean } {
  return { cartesia: Boolean(process.env.CARTESIA_API_KEY), elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY ?? process.env.ELEVENLAB_API_KEY) };
}

/** Pure: text made speakable (no markdown, links or emoji clutter), capped for one breath. */
export function speakable(text: string): string {
  return text
    .replace(/moneymart:\/\/\S+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800);
}

async function cartesia(text: string): Promise<Buffer> {
  const response = await fetch(`${process.env.MM_CARTESIA_BASE ?? 'https://api.cartesia.ai'}/tts/bytes`, {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: { 'X-API-Key': process.env.CARTESIA_API_KEY!, 'Cartesia-Version': '2025-04-16', 'content-type': 'application/json' },
    body: JSON.stringify({
      model_id: 'sonic-2',
      transcript: text,
      voice: { mode: 'id', id: String(valueOf('ore.voice_id') || DEFAULT_ORE_VOICE) },
      language: 'en',
      output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
    }),
  });
  if (!response.ok) throw new Error(`cartesia ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function elevenlabs(text: string): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY ?? process.env.ELEVENLAB_API_KEY;
  const response = await fetch(`${process.env.MM_ELEVENLABS_BASE ?? 'https://api.elevenlabs.io'}/v1/text-to-speech/${process.env.ELEVENLABS_ORE_VOICE_ID ?? ELEVEN_FALLBACK_VOICE}?output_format=mp3_44100_128`, {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: { 'xi-api-key': key!, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
  });
  if (!response.ok) throw new Error(`elevenlabs ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** MP3 audio of Ore saying `text`, or null when no voice provider answered. */
export async function speak(text: string): Promise<{ audio: Buffer; provider: 'cartesia' | 'elevenlabs' } | null> {
  const words = speakable(text);
  if (!words) return null;
  const have = voiceConfigured();
  if (have.cartesia) {
    try {
      return { audio: await cartesia(words), provider: 'cartesia' };
    } catch (error) {
      console.warn('[ore-voice] cartesia failed:', (error as Error).message);
    }
  }
  if (have.elevenlabs) {
    try {
      return { audio: await elevenlabs(words), provider: 'elevenlabs' };
    } catch (error) {
      console.warn('[ore-voice] elevenlabs failed:', (error as Error).message);
    }
  }
  return null;
}
