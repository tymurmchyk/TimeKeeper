import { success, failure } from "../common/result.js";
import { state } from "./state.js";
import * as audio from "./audio.js";

const MIN_BPM = 15;
const MAX_BPM = 500;
const MIN_TAP_INTERVAL = 60 / MAX_BPM;
const MAX_TAP_INTERVAL = 60 / MIN_BPM;

function getTimeSignatureBeats(timeSignature) {
	const [numerator] = timeSignature.split('/').map(Number);
	return numerator;
}

function calculateAverageBPM(tapTimes) {
	if (tapTimes.length < 2) return null;

	const intervals = [];
	for (let i = 1; i < tapTimes.length; i++) {
		intervals.push(tapTimes[i] - tapTimes[i - 1]);
	}

	const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
	
	return Math.round(60000 / avgInterval);
}

export const messageHandlers = {
	async "get-state"() {
		return success({
			data: {
				state: {
					playing: state.playing,
					bpm: state.bpm,
					clickVolume: state.clickVolume,
					timeSignature: state.timeSignature,
					tapCount: state.tapCount,
					requiredTaps: getTimeSignatureBeats(state.timeSignature),
					currentBeat: state.playing ? audio.getCurrentBeat() : null
				}
			}
		});
	},
	
	async "toggle"(message) {
		let newState;
		if (message?.data?.statePlaying !== undefined) {
			newState = message.data.statePlaying;
		}
		else {
			newState = !state.playing;
		}

		if (state.playing === newState) {
			return success();
		}

		if (newState) {
			const setup = audio.setup();
			if (setup.type === "failure") {
				return failure({
					description: "Failed to setup audio: " + setup.description
				});
			}

			const started = audio.start();
			if (started.type === "failure") {
				return failure({
					description: "Failed to start audio: " + started.description
				});
			}

			state.playing = true;
		}
		else {
			const paused = audio.close();
			if (paused.type === "failure") {
				return failure({
					description: "Failed to pause audio: " + paused.description
				});
			}

			state.playing = false;
		}

		return success();
	},

	async "change-volume"(message) {
		const newVolume = message?.data?.newVolume;

		if (newVolume === undefined) {
			return failure({
				description: "`newVolume` wasn't received"
			});
		}

		const changed = audio.setVolume(newVolume);
		if (changed.type === "failure") {
			return failure({
				description: "Failed to change volume: " + changed.description
			});
		}

		return success();
	},

	async "change-bpm"(message) {
		const newBPM = message?.data?.newBpm;

		if (newBPM === undefined) {
			return failure({
				description: "`newBPM` wasn't received"
			});
		}

		if (newBPM < MIN_BPM || newBPM > MAX_BPM) {
			return failure({
				description: `BPM must be between ${MIN_BPM} and ${MAX_BPM}`
			});
		}

		const changed = audio.setBPM(newBPM);
		if (changed.type === "failure") {
			return failure({
				description: "Failed to change BPM: " + changed.description
			});
		}

		state.bpm = newBPM;
		return success();
	},

	async "change-time-signature"(message) {
		const timeSignature = message?.data?.timeSignature;

		if (!timeSignature) {
			return failure({
				description: "`timeSignature` wasn't received"
			});
		}

		const changed = audio.setTimeSignature(timeSignature);
		if (changed.type === "failure") {
			return failure({
				description: "Failed to change time signature: " + changed.description
			});
		}

		state.tapCount = 0;
		state.tapTimes = [];
		state.lastTapTime = null;

		return success();
	},

	async "tap"() {
		const now = performance.now();

		// Check if this tap is too soon after the last one
		if (state.lastTapTime !== null) {
			const interval = (now - state.lastTapTime) / 1000; // Convert to seconds
			if (interval < MIN_TAP_INTERVAL) {
				return success(); // Ignore taps that are too fast
			}
			if (interval > MAX_TAP_INTERVAL) {
				// Reset if tap is too slow
				state.tapTimes = [];
				state.tapCount = 0;
				state.lastTapTime = null;
				return success();
			}
		}

		state.lastTapTime = now;
		state.tapTimes.push(now);
		state.tapCount++;

		// Keep only recent taps (last 8 taps maximum)
		if (state.tapTimes.length > 8) {
			state.tapTimes.shift();
		}

		// Calculate the required number of taps based on time signature
		const requiredTaps = getTimeSignatureBeats(state.timeSignature);

		// If we have enough taps, calculate and set the new BPM
		if (state.tapCount >= requiredTaps) {
			const newBPM = calculateAverageBPM(state.tapTimes);
			
			if (newBPM !== null && newBPM >= MIN_BPM && newBPM <= MAX_BPM) {
				const changed = audio.setBPM(newBPM);
				if (changed.type === "failure") {
					return failure({
						description: "Failed to change BPM: " + changed.description
					});
				}
				state.bpm = newBPM;
			}

			// Reset tap count after applying the new BPM
			state.tapCount = 0;
			state.tapTimes = [];
			state.lastTapTime = null;
		}

		// Set up timeout to reset tap count if no tap happens within MAX_TAP_INTERVAL
		if (state.tapCount > 0) {
			setTimeout(() => {
				const now = performance.now();
				if (state.lastTapTime && (now - state.lastTapTime) / 1000 > MAX_TAP_INTERVAL) {
					state.tapCount = 0;
					state.tapTimes = [];
					state.lastTapTime = null;
				}
			}, MAX_TAP_INTERVAL * 1000);
		}

		return success();
	}
}; 