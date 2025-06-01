import Essentia from '../library/essentia/essentia.js-core.es.js';
import { EssentiaWASM } from '../library/essentia/essentia-wasm.es.js';

const es = new Essentia(EssentiaWASM);

class TempoProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [{
            name: 'sensitivity',
            defaultValue: 0.5,
            minValue: 0,
            maxValue: 1
        }];
    }

    constructor() {
        super();

        this.bufferSize = 2048;
        this.hopSize = 1024;
        this.energyThreshold = 0.01;
        
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
        this.lastBeatTime = 0;
        this.lastEnergy = 0;
        this.energyHistory = new Float32Array(43);  // ~1 second of energy history
        this.energyIndex = 0;
        this.beatHistory = [];
        this.currentBPM = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input.length) {
			return true;
		}

		let signal;

		switch (input.length) {
			case 1:
				signal = es.arrayToVector(input[0]);
				break;
			case 2:
				const left = es.arrayToVector(input[0]),
					right = es.arrayToVector(input[1]);
				signal = es.MonoMixer(left, right).audio;
				break;

			default: return true;
		}

		if (this.buffer.length < this.bufferSize) {
			this.buffer.push(signal);
		}

		if (this.buffer.length < this.bufferSize) {
			return true;
		}

		const detections = es.OnsetDetectionGlobal(
			signal,
			this.bufferSize,
			Math.round(this.bufferSize / 4),
			"beat_emphasis"
		).onsetDetections;

		console.debug("Detections:", detections);

        return true;
    }
}

registerProcessor('tempo-processor', TempoProcessor); 