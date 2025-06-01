import Essentia from '../library/essentia/essentia.js-core.es.js';
import { EssentiaWASM } from '../library/essentia/essentia-wasm.es.js';

const es = new Essentia(EssentiaWASM);

function analyseChannels(channels) {
	let signal;
	
	switch (channels.length) {
		case 1:
			signal = es.arrayToVector(channels[0]);
			break;
		case 2:
			const left = es.arrayToVector(channels[0]),
				right = es.arrayToVector(channels[1]);
			signal = es.MonoMixer(left, right).audio;
			break;

		default: throw new Error("Illegal number of channels");
	}

	const filtered = es.LowPass(signal, 700).signal;
	const rhythm = es.RhythmExtractor2013(filtered, 250, "degara");

	postMessage({
		type: "result",
		data: {
			result: {
				bpm: rhythm.bpm,
				beats: es.vectorToArray(rhythm.ticks),
				confidence: rhythm.confidence,
				estimates: es.vectorToArray(rhythm.estimates),
				bpmIntervals: es.vectorToArray(rhythm.bpmIntervals)
			}
		}
	});
}

onmessage = (event) => {
	const message = event.data;

	switch (message.type) {
		case "hello":
			console.log("Got a hello:", message.description);
			postMessage({
				type: "hello",
				description: "Hello!"
			})
			break;

		case "analyse":
			if (message.data?.channels) { analyseChannels(message.data.channels); }
			break;

		default: throw new Error(`Illegal analyser message type: ${message.type}`);
	}
};