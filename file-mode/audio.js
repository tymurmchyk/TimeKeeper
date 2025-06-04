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

export function isPlaybackSetup() { return !!playback.context; }
export function isBufferSetup() { return isPlaybackSetup() && playback.buffer !== null; }
export function isAnalysisSetup() { return isBufferSetup() && analysis.analyser !== null; }
export function isSetup() { return isAnalysisSetup(); }

/**
 * @param {ArrayBuffer} arrayBuffer 
 */
async function _setupPlayback(arrayBuffer) {
	playback.context = new AudioContext();
	
	try { playback.buffer = await playback.context.decodeAudioData(arrayBuffer.slice()); }
	catch (error) {
		return failure({
			description: "Couldn't decode array buffer for playback"
		});
	}

	playback.songGain = new GainNode(playback.context, { gain: state.songVolume });
	playback.clickGain = new GainNode(playback.context, { gain: state.clickVolume });
	
	playback.songGain.connect(playback.context.destination);
	playback.clickGain.connect(playback.context.destination);

	return success();
}

async function _setupAnalysis(arrayBuffer) {
	analysis.context = new OfflineAudioContext({
		numberOfChannels: playback.buffer.numberOfChannels,
		length: playback.buffer.length,
		sampleRate: 44100
	});

	try { analysis.buffer = await analysis.context.decodeAudioData(arrayBuffer.slice()); }
	catch (error) {
		return failure({
			description: "Couldn't decode array buffer for analysis"
		})
	}

	console.debug("Analysis buffer:", {
		numberOfChannels: analysis.buffer.numberOfChannels,
		length: analysis.buffer.length,
		sampleRate: analysis.buffer.sampleRate,
		duration: analysis.buffer.duration
	});

	const processorURL = browser.runtime.getURL("file-mode/tempo-processor.js");
	await analysis.context.audioWorklet.addModule(processorURL);

	const analysisSource = new AudioBufferSourceNode(analysis.context, { buffer: analysis.buffer });
	analysis.analyser = new AudioWorkletNode(analysis.context, 'tempo-processor', {
		numberOfInputs: 1,
		numberOfOutputs: 1
	});

	analysis.analyser.port.onmessage = (e) => {
		const message = e.data;
		switch (message.type) {
			case "update":
				const update = message;
				console.debug("Analysis update:", message);

				state.analysis = {
					bpm: update.bpm,
					beats: update.beats,
					onsets: update.onsets,
					completed: update.completed
				};

				if (state.playing) {
					_startClicker(playback.context.currentTime - state.contextTimeAtStart);
				}
				break;
				
			default:
				console.warn("Unknown message from tempo processor:", message);
		}
	};

	analysisSource.connect(analysis.analyser);
	analysis.analyser.connect(analysis.context.destination);

	analysisSource.start();
	
	console.debug("Starting audio analysis...");
	const renderPromise = analysis.context.startRendering();
	
	renderPromise.then(() => {
		console.debug("Audio analysis completed, requesting final state...");
		analysis.analyser.port.postMessage({
			type: "finish"
		});
	}).catch(error => {
		console.error("Error during audio analysis:", error);
	});

	return success();
}

