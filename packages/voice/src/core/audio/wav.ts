/**
 * WAV buffer construction utility.
 *
 * M50-WAV-01
 */

/**
 * Build a valid 44-byte WAV header followed by raw PCM data.
 * M50-WAV-01
 */
export function buildWavBuffer(
  pcm16: Uint8Array,
  sampleRate: number,
  channels: number,
): Buffer {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm16.byteLength;

  const buf = Buffer.alloc(44 + dataSize);

  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);              // PCM format chunk size
  buf.writeUInt16LE(1, 20);              // PCM format = 1
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  Buffer.from(pcm16).copy(buf, 44);

  return buf;
}
