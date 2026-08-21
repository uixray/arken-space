/**
 * Maps the linear UI slider to the HTMLAudioElement gain.
 *
 * Human loudness perception is not linear. A quadratic curve keeps the first
 * few slider steps genuinely quiet while retaining the full 0..1 range.
 */
export function volumeSliderToGain(sliderValue: number) {
  const normalized = Math.min(1, Math.max(0, sliderValue));
  return normalized * normalized;
}
