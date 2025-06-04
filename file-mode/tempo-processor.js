import Essentia from '../library/essentia/essentia.js-core.es.js';
import { EssentiaWASM } from '../library/essentia/essentia-wasm.es.js';
import { PolarFFTWASM } from '../library/essentia-modules/polarFFT.module.js';

const es = new Essentia(EssentiaWASM);


class TempoProcessor extends AudioWorkletProcessor {
	constructor() {
		super();

		this.frameSize = 512;
		this.PolarFFT = new PolarFFTWASM.PolarFFT(this.frameSize);

		this.inputBuffer = new Float32Array(this.frameSize);
		this.inputBufferSize = 0;
		this.inputStartTime = 0.;

		this.odfArray = [];
		this.odfTimes = [];

		this.lastAnalysedODF = 0;
		this.lastAnalysisTime = 0.;
		this.analysisWindow = 6.;
		this.analysisStep = 3.;

		this.allTicks = [];
		this.currentBPM = null;
		this.completed = false;

		this.port.onmessage = (e) => {
			const message = e.data;
			switch (message.type) {
				case "finish":
					this.retrieveTicksFinal();
					this.recalculateBPM();
					this.completed = true;

					this.updateNode();
					break;

				case "close":
					this.cleanup();

					if (message.port) {
						message.port.postMessage({ type: "success" });
						message.port.close();
					}
					break;
			}
		};
	}

	updateNode() {
		this.port.postMessage({
			type: "update",
			bpm: this.currentBPM,
			beats: this.allTicks,
			completed: this.completed
		});
	}

	cleanup() {
		this.PolarFFT?.shutdown();
	}

	retrieveODF() {
		// console.debug("Signal:", this.inputBuffer);

		const now = currentTime;

		const signalFrame = es.arrayToVector(this.inputBuffer);

		const polarFrame = this.PolarFFT.compute(
			es.vectorToArray(
				es.Windowing(signalFrame).frame));

		// console.debug("Polar:", {
		// 	magnitude: es.vectorToArray(polarFrame.magnitude),
		// 	phase: es.vectorToArray(polarFrame.phase)
		// });

		try {
			var onsetDetection = es.OnsetDetection(
				es.arrayToVector(es.vectorToArray(polarFrame.magnitude)),
				es.arrayToVector(es.vectorToArray(polarFrame.phase)),
				"complex",
				sampleRate
			).onsetDetection;
		}
		catch (error) {
			console.error("Failed to detect onsets: " + error);
		}

		// console.debug("Detection:", {
		// 	time: currentTime,
		// 	detection: onsetDetection
		// });

		this.odfArray.push(onsetDetection);
		this.odfTimes.push(now);

		this.inputBufferSize = 0;
	}

	/**
	 * Analyze collected ODFs to detect beats
	 */
	retrieveTicks() {
		const now = currentTime;

		const analysisWindow = this.odfArray.slice(this.lastAnalysedODF);

		const degara = es.TempoTapDegara(
			es.arrayToVector(analysisWindow),
			250, 40,
			"x2",
			sampleRate / this.frameSize
		);

		const ticks = es.vectorToArray(degara.ticks);

		let offsetedTicks = ticks;
		if (this.allTicks.length > 0) {
			offsetedTicks = ticks.map((time) => {
				return time + this.allTicks.at(-1);
			});
		}

		console.debug("New ticks:", {
			retrieved: ticks,
			offseted: offsetedTicks
		});

		this.allTicks.push(...offsetedTicks);

		this.lastAnalysisTime += now;
		this.lastAnalysedODF += analysisWindow.length;
	}

	retrieveTicksFinal() {
		const detections = es.arrayToVector(this.odfArray);

		const degara = es.TempoTapDegara(
			detections,
			250, 40,
			"x2",
			sampleRate / this.frameSize
		);

		const ticks = es.vectorToArray(degara.ticks);

		console.debug("Final ticks:", ticks);

		this.allTicks = ticks;
	}

	/**
	 * Calculate BPM from beat intervals
	 */
	recalculateBPM() {
		if (this.allTicks.length < 2) {
			return 120.;
		}

		let interval = 0.;
		for (let i = 1; i < this.allTicks.length; i++) {
			interval += this.allTicks[i] - this.allTicks[i - 1];
		}
		interval /= this.allTicks.length;

		this.currentBPM = 60. / interval;
	}

	process(inputs, outputs, parameters) {
		if (this.completed) {
			return true;
		}

		const input = inputs[0];
		if (!input || !input.length) {
			console.debug("No input received");
			return true;
		}

		let monoInput;
		if (input.length === 1) {
			monoInput = input[0];
		}
		else {
			monoInput = new Float32Array(input[0].length);
			for (let i = 0; i < input[0].length; i++) {
				let sum = 0;
				for (let ch = 0; ch < input.length; ch++) {
					sum += input[ch][i];
				}
				monoInput[i] = sum / input.length;
			}
		}

		let inputIndex = 0, inputSamplesLeft = monoInput.length;
		while (inputSamplesLeft) {
			const canFit = this.frameSize - this.inputBufferSize;
			const samplesToCopy = Math.min(canFit, inputSamplesLeft);

			this.inputBuffer.set(monoInput.subarray(inputIndex, inputIndex + samplesToCopy), this.inputBufferSize);
			this.inputBufferSize += samplesToCopy;
			inputSamplesLeft -= samplesToCopy;
			inputIndex += samplesToCopy;

			if (this.inputBufferSize === this.frameSize) {
				this.retrieveODF();
			}
		}
		
		if (currentTime - this.lastAnalysisTime < this.analysisStep) {
			return true;
		}

		this.retrieveTicks();

		this.recalculateBPM();

		this.updateNode();

		return true;
	}
}

registerProcessor('tempo-processor', TempoProcessor);