import { success, failure } from "../common/result.js";
import { BaseClicker, IntervalClicker, ScheduledClicker } from "../common/clicker.js";

import { state } from "./state.js";

if (typeof browser === "undefined") {
	var browser = chrome;
}

const playback = {
	/** @type {AudioContext} */
	context: null,
	/** @type {AudioBuffer} */
	buffer: null,
	/** @type {AudioBufferSourceNode} */
	source: null,
	/** @type {BaseClicker} */
	clicker: null,
	/** @type {GainNode} */
	songGain: null,
	/** @type {GainNode} */
	clickGain: null
};

const analysis = {
	/** @type {OfflineAudioContext} */
	context: null,
	/** @type {AudioBuffer} */
	buffer: null,
	/** @type {AudioWorkletNode} */
	analyser: null
};

export function isBaseSetup() { return !!playback.context; }
export function isBufferSetup() { return isBaseSetup() && playback.buffer !== null; }
export function isAnalysisSetup() { return isBufferSetup() && analysis.analyser !== null; }
export function isSetup() { return isAnalysisSetup(); }

export async function setup(arrayBuffer) {
	setupBase();
	await setupBuffer(arrayBuffer);
	await setupAnalysis();

	return success();
}

// function setupPlayback() {}
// function setupAnalysis() {}

function setupBase() {
	if (isBaseSetup()) {
		return success();
	}

	playback.context = new AudioContext();
	playback.songGain = new GainNode(playback.context, { gain: state.songVolume });
	playback.clickGain = new GainNode(playback.context, { gain: state.clickVolume });
	
	playback.songGain.connect(playback.context.destination);
	playback.clickGain.connect(playback.context.destination);

	return success();
}

async function setupBuffer(arrayBuffer) {
	if (isBufferSetup()) {
		return success();
	}
	playback.buffer = await playback.context.decodeAudioData(arrayBuffer);
	return success();
}

async function setupAnalysis() {
	if (isAnalysisSetup()) {
		return success();
	}

	analysis.context = new OfflineAudioContext({
		numberOfChannels: playback.buffer.numberOfChannels,
		length: playback.buffer.length,
		sampleRate: playback.buffer.sampleRate
	});

	analysis.buffer = await analysis.context.decodeAudioData(playback.buffer.getChannelData(0).buffer);

	const processorURL = browser.runtime.getURL("file-mode/tempo-processor.js");
	await analysis.context.audioWorklet.addModule(processorURL);

	const analysisSource = new AudioBufferSourceNode(analysis.context, { buffer: analysis.buffer });
	analysis.analyser = new AudioWorkletNode(analysis.context, 'tempo-processor', {
		numberOfInputs: 1,
		numberOfOutputs: 1,
		parameterData: {
			sensitivity: 0.5
		}
	});

	analysis.analyser.port.onmessage = (e) => {
		const message = e.data;
		switch (message.type) {
			case 'beat':
				console.debug('Beat detected:', message);
				if (!state.analysis) {
					state.analysis = {
						bpm: message.bpm,
						beats: [],
						confidence: 0
					};
				}
				state.analysis.beats.push(message.time);
				state.analysis.bpm = message.bpm;

				// If we're playing and don't have a clicker yet, start it
				if (state.playing && !playback.clicker) {
					setupClicker();
					startClicker(state.songTimeAtStart);
				}
				break;
			case 'analysis_complete':
				console.log('Analysis complete:', state.analysis);
				break;
			default:
				console.warn('Unknown message from tempo processor:', message);
		}
	};

	analysisSource.connect(analysis.analyser);
	analysis.analyser.connect(analysis.context.destination);

	analysisSource.start();
	
	try {
		await analysis.context.startRendering();
	} catch (error) {
		console.error('Analysis failed:', error);
		return failure({
			description: "Failed to analyze audio: " + error.message
		});
	}

	return success();
}

function setupClicker() {
	if (!isAnalysisSetup() || !state.analysis) { return; }
	
	if (playback.clicker) { playback.clicker.close(); }

	if (state.analysis?.beats?.length > 0) {
		playback.clicker = new ScheduledClicker(playback.context);
	}
	else if (state.analysis?.bpm) {
		playback.clicker = new IntervalClicker(playback.context);
	}
	else {
		return; // No valid analysis data to create clicker
	}

	playback.clicker.connect(playback.clickGain);
}

