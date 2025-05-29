import { sendMessage, findHandler } from "../common/runtime-messaging.js";
import { success, failure } from "../common/result.js";

import { state } from "./state.js";
import * as audio from "./audio.js";

if (typeof browser === "undefined") {
	var browser = chrome;
}

export const messageHandlers = {
	async "load-file"(message) {
		if (!message?.data?.meta) {
			return failure({
				description: "File's metadata (`.data.meta`) wasn't received"
			});
		}
		if (!message?.data?.buffer) {
			return failure({
				description: "File's buffer (`.data.buffer`) wasn't received"
			});
		}

		/** @type {Uint8Array} */
		const buffer = new Uint8Array(message.data.buffer).buffer;

		audio.close();

		const setup = await audio.setup(buffer);
		if (!setup || setup.type === "failure") {
			return failure({
				description: "Failed setting up audio: " + (setup ? setup?.description || "Unknown error" : "No response")
			});
		}

		const meta = message.data.meta;
		state.file = {
			name: meta.name,
			type: meta.type,
			size: meta.size
		};
		state.playing = false;
		state.duration = audio.getDuration();
		state.contextTimeAtStart = null;
		state.songTimeLast = 0.;
		state.songTimeAtStart = null;
		state.analysis = null;

		const analysisStarted = audio.startAnalysis();
		if (analysisStarted.type === "failure") {
			return failure({
				description: "Couldn't start analysis"
			});
		}

		return success();
	},

	async "unload-file"() {
		const closed = audio.close();
		if (closed) {
			return success();
		}
		else {
			return failure();
		}
	},

	async "get-state"() {
		const safeState = {
			file: state?.file ? {
				name: state.file.name,
				type: state.file.type,
				size: state.file.size
			} : null,
			playing: state.playing,
			songVolume: state.songVolume,
			clickVolume: state.clickVolume,
			duration: state?.duration ?? null,
			contextTimeAtStart: state?.contextTimeAtStart ?? null,
			songTimeLast: state?.songTimeLast ?? null,
			songTimeAtStart: state?.songTimeAtStart ?? null,
			analysis: state?.analysis ? {
				bpm: state.analysis.bpm,
				beats: state.analysis.beats.slice()
			} : null
		};

		const currentTime = audio.getContextCurrentTime();
		return {
			type: "success",
			data: {
				state: safeState,
				stateForUI: {
					contextTimeCurrent: currentTime,
					songTimeCurrent: state.playing
						? Number(currentTime - state.contextTimeAtStart + state.songTimeAtStart)
						: null
				}
			}
		}
	},

	async "toggle"(message) {
		let newState;

		if (message?.data?.statePlaying) {
			newState = message?.data?.statePlaying;
		}
		else {
			newState = !state.playing;
		}

		if (state.playing === newState) {
			return success();
		}
		
		const toggled = (newState === true) ? audio.start() : audio.pause();
		if (toggled.type === "success") {
			return success();
		}
		else {
			return failure({
				description: "Failed to toggle audio: " + toggled?.description ?? "Unknown error"
			});
		}
	},

	async "change-volume"(message) {
		const target = message?.data?.target;
		const newVolume = message?.data?.newVolume;

		if (target === undefined || newVolume === undefined) {
			return failure({
				description: "`target` and/or `newVolume` weren't received"
			})
		}

		switch (target) {
			case "clicker":
			case "song":
				break;

			default: return failure(`\`target\` must be either "clicker" or "song" (${target})`);
		}

		if (typeof newVolume !== "number" || newVolume < 0. || newVolume > 1.) {
			return failure({
				description: `\`newVolume\` must be a number in range [0; 1] (${newVolume})`
			});
		}

		const changed = audio.setVolume(target, newVolume);
		if (changed.type === "failure") {
			return failure({
				description: "Failed to change ${target}'s volume: " + changed?.description ?? "Unknown error"
			});
		}
		else {
			return success();
		}
	},

	async "seek"(message) {
		const position = message?.data?.position;

		if (position === undefined) {
			return failure({
				description: `\`position\` wasn't received`
			})
		}

		if (typeof position !== "number" || position < 0. || position > 1.) {
			return failure({
				description: `\`position\` must be a number in range [0; 1] (${position})`
			});
		}

		const newTime = position * state.duration;

		if (state.playing) {
			const started = audio.start(newTime);
			if (started.type === "success") {
				return success();
			}
			else {
				return failure({
					description: "Failed to seek: " + started?.description ?? "Unknown error"
				});
			}
		}
		else {
			state.songTimeLast = newTime;

			return success();
		}
	}
};