/** Conservative display peaks; exact PCM frame count, O(bins + channels) memory.
 * Pairwise compaction may widen peaks by one bucket, never hide a transient.
 * Clip endpoints are still quantized against the original frame count/rate.
 */
export function createWaveformAccumulator(channels: number, bins: number) {
  if (!Number.isInteger(channels) || channels < 1 || channels > 8 || !Number.isInteger(bins) || bins < 1 || bins > 2048)
    throw new Error("INVALID_RANGE");
  const frameBytes = channels * 4;
  let carry = Buffer.alloc(0);
  let frames = 0;
  let width = 1;
  let bucketFrames = 0;
  let bucketPeak = 0;
  let buckets: number[] = [];
  return {
    push(chunk: Buffer) {
      const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const completeBytes = data.length - data.length % frameBytes;
      for (let offset = 0; offset < completeBytes; offset += frameBytes) {
        for (let channel = 0; channel < channels; channel++) {
          const sample = Math.abs(data.readFloatLE(offset + channel * 4));
          if (Number.isFinite(sample)) bucketPeak = Math.max(bucketPeak, Math.min(1, sample));
        }
        frames++;
        if (++bucketFrames === width) {
          buckets.push(bucketPeak); bucketFrames = 0; bucketPeak = 0;
          if (buckets.length === 2 * bins) {
            const compacted: number[] = [];
            for (let i = 0; i < buckets.length; i += 2) compacted.push(Math.max(buckets[i]!, buckets[i + 1]!));
            buckets = compacted; width *= 2;
          }
        }
      }
      // Copy only the incomplete frame, never retain an entire stdout chunk.
      carry = Buffer.from(data.subarray(completeBytes));
    },
    finish() {
      if (!frames || carry.length) throw new Error("CODEC_FAILED");
      const peaks = Array.from({ length: bins }, () => 0);
      const values = bucketFrames ? [...buckets, bucketPeak] : buckets;
      for (let i = 0; i < values.length; i++) {
        const first = Math.min(bins - 1, Math.floor(i * width * bins / frames));
        const last = Math.min(bins - 1, Math.floor((Math.min(frames, (i + 1) * width) - 1) * bins / frames));
        for (let bin = first; bin <= last; bin++) peaks[bin] = Math.max(peaks[bin]!, values[i]!);
      }
      return { frames, peaks };
    },
  };
}