function _startClicker(songTime) {
	if (state.analysis?.beats?.length === 0) {
		return;
	}

	if (songTime === undefined) {
		if (state.playing) {
			songTime = playback.context.currentTime - state.contextTimeAtStart + state.songTimeAtStart;
		}
		else {
			songTime = state.songTimeLast ?? 0.;
		}
	}
	else if (songTime < 0.) { songTime = 0.; }
	else if (songTime > playback.buffer.duration) { return; }

	playback.clicker?.close();

	const clicker = new ScheduledClicker(playback.context);
	clicker.connect(playback.clickGain);

	let adjustedBeats;
	if (state.tempoPower === 0) {
		adjustedBeats = new Float32Array(state.analysis.beats);
	}
	else if (state.tempoPower > 0) {
		const multiplier = Math.pow(2, state.tempoPower);
		const newLength = (state.analysis.beats.length - 1) * multiplier + 1;
		adjustedBeats = new Float32Array(newLength);

		for (let i = 0; i < state.analysis.beats.length - 1; i++) {
			const start = state.analysis.beats[i];
			const end = state.analysis.beats[i + 1];
			const interval = (end - start) / multiplier;
			
			for (let j = 0; j < multiplier; j++) {
				adjustedBeats[i * multiplier + j] = start + interval * j;
			}
		}
		adjustedBeats[adjustedBeats.length - 1] = state.analysis.beats[state.analysis.beats.length - 1];
	}
	else {
		const divisor = Math.pow(2, -state.tempoPower);
		adjustedBeats = new Float32Array(Math.ceil(state.analysis.beats.length / divisor));
		for (let i = 0; i < adjustedBeats.length; i++) {
			adjustedBeats[i] = state.analysis.beats[i * divisor];
		}
	}

	clicker.start(songTime, adjustedBeats, state.clickOffset);

	playback.clicker = clicker;
}

export async function setup(arrayBuffer) {
	await close();

	const playbackSetup = await _setupPlayback(arrayBuffer);
	if (playbackSetup.type === "failure") {
		await close();
		return playbackSetup;
	}

	const analysisSetup = await _setupAnalysis(arrayBuffer);
	if (analysisSetup.type === "failure") {
		await close();
		return analysisSetup;
	}

	return success();
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
	playback.source.onended = (e) => {
		console.log("Song has ended.");
		pause();
	};
	playback.source.connect(playback.songGain);

	playback.source.start(0., songTime);

	if (state.analysis?.beats?.length > 0 || state.analysis?.bpm) {
		_startClicker(songTime);
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

/**
 * Sends a message through a MessageChannel and returns a Promise that resolves with the response
 * @param {MessagePort} targetPort 
 * @param {Object} message 
 * @returns {Promise<any>}
 */
async function sendChannelMessage(targetPort, message) {
	const channel = new MessageChannel();
	const [myPort, theirPort] = [channel.port1, channel.port2];

	try {
		const response = await new Promise((resolve, reject) => {
			myPort.onmessage = (e) => resolve(e.data);
			myPort.onmessageerror = (error) => reject(new Error('Failed to receive message: ' + error));

			message.port = theirPort;
			targetPort.postMessage(message, [theirPort]);
		});

		return response;
	}
	finally {
		myPort.onmessage = null;
		myPort.onmessageerror = null;
		myPort.close();
	}
}

export async function close() {
	playback.songGain = null;
	playback.clickGain = null;
	playback.clicker?.close();
	playback.clicker = null;
	playback.source = null;
	playback.buffer = null;
	playback.context?.close();
	playback.context = null;

	if (analysis.analyser) {
		await sendChannelMessage(analysis.analyser.port, { type: "close" });
	}
	analysis.analyser = null;
	analysis.buffer = null;
	analysis.context = null;
}

export function getContextCurrentTime() { return isSetup() ? playback.context.currentTime : null; }
export function getDuration() { return isSetup() ? playback.buffer.duration : null; }

export function setVolume(target, newVolume) {
	if (typeof newVolume !== "number" || newVolume < 0. || newVolume > 1.) {
		return failure({
			description: `\`newVolume\` must be a number in range [0; 1] (${newVolume})`
		});
	}

	switch (target) {
		case "clicker":
			state.clickVolume = newVolume;
			if (isPlaybackSetup()) { playback.clickGain.gain.value = newVolume; }
			break;
			
		case "song":
			state.songVolume = newVolume;
			if (isPlaybackSetup()) { playback.songGain.gain.value = newVolume; }
			break;

		default: return failure({
			description: `\`target\` must be either "clicker" or "song" (${target})`
		});
	}

	return success();
}