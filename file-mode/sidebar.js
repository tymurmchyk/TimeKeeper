"use strict";

import { sendMessage } from "../common/runtime-messaging.js";
import { formatTime } from "../common/utilities.js";

if (typeof browser === "undefined") {
	var browser = chrome;
}

let state = {
	file: null,
	playing: null,
	songVolume: null,
	clickVolume: null,
	duration: null,
	contextTimeAtStart: null,
	songTimeLast: null,
	songTimeAtStart: null,
	analysis: null
};

const ui = {
	elements: {
		fileInput: null,
		fileSelect: null,
		fileName: null,
		toggle: null,
		position: null,
		currentTime: null,
		duration: null,
		volumeSong: null,
		volumeClicker: null,
		averageBpm: null,
		currentBpm: null
	},

	state: {
		updateInterval: null,
		songTimeCurrent: null
	},

	update() {
		if (state.file) {
			ui.elements.fileName.textContent = state.file.name;
			ui.elements.fileSelect.textContent = "change file";
		} else {
			ui.elements.fileName.textContent = "no file selected";
			ui.elements.fileSelect.textContent = "choose file";
		}

		ui.elements.toggle.disabled = !state.file;
		ui.elements.toggle.textContent = state.playing ? "⏸" : "▶";

		ui.elements.position.disabled = !state.file;
		if (state.playing) {
			ui.elements.position.value = ui.state.songTimeCurrent / state.duration;
		}
		else if (state.file) {
			ui.elements.position.value = state.songTimeLast / state.duration;
		}
		else {
			ui.elements.position.value = 0.;
		}

		ui.elements.currentTime.textContent = formatTime(ui.state?.songTimeCurrent);
		ui.elements.duration.textContent = formatTime(state?.duration);
		
		ui.elements.volumeClicker.value = state.clickVolume;
		ui.elements.volumeSong.value = state.songVolume;

		ui.elements.averageBpm.textContent = state.analysis ? Math.round(state.analysis.bpm) : "--";
		
		ui.elements.currentBpm.textContent = "--";
		if (state.analysis?.beats && ui.state.songTimeCurrent !== null) {
			if (state.analysis.beats.length <= 1) { return; }

			let b;
			for (b = 0; b < state.analysis.beats.length; b++) {
				if (ui.state.songTimeCurrent >= state.analysis.beats[b]) {
					break;
				}
			}

			let i, c = 0,
				current = 0;
			for (let i = Math.max(0, b - 5); i < Math.min(b + 5, state.analysis.beats.length - 1); i++) {
				current += state.analysis.beats[b + 1] - state.analysis.beats[b];
				c++;
			}

			current =  60. / (current / i);

			ui.elements.currentBpm.textContent = Math.round(current);
		}

		if (state.file) {
			startStateUpdates();
		}
		else {
			stopStateUpdates();
		}
	},

	handlers: {
		async fileSelect(event) {
			ui.elements.fileInput.click();
		},

		async fileChange(event) {
			const newFile = event.target.files[0];
			
			if (newFile) {
				if (newFile.size > 2**20 * 20) {
					console.error(`File is too big (${newFile.size})`);
					return;
				}

				const buffer = new Uint8Array(await newFile.arrayBuffer());

				const loading = await sendMessage({
					type: ["file-mode", "load-file"],
					data: {
						meta: {
							name: newFile.name.slice(),
							type: newFile.type.slice(),
							size: newFile.size
						},
						buffer: buffer
					}
				});

				if (!loading || loading.type === "failure") {
					console.error("Failed to load file: " + (loading ? (loading?.description ?? "Unknown error") : "No response"));
					return;
				}

				await stateUpdate();
				
				console.log("File successfully loaded.");
			}
			else {
				const unloading = await sendMessage({
					type: ["file-mode", "unload-file"]
				});

				if (!unloading || unloading.type === "failure") {
					console.error("Failed to unload file: " + (unloading ? (unloading?.description ?? "Unknown error") : "No response"));
					return;
				}

				await stateUpdate();

				console.log("File successfully unloaded.");
			}
		},

		async toggleClick(event) {
			if (state.file === null) {
				await stateUpdate();
				return;
			}

			const toggling = await sendMessage({
				type: ["file-mode", "toggle"],
				data: { statePlaying: !state.playing }
			});
			if (!toggling || toggling.type === "failure") {
				console.error("Failed to toggle: " + (toggling ? (toggling?.description ?? "Unknown error") : "No response"));
				return;
			}

			console.log("Audio successfully toggled.");
			
			await stateUpdate();
		},

		async volumeInput(event, target) {
			let newVolume = parseFloat(event.target.value);

			if (!newVolume || newVolume < 0.) { newVolume = 0.; }
			else if (newVolume > 1.) { newVolume = 1.; }
			
			const changing = await sendMessage({
				type: ["file-mode", "change-volume"],
				data: {
					target,
					newVolume
				}
			});
			if (!changing || changing.type === "failure") {
				console.error("Failed to change volume: " + (changing ? (changing?.description ?? "Unknown error") : "No response"));
				return;
			}

			await stateUpdate();
		},

		async playbackInput(event) {
			if (state.file === null) { return; }
	
			const position = parseFloat(event.target.value);
			if (position < 0.) { position = 0.; }
			else if (position > 1.) { position = 1.; }
	
			const seeking = await sendMessage({
				type: ["file-mode", "seek"],
				data: { position }
			});
			if (!seeking || seeking.type === "failure") {
				console.error("Failed to seek song's position: " + (seeking ? (seeking?.description ?? "Unknown error") : "No response"));
				return;
			}

			await stateUpdate();
		},

		async copyBpmToManual(bpm) {
			if (!bpm || isNaN(bpm)) return;
			
			const copying = await sendMessage({
				type: ["manual-mode", "change-bpm"],
				data: { newBpm: Math.round(bpm) }
			});
			if (!copying || copying.type === "failure") {
				console.error("Failed to copy BPM: " + (copying ? (copying?.description ?? "Unknown error") : "No response"));
				return;
			}
		}
	}
};

