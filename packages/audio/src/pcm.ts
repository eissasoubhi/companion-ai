export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) {
    throw new RangeError('At least one audio channel is required.');
  }

  const frameCount = channels[0]?.length ?? 0;
  if (channels.some((channel) => channel.length !== frameCount)) {
    throw new RangeError('All audio channels must contain the same number of frames.');
  }

  if (channels.length === 1) {
    return new Float32Array(channels[0]);
  }

  const mono = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[frame] ?? 0;
    mono[frame] = sum / channels.length;
  }
  return mono;
}

export function float32ToPcm16Bytes(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);

  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index] ?? 0));
    const pcm = value < 0 ? Math.round(value * 32_768) : Math.round(value * 32_767);
    view.setInt16(index * 2, pcm, true);
  }

  return bytes;
}
