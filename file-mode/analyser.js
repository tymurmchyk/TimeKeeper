import Essentia from '../library/essentia/essentia.js-core.es.js';
import { EssentiaWASM } from '../library/essentia/essentia-wasm.es.js';

const essentia = new Essentia(EssentiaWASM);

function analyseChannels(channels) {
	let signal;
	
	switch (channels.length) {
		case 1:
			signal = essentia.arrayToVector(channels[0]);
			break;
		case 2:
			const left = essentia.arrayToVector(channels[0]),
				right = essentia.arrayToVector(channels[1]);
			signal = essentia.MonoMixer(left, right).audio;
			break;

		default: throw new Error("Illegal number of channels");
	}

	const rhythm = essentia.RhythmExtractor2013(signal, 250, "degara");

	postMessage({
		type: "result",
		data: {
			result: {
				bpm: rhythm.bpm,
				beats: essentia.vectorToArray(rhythm.ticks)
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