async function stateUpdate() {
	const gettingState = await sendMessage({
		type: ["file-mode", "get-state"]
	});
	if (!gettingState || gettingState.type === "failure") {
		console.error("Failed to update state: " + (gettingState ? (gettingState?.description ?? "Unknown error") : "No response"));
		return;
	}

	const receivedState = gettingState.data.state;
	state = {
		file: receivedState.file,
		playing: Boolean(receivedState.playing),
		songVolume: Number(receivedState.songVolume),
		clickVolume: Number(receivedState.clickVolume),
		duration: receivedState.duration !== null ? Number(receivedState.duration) : null,
		contextTimeAtStart: receivedState.contextTimeAtStart !== null ? Number(receivedState.contextTimeAtStart) : null,
		songTimeLast: receivedState.songTimeLast !== null ? Number(receivedState.songTimeLast) : null,
		songTimeAtStart: receivedState.songTimeAtStart !== null ? Number(receivedState.songTimeAtStart) : null,
		analysis: receivedState.analysis ? {
			bpm: Number(receivedState.analysis.bpm),
			beats: receivedState.analysis.beats ? Array.from(receivedState.analysis.beats) : null
		} : null
	};

	ui.state = {
		updateInterval: ui.state.updateInterval,
		songTimeCurrent: gettingState.data.stateForUI.songTimeCurrent !== null ? 
			Number(gettingState.data.stateForUI.songTimeCurrent) : null
	};

	ui.update();
}

function startStateUpdates() {
	if (ui.state.updateInterval) { return; }
	ui.state.updateInterval = setInterval(stateUpdate, 100);
}

function stopStateUpdates() {
	if (ui.state.updateInterval) {
		clearInterval(ui.state.updateInterval);
		ui.state.updateInterval = null;
	}
}

export async function initialize() {
	console.log("Initializing file mode's sidebar...");
	
	ui.elements.fileInput = document.getElementById("file-input");
	ui.elements.fileSelect = document.getElementById("file-select");
	ui.elements.fileName = document.getElementById("file-name");
	ui.elements.toggle = document.getElementById("file-toggle");
	ui.elements.position = document.getElementById("file-position");
	ui.elements.currentTime = document.getElementById("file-current-time");
	ui.elements.duration = document.getElementById("file-duration");
	ui.elements.volumeSong = document.getElementById("file-volume-song");
	ui.elements.volumeClicker = document.getElementById("file-volume-clicker");
	ui.elements.averageBpm = document.getElementById("file-average-bpm");
	ui.elements.currentBpm = document.getElementById("file-current-bpm");
	
	ui.elements.fileSelect.addEventListener("click", ui.handlers.fileSelect);
	ui.elements.fileInput.addEventListener("change", ui.handlers.fileChange);
	ui.elements.toggle.addEventListener("click", ui.handlers.toggleClick);
	ui.elements.position.addEventListener("input", ui.handlers.playbackInput);
	ui.elements.volumeSong.addEventListener("input", (e) => ui.handlers.volumeInput(e, "song"));
	ui.elements.volumeClicker.addEventListener("input", (e) => ui.handlers.volumeInput(e, "clicker"));
	ui.elements.averageBpm.addEventListener("click", () => {
		const bpm = Number(ui.elements.averageBpm.textContent);
		ui.handlers.copyBpmToManual(bpm);
	});
	ui.elements.currentBpm.addEventListener("click", () => {
		const bpm = Number(ui.elements.currentBpm.textContent);
		ui.handlers.copyBpmToManual(bpm);
	});

	await stateUpdate();

	console.log("File mode's sidebar initialized.");
}