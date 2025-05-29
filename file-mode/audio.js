import { success, failure } from "../common/result.js";
import { ScheduledClicker } from "../common/clicker.js";

import { state } from "./state.js";

if (typeof browser === "undefined") {
	var browser = chrome;
}

/** @type {AudioContext} */
let context = null;
/** @type {AudioBuffer} */
let buffer = null;
/** @type {AudioBufferSourceNode} */
let source = null;
/** @type {ScheduledClicker} */
let clicker = null;
/** @type {GainNode} */
let songGain = null;
/** @type {GainNode} */
let clickGain = null;
/** @type {Worker} */
let analyser = null;

export function isBaseSetup() { return !!context; }
export function isBufferSetup() { return isBaseSetup() && buffer !== null; }
export function isAnalysisSetup() { return isBufferSetup() && !!analyser; }
export function isSetup() { return isAnalysisSetup(); }

export async function setup(arrayBuffer) {
	setupBase();
	await setupBuffer(arrayBuffer);
	setupAnalyser();

	return success();
}

export function setupBase() {
	if (isBaseSetup()) {
		return success();
	}

	context = new AudioContext();
	clicker = new ScheduledClicker(context);
	songGain = new GainNode(context, { gain: state.songVolume });
	clickGain = new GainNode(context, { gain: state.clickVolume });

	clicker.connect(clickGain);
	songGain.connect(context.destination);
	clickGain.connect(context.destination);

	return success();
}

export async function setupBuffer(arrayBuffer) {
	if (isBufferSetup()) {
		return success();
	}
	buffer = await context.decodeAudioData(arrayBuffer);
	return success();
}

export function setupAnalyser() {
	if (isAnalysisSetup()) {
		return success();
	}

	const analyserURL = browser.runtime.getURL("file-mode/analyser.js");
	analyser = new Worker(analyserURL, { type: "module" });
	
	analyser.onmessage = (e) => {
		const message = e.data;
		switch (message.type) {
			case "hello":
				console.log("Analyser hello:", message);
				break;
			case "result":
				console.log("Analysis results:", message.data.result);
				state.analysis = {
					bpm: message.data.result.bpm,
					beats: message.data.result.beats.slice()
				};
				if (state.playing) { startClicker(); }
				break;
			default: console.error(`Illegal analyser message type ${message.type}`);
		}
	};
	analyser.onmessageerror = (e) => {
		console.error("Message error:", e);
	};
	analyser.onerror = (e) => {
		console.error("Error:", e);
	};

	analyser.postMessage({
		type: "hello",
		description: "Hi, analyser!"
	});

	return success();
}

export function start(songTime) {
	if (!isSetup()) {
		return failure({ description: "Audio buffer is not ready" });
	}

	if (songTime === undefined) {
		if (state.playing) {
			songTime = context.currentTime - state.contextTimeAtStart + state.songTimeAtStart;
		}
		else {
			songTime = state.songTimeLast ?? 0.;
		}
	}
	else if (songTime < 0. || songTime > buffer.duration) {
		return failure({
			description: `Illegal song time value: ${songTime} not in [0; ${buffer.duration}]`
		});
	}

	if (source) {
		source.onended = ()=>{};
		source.stop();
		source.disconnect();
	}
	source = new AudioBufferSourceNode(context, { buffer: buffer });
	source.onended = (e) => { console.log("Song has ended. Nothing is done."); };
	source.connect(songGain);

	source.start(0., songTime);
	if (state.analysis !== null) {
		startClicker(songTime);
	}

	state.playing = true;
	state.contextTimeAtStart = context.currentTime;
	state.songTimeAtStart = songTime;

	console.log("Audio started at:", songTime);

	return success();
}

export function pause() {
	if (!isBufferSetup()) {
		return failure({ description: "Audio buffer is not ready" });
	}

	if (source) {
		source.onended = ()=>{};
		source.stop();
		source.disconnect();
		source = null;
	}

	clicker?.pause();

	state.playing = false;
	state.songTimeLast = context.currentTime - state.contextTimeAtStart + state.songTimeAtStart;
	state.contextTimeAtStart = null;
	state.songTimeAtStart = null;
	
	return success();
}

export function close() {
	if (!isSetup()) {
		return success();
	}

	context.close();
	context = null;
	buffer = null;
	source = null;
	clicker.close();
	clicker = null;
	songGain = null;
	clickGain = null;
	analyser?.terminate();
	analyser = null;

	return success();
}

function startClicker(songTime) {
	if (state.analysis === null) { return; }

	if (songTime === undefined) {
		if (state.playing) {
			songTime = context.currentTime - state.contextTimeAtStart + state.songTimeAtStart;
		}
		else {
			songTime = state.songTimeLast ?? 0.;
		}
	}
	else if (songTime < 0. || songTime > buffer.duration) {
		return failure({
			description: `Illegal song time value: ${songTime} not in [0; ${buffer.duration}]`
		});
	}

	clicker.start(state.analysis.beats, 0., songTime);
}

export function startAnalysis() {
	if (buffer.numberOfChannels > 2) {
		return failure({
			description: `Audio has more than 2 channels which is not supported (${buffer.numberOfChannels})`
		})
	}

	let channels = [];
	for (let c = 0; c < buffer.numberOfChannels; c++) {
		channels.push(buffer.getChannelData(c).slice());
	}

	analyser.postMessage({
		type: "analyse",
		data: { channels }
	});

	return success();
}

export function getContextCurrentTime() {
	return context?.currentTime ?? null;
}

export function getDuration() {
	if (isSetup()) {
		return buffer.duration;
	}
	else {
		return null;
	}
}

export function setVolume(target, value) {
	if (typeof value !== "number" || value < 0. || value > 1.) {
		return failure({
			description: `Volume must be a number in range [0; 1] (${value})`
		});
	}

	switch (target) {
		case "clicker":
			state.clickVolume = value;
			if (isBaseSetup()) { clickGain.gain.value = value; }
			break;
			
		case "song":
			state.songVolume = value;
			if (isBaseSetup()) { songGain.gain.value = value; }
			break;

		default: return failure({
			description: `Target must be either "clicker" or "song" (${target})`
		});
	}

	return success();
}