export function start(songTime) {
	if (!isSetup()) {
		return failure({ description: "Audio buffer is not ready" });
	}

	if (songTime === undefined) {
		if (state.playing) {
			songTime = playback.context.currentTime - state.contextTimeAtStart + state.songTimeAtStart;
		}
		else {
			songTime = state.songTimeLast ?? 0.;
		}
	}
	else if (songTime < 0. || songTime > playback.buffer.duration) {
		return failure({
			description: `Illegal song time value: ${songTime} not in [0; ${playback.buffer.duration}]`
		});
	}

	if (playback.source) {
		playback.source.onended = ()=>{};
		playback.source.stop();
		playback.source.disconnect();
	}
	playback.source = new AudioBufferSourceNode(playback.context, { buffer: playback.buffer });
	playback.source.onended = (e) => { console.log("Song has ended. Nothing is done."); };
	playback.source.connect(playback.songGain);

	playback.source.start(0., songTime);

	// Only start clicker if we have analysis results
	if (state.analysis?.beats?.length > 0 || state.analysis?.bpm) {
		setupClicker();
		startClicker(songTime);
	}

	state.playing = true;
	state.contextTimeAtStart = playback.context.currentTime;
	state.songTimeAtStart = songTime;

	console.log("Audio started at:", songTime);

	return success();
}

export function pause() {
	if (!isBufferSetup()) {
		return failure({ description: "Audio buffer is not ready" });
	}

	if (playback.source) {
		playback.source.onended = ()=>{};
		playback.source.stop();
		playback.source.disconnect();
		playback.source = null;
	}

	playback.clicker?.pause();

	state.playing = false;
	state.songTimeLast = playback.context.currentTime - state.contextTimeAtStart + state.songTimeAtStart;
	state.contextTimeAtStart = null;
	state.songTimeAtStart = null;
	
	return success();
}

export function close() {
	if (!isSetup()) {
		return success();
	}

	playback.context.close();
	playback.context = null;
	playback.buffer = null;
	playback.source = null;
	playback.clicker?.close();
	playback.clicker = null;
	playback.songGain = null;
	playback.clickGain = null;

	analysis.analyser?.disconnect();
	analysis.analyser = null;
	analysis.context = null;
	analysis.buffer = null;

	return success();
}

function startClicker(songTime) {
	if (state.analysis === null) { return; }

	if (songTime === undefined) {
		if (state.playing) {
			songTime = playback.context.currentTime - state.contextTimeAtStart + state.songTimeAtStart;
		}
		else {
			songTime = state.songTimeLast ?? 0.;
		}
	}
	else if (songTime < 0. || songTime > playback.buffer.duration) {
		return failure({
			description: `Illegal song time value: ${songTime} not in [0; ${playback.buffer.duration}]`
		});
	}

	setupClicker();

	if (playback.clicker instanceof ScheduledClicker) {
		playback.clicker.start(songTime, state.analysis.beats);
	}
	else if (playback.clicker instanceof IntervalClicker) {
		playback.clicker.start(0., { time: state.analysis.bpm, type: "bpm" });
	}
}

export function startAnalysis() {
	if (playback.buffer.numberOfChannels > 2) {
		return failure({
			description: `Audio has more than 2 channels which is not supported (${playback.buffer.numberOfChannels})`
		})
	}

	let channels = [];
	for (let c = 0; c < playback.buffer.numberOfChannels; c++) {
		channels.push(playback.buffer.getChannelData(c).slice());
	}

	analysis.analyser.port.postMessage({
		type: "analyse",
		data: { channels }
	});

	return success();
}

export function getContextCurrentTime() {
	return playback.context?.currentTime ?? null;
}

export function getDuration() {
	if (isSetup()) {
		return playback.buffer.duration;
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
			if (isBaseSetup()) { playback.clickGain.gain.value = value; }
			break;
			
		case "song":
			state.songVolume = value;
			if (isBaseSetup()) { playback.songGain.gain.value = value; }
			break;

		default: return failure({
			description: `Target must be either "clicker" or "song" (${target})`
		});
	}

	return success();
}