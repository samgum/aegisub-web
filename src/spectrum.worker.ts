interface Request {
  samples: ArrayBuffer;
  sampleRate: number;
  columnsPerSecond: number;
  bins: number;
}

const worker = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };

function fft(real: Float64Array, imag: Float64Array): void {
  const size = real.length;
  for (let index = 1, reverse = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reverse & bit; bit >>= 1) reverse ^= bit;
    reverse ^= bit;
    if (index < reverse) {
      [real[index], real[reverse]] = [real[reverse], real[index]];
      [imag[index], imag[reverse]] = [imag[reverse], imag[index]];
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const wLenReal = Math.cos(angle);
    const wLenImag = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let wReal = 1;
      let wImag = 0;
      for (let offset = 0; offset < length / 2; offset += 1) {
        const even = start + offset;
        const odd = even + length / 2;
        const oddReal = real[odd] * wReal - imag[odd] * wImag;
        const oddImag = real[odd] * wImag + imag[odd] * wReal;
        const evenReal = real[even];
        const evenImag = imag[even];
        real[even] = evenReal + oddReal;
        imag[even] = evenImag + oddImag;
        real[odd] = evenReal - oddReal;
        imag[odd] = evenImag - oddImag;
        const nextReal = wReal * wLenReal - wImag * wLenImag;
        wImag = wReal * wLenImag + wImag * wLenReal;
        wReal = nextReal;
      }
    }
  }
}

worker.onmessage = (event) => {
  const { samples, sampleRate, columnsPerSecond, bins } = event.data;
  const pcm = new Float32Array(samples);
  const fftSize = 512;
  const hop = Math.max(1, Math.round(sampleRate / columnsPerSecond));
  const columns = Math.max(1, Math.ceil(pcm.length / hop));
  const values = new Uint8Array(columns * bins);
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);
  const magnitudes = new Float64Array(fftSize / 2);
  const minFrequency = 45;
  const maxFrequency = sampleRate / 2;
  for (let column = 0; column < columns; column += 1) {
    const center = column * hop;
    for (let index = 0; index < fftSize; index += 1) {
      const sampleIndex = center + index - fftSize / 2;
      const window = .5 - .5 * Math.cos(2 * Math.PI * index / (fftSize - 1));
      real[index] = (sampleIndex >= 0 && sampleIndex < pcm.length ? pcm[sampleIndex] : 0) * window;
      imag[index] = 0;
    }
    fft(real, imag);
    for (let index = 0; index < magnitudes.length; index += 1) magnitudes[index] = Math.hypot(real[index], imag[index]) / fftSize;
    for (let bin = 0; bin < bins; bin += 1) {
      const low = minFrequency * (maxFrequency / minFrequency) ** (bin / bins);
      const high = minFrequency * (maxFrequency / minFrequency) ** ((bin + 1) / bins);
      const from = Math.max(1, Math.floor(low / sampleRate * fftSize));
      const to = Math.min(magnitudes.length - 1, Math.ceil(high / sampleRate * fftSize));
      let magnitude = 0;
      for (let index = from; index <= to; index += 1) magnitude = Math.max(magnitude, magnitudes[index]);
      const db = 20 * Math.log10(magnitude + 1e-7);
      values[column * bins + bin] = Math.max(0, Math.min(255, Math.round((db + 85) / 75 * 255)));
    }
    if (column % 500 === 0) worker.postMessage({ type: "progress", ratio: column / columns });
  }
  worker.postMessage({ type: "done", values: values.buffer, columns, bins, columnsPerSecond }, [values.buffer]);
